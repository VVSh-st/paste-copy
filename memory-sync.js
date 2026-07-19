// file_name: memory-sync.js

/* ============================================================
   MemorySync — приватная синхронизация безопасных метаданных
   ============================================================ */
(function () {
  'use strict';

  const SETTINGS_KEY = 'llm-pb-memory-sync-v1';
  const FILE_NAME = 'llm-memory.json';
  const SCHEMA_VERSION = 1;
  const PUSH_DEBOUNCE_MS = 10 * 60_000;
  const AUTO_PUSH_MIN_INTERVAL_MS = 3 * 60 * 60_000;
  const AUTO_PULL_MIN_INTERVAL_MS = 24 * 60 * 60_000;
  const RATE_LIMIT_PAUSE_MS = 2 * 60 * 60_000;
  const FAILED_HASH_PAUSE_MS = 60 * 60_000;
  const REQUEST_WINDOW_MS = 60 * 60_000;
  const MAX_REQUESTS_PER_WINDOW = 6;
  const MIN_REQUEST_GAP_MS = 30_000;

  const AUTO_PUSH_ALLOWED_REASONS = new Set([
    'user-memory:addSuccessfulStructure',
    'user-memory:resetSuggestionLearning',
    'user-memory:enableSuggestionType',
    'user-memory:reset',
    'project-graph:captureNamedVersion',
    'project-graph:captureBaselineFromCurrent',
    'project-graph:pinBaseline',
    'project-graph:unpinBaseline',
    'project-graph:setRetention',
    'project-graph:cleanup',
    'project-graph:reset'
  ]);

  const DEFAULT_SETTINGS = {
    enabled: false,
    autoPush: false,
    autoPull: false,
    lastPushAt: 0,
    lastPullAt: 0,
    lastPushHash: '',
    lastError: '',
    rateLimitedUntil: 0,
    dirty: false,
    lastAutoPullAt: 0,
    lastFailedPushHash: '',
    lastFailedPushAt: 0,
    lastRequestAt: 0,
    requestCountStartedAt: 0,
    requestCount: 0
  };

  let settings = loadSettings();
  let pushTimer = null;
  let autoPullTimer = null;
  let modal = null;
  let wrapped = false;
  let suppressSchedule = false;
  let pushInFlight = null;
  let pullInFlight = null;

  function now() {
    return Date.now();
  }

  const MAX_SYNC_PAYLOAD_BYTES = 1_500_000;

  function getUtf8ByteLength(value) {
    const text = String(value || '');
    if (window.TextEncoder) {
      return new TextEncoder().encode(text).length;
    }
    return unescape(encodeURIComponent(text)).length;
  }

  function assertPayloadSize(raw) {
    const size = getUtf8ByteLength(raw);
    if (size > MAX_SYNC_PAYLOAD_BYTES) {
      throw new Error(`Файл памяти слишком большой: ${Math.round(size / 1024)} KB`);
    }
  }

  function safeParse(raw) {
    try { return JSON.parse(raw || ''); } catch (_) { return null; }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function saveSettings(next = {}) {
    settings = normalizeSettings({ ...settings, ...(next || {}) });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] save settings failed:', err);
    }
    renderModal();
    scheduleAutoPullCheck();
    return getSettings();
  }

  function loadSettings() {
    try {
      const raw = safeParse(localStorage.getItem(SETTINGS_KEY));
      return normalizeSettings(raw || {});
    } catch (err) {
      console.warn('[MemorySync] load settings failed:', err);
      return normalizeSettings({});
    }
  }

  function normalizeSettings(raw = {}) {
    return {
      ...DEFAULT_SETTINGS,
      enabled: raw.enabled === true,
      autoPush: raw.autoPush === true,
      autoPull: raw.autoPull === true,
      lastPushAt: Number(raw.lastPushAt || 0),
      lastPullAt: Number(raw.lastPullAt || 0),
      lastPushHash: String(raw.lastPushHash || ''),
      lastError: String(raw.lastError || '').slice(0, 240),
      rateLimitedUntil: Number(raw.rateLimitedUntil || 0),
      dirty: raw.dirty === true,
      lastAutoPullAt: Number(raw.lastAutoPullAt || 0),
      lastFailedPushHash: String(raw.lastFailedPushHash || ''),
      lastFailedPushAt: Number(raw.lastFailedPushAt || 0),
      lastRequestAt: Number(raw.lastRequestAt || 0),
      requestCountStartedAt: Number(raw.requestCountStartedAt || 0),
      requestCount: Number(raw.requestCount || 0)
    };
  }

  function getSettings() {
    settings = normalizeSettings(settings);
    return { ...settings };
  }

  function getToken() {
    try {
      return localStorage.getItem('gs_token') || '';
    } catch (_) {
      return '';
    }
  }

  function getGistId() {
    try {
      return localStorage.getItem('gs_gist_id') || '';
    } catch (_) {
      return '';
    }
  }

  function getValidatedGistId() {
    const gistId = getGistId().trim();
    if (!/^[a-f0-9]{20,64}$/i.test(gistId)) {
      throw new Error('Некорректный Gist ID');
    }
    return gistId;
  }

  function isConnected() {
    return Boolean(getToken() && getGistId());
  }

  function canStartRequest() {
    const t = now();
    let requestCountStartedAt = Number(settings.requestCountStartedAt || 0);
    let requestCount = Number(settings.requestCount || 0);

    if (!requestCountStartedAt || t - requestCountStartedAt > REQUEST_WINDOW_MS) {
      requestCountStartedAt = t;
      requestCount = 0;
      settings.requestCountStartedAt = requestCountStartedAt;
      settings.requestCount = 0;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    }

    const gapLeft = Math.max(0, MIN_REQUEST_GAP_MS - (t - Number(settings.lastRequestAt || 0)));
    if (gapLeft > 0) return { ok: false, retryAfterMs: gapLeft, reason: 'request_gap' };

    if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
      return {
        ok: false,
        retryAfterMs: Math.max(30_000, REQUEST_WINDOW_MS - (t - requestCountStartedAt)),
        reason: 'local_request_budget'
      };
    }

    settings.requestCountStartedAt = requestCountStartedAt;
    settings.requestCount = requestCount;
    return { ok: true };
  }

  function getRequestBudgetSnapshot() {
    const t = now();
    let requestCountStartedAt = Number(settings.requestCountStartedAt || 0);
    let requestCount = Number(settings.requestCount || 0);

    if (!requestCountStartedAt || t - requestCountStartedAt > REQUEST_WINDOW_MS) {
      requestCountStartedAt = t;
      requestCount = 0;
      settings.requestCountStartedAt = requestCountStartedAt;
      settings.requestCount = 0;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    }

    const remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - requestCount);
    const retryAfterMs = remaining > 0 ? 0 : Math.max(30_000, REQUEST_WINDOW_MS - (t - requestCountStartedAt));

    return {
      ok: remaining > 0,
      remaining,
      requestCount,
      requestCountStartedAt,
      retryAfterMs
    };
  }

  function noteRequestStarted() {
    const t = now();
    let requestCountStartedAt = Number(settings.requestCountStartedAt || 0);
    let requestCount = Number(settings.requestCount || 0);

    if (!requestCountStartedAt || t - requestCountStartedAt > REQUEST_WINDOW_MS) {
      requestCountStartedAt = t;
      requestCount = 0;
    }

    settings.lastRequestAt = t;
    settings.requestCountStartedAt = requestCountStartedAt;
    settings.requestCount = requestCount + 1;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] request budget save failed:', err);
    }
    renderModal();
  }

  function rollbackRequestCount() {
    settings.requestCount = Math.max(0, Number(settings.requestCount || 0) - 1);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] request budget rollback failed:', err);
    }
  }

  async function request(method, path, body) {
    const token = getToken();
    if (!token) throw new Error('not_connected');

    const budget = canStartRequest();
    if (!budget.ok) {
      const err = new Error(budget.reason || 'request_budget');
      err.localBudget = true;
      err.retryAfterMs = budget.retryAfterMs || 0;
      throw err;
    }
    noteRequestStarted();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);

    try {
      const res = await fetch('https://api.github.com' + path, {
        method,
        signal: ctrl.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });

      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = null; }

      if (!res.ok) {
        const message = parsed?.message || text || `GitHub HTTP ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        error.body = parsed || text;
        error.rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
        error.rateLimitReset = res.headers.get('x-ratelimit-reset');
        throw error;
      }

      return parsed;
    } catch (err) {
      rollbackRequestCount();
      if (err?.name === 'AbortError') {
        throw new Error('Таймаут запроса (15 с)');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function hashText(text) {
    if (window.Intelligence?.hashText) return window.Intelligence.hashText(text);
    if (window.PromptLoom?.hashText) return window.PromptLoom.hashText(text);
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function getBundle() {
    const userMemory = window.UserMemory?.exportData?.() ?? null;
    const projectGraph = window.ProjectGraph?.exportData?.() ?? null;
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: settings.lastPullAt || settings.lastPushAt || now(),
      updatedAt: now(),
      source: 'memory-sync',
      userMemory,
      projectGraph
    };
  }

  function stableUserMemoryForSync(userMemory) {
    const data = clone(userMemory || {});
    delete data.updatedAt;
    if (data.behavior && typeof data.behavior === 'object') {
      delete data.behavior.recentEvents;
    }
    if (data.counters && typeof data.counters === 'object') {
      delete data.counters.events;
      delete data.counters.sessions;
    }
    return data;
  }

  function stableProjectGraphForSync(projectGraph) {
    const data = clone(projectGraph || {});
    delete data.updatedAt;
    return data;
  }

  function stableBundleForSync(bundle) {
    return {
      schemaVersion: bundle?.schemaVersion || SCHEMA_VERSION,
      userMemory: bundle?.userMemory ? stableUserMemoryForSync(bundle.userMemory) : null,
      projectGraph: bundle?.projectGraph ? stableProjectGraphForSync(bundle.projectGraph) : null
    };
  }

  function createSyncPayload(bundle) {
    const stable = stableBundleForSync(bundle);
    return {
      schemaVersion: stable.schemaVersion,
      source: 'memory-sync',
      updatedAt: now(),
      userMemory: stable.userMemory,
      projectGraph: stable.projectGraph
    };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }

  function bundleHash(bundle) {
    return hashText(stableStringify(stableBundleForSync(bundle)));
  }

  function setLastError(message) {
    const lastError = String(message || '').slice(0, 240);
    saveSettings({ lastError, dirty: settings.dirty });
  }

  function isRateLimitError(err) {
    const message = String(err?.message || '').toLowerCase();
    const remaining = err?.rateLimitRemaining;

    if ((err?.status === 403 || err?.status === 429) && String(remaining) === '0') {
      return true;
    }

    return (err?.status === 403 || err?.status === 429) && (
      message.includes('rate limit') ||
      message.includes('secondary rate') ||
      message.includes('abuse detection') ||
      message.includes('too many requests')
    );
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ru'); } catch (_) { return String(ts); }
  }

  function getRateLimitLeftMs() {
    return Math.max(0, Number(settings.rateLimitedUntil || 0) - now());
  }

  function pauseAfterRateLimit(err, operation = 'push') {
    const resetMs = Number(err?.rateLimitReset || 0) * 1000;
    const until = resetMs && resetMs > now() ? Math.max(resetMs, now() + 5 * 60_000) : now() + RATE_LIMIT_PAUSE_MS;
    const message = 'GitHub API rate limit. Автоотправка памяти поставлена на паузу до ' + formatTime(until) + '.';
    clearTimeout(pushTimer);
    pushTimer = null;
    saveSettings({
      rateLimitedUntil: until,
      lastError: message,
      dirty: operation === 'push' ? true : settings.dirty
    });
    return { ok: false, error: err?.message || 'rate_limited', rateLimitedUntil: until };
  }

  function handleLocalBudgetError(err, operation, options = {}) {
    const retryAt = now() + Number(err?.retryAfterMs || 0);
    const message = operation === 'pull'
      ? 'Локальный лимит MemorySync: загрузка из Gist доступна после ' + formatTime(retryAt) + '.'
      : 'Локальный лимит MemorySync: отправка в Gist доступна после ' + formatTime(retryAt) + '.';
    setLastError(message);
    if (!options.silent) window.Toast?.show?.('MemorySync: запрос отложен локальным лимитом', 'warn');
    return {
      skipped: true,
      reason: err?.message || 'local_request_budget',
      retryAfterMs: Number(err?.retryAfterMs || 0)
    };
  }

  function getRequestAvailability() {
    const t = now();
    const rateLeft = getRateLimitLeftMs();
    const budget = getRequestBudgetSnapshot();
    const gapLeft = Math.max(0, MIN_REQUEST_GAP_MS - (t - Number(settings.lastRequestAt || 0)));

    if (!settings.enabled) return { ok: false, reason: 'disabled', budget, retryAfterMs: 0 };
    if (!isConnected()) return { ok: false, reason: 'not_connected', budget, retryAfterMs: 0 };
    if (rateLeft > 0) return { ok: false, reason: 'rate_limited', budget, retryAfterMs: rateLeft };
    if (gapLeft > 0) return { ok: false, reason: 'request_gap', budget, retryAfterMs: gapLeft };
    if (budget.remaining <= 0) return { ok: false, reason: 'local_request_budget', budget, retryAfterMs: budget.retryAfterMs };
    return { ok: true, reason: 'ready', budget, retryAfterMs: 0 };
  }

  function canUseRequestNow() {
    return getRequestAvailability().ok;
  }

  function markDirty(reason = '') {
    settings.dirty = true;
    if (reason) settings.lastError = String(reason).slice(0, 240);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] markDirty failed:', err);
    }
    renderModal();
  }

  function clearDirty() {
    settings.dirty = false;
    settings.lastError = '';
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] clearDirty failed:', err);
    }
    renderModal();
  }

  function summarizeStatus() {
    const connected = isConnected();
    const enabled = settings.enabled;
    const dirty = settings.dirty;
    const rateLeft = getRateLimitLeftMs();
    const budget = getRequestBudgetSnapshot();
    const lastPush = settings.lastPushAt ? new Date(settings.lastPushAt).toLocaleString('ru') : '—';
    const lastPull = settings.lastPullAt ? new Date(settings.lastPullAt).toLocaleString('ru') : '—';
    return {
      enabled,
      connected,
      dirty,
      rateLeft,
      budget,
      lastPush,
      lastPull,
      lastError: settings.lastError || '—'
    };
  }

  function ensureModal() {
    if (modal?.isConnected) return modal;

    modal = document.createElement('div');
    modal.id = 'memory-sync-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'memory-sync-title');
    modal.innerHTML = `
      <div class="modal-box modal-box-md">
        <div class="modal-header">
          <span class="modal-title" id="memory-sync-title">☁ Синхронизация памяти</span>
          <button type="button" class="modal-close" id="memory-sync-close" aria-label="Закрыть">✕</button>
        </div>
        <div class="modal-body" id="memory-sync-body"></div>
      </div>
    `;

    modal.addEventListener('click', e => {
      if (e.target === modal) closeDialog();
    });
    modal.querySelector('#memory-sync-close')?.addEventListener('click', closeDialog);
    document.body.appendChild(modal);
    return modal;
  }

  function renderModal() {
    if (!modal?.isConnected) return;

    const body = modal.querySelector('#memory-sync-body');
    if (!body) return;

    const status = summarizeStatus();
    const budget = getRequestBudgetSnapshot();
    const diagnostics = {
      user: window.UserMemory?.getDiagnostics?.() || null,
      graph: window.ProjectGraph?.getDiagnostics?.() || null
    };

    const requestAvailability = getRequestAvailability();
    const canRequest = requestAvailability.ok;
    const blockedHint = !canRequest && requestAvailability.reason === 'request_gap'
      ? `Новая операция доступна через ${Math.ceil(requestAvailability.retryAfterMs / 1000)} с.`
      : !canRequest && requestAvailability.reason === 'local_request_budget'
        ? `Локальная квота восстановится после ${formatTime(now() + requestAvailability.retryAfterMs)}.`
        : !canRequest && requestAvailability.reason === 'rate_limited'
          ? `GitHub rate limit: повтор после ${formatTime(settings.rateLimitedUntil)}.`
          : '';

    body.innerHTML = `
      <div class="gs-section">
        <div class="gs-status-line">
          <span class="gs-status-${status.enabled ? 'ok' : 'warn'}">${status.enabled ? 'Включено' : 'Выключено'}</span>
          <span class="gs-meta">${status.connected ? 'Gist подключён' : 'Gist не подключён'}</span>
          <span class="gs-dirty-badge">${status.dirty ? 'есть изменения' : 'синхронизировано'}</span>
        </div>
        <div class="gs-stats-row">
          <span>Последняя отправка: ${escapeHtml(status.lastPush)}</span>
          <span>Последняя загрузка: ${escapeHtml(status.lastPull)}</span>
          <span>Квота запросов: ${budget.remaining}/${MAX_REQUESTS_PER_WINDOW}</span>
        </div>
        <div class="gs-warn-box">Синхронизируются только безопасные метаданные: хэши, титулы, роли, счётчики и структуры. Полный текст не отправляется.</div>
      </div>

      <div class="gs-section">
        <div class="gs-field-row">
          <label class="gs-check-label"><input id="memory-sync-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}> Включить sync</label>
          <label class="gs-check-label"><input id="memory-sync-autopush" type="checkbox" ${settings.autoPush ? 'checked' : ''} ${settings.enabled ? '' : 'disabled'}> Auto push</label>
          <label class="gs-check-label"><input id="memory-sync-autopull" type="checkbox" ${settings.autoPull ? 'checked' : ''} ${settings.enabled ? '' : 'disabled'}> Auto pull</label>
        </div>
        <p class="gs-hint">Sync выключен по умолчанию и работает только после ручного включения.</p>
      </div>

      <div class="gs-section">
        <div class="gs-field-row">
          <button type="button" class="gs-btn gs-btn-primary" id="memory-sync-push" ${canRequest ? '' : 'disabled'}>Отправить сейчас</button>
          <button type="button" class="gs-btn" id="memory-sync-pull" ${canRequest ? '' : 'disabled'}>Загрузить из Gist</button>
          <button type="button" class="gs-btn" id="memory-sync-open-gist">Открыть GistSync</button>
        </div>
        ${blockedHint ? `<p class="gs-hint">${escapeHtml(blockedHint)}</p>` : ''}
      </div>

      <div class="gs-section">
        <div class="gs-section-title">Локальные метрики</div>
        <div class="gs-stats-row">
          <span>UserMemory: ${escapeHtml(diagnostics.user ? String(diagnostics.user.counters?.events || 0) : '—')} событий</span>
          <span>ProjectGraph: ${escapeHtml(diagnostics.graph ? String(diagnostics.graph.snapshots || 0) : '—')} snapshots</span>
          <span>Storage: ${escapeHtml(diagnostics.graph ? String(diagnostics.graph.estimatedBytes || 0) : '—')} bytes</span>
        </div>
      </div>

      ${status.lastError !== '—' ? `
      <div class="gs-section">
        <div class="gs-section-title">Последняя ошибка</div>
        <div class="gs-warn-box">${escapeHtml(status.lastError)}</div>
      </div>` : ''}
    `;

    body.querySelector('#memory-sync-enabled')?.addEventListener('change', e => {
      saveSettings({ enabled: e.target.checked });
      if (e.target.checked && settings.autoPull && isConnected()) {
        pull({ silent: true }).catch(() => {});
      }
    });
    body.querySelector('#memory-sync-autopush')?.addEventListener('change', e => saveSettings({ autoPush: e.target.checked }));
    body.querySelector('#memory-sync-autopull')?.addEventListener('change', e => saveSettings({ autoPull: e.target.checked }));
    body.querySelector('#memory-sync-push')?.addEventListener('click', () => push({ force: true }));
    body.querySelector('#memory-sync-pull')?.addEventListener('click', () => pull({ force: true }));
    body.querySelector('#memory-sync-open-gist')?.addEventListener('click', () => window.GistSync?.openDialog?.());
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function openDialog() {
    const el = ensureModal();
    renderModal();
    el.style.display = 'flex';
    el.querySelector('#memory-sync-close')?.focus();
  }

  function closeDialog() {
    if (!modal) return;
    modal.style.display = 'none';
  }

  function trackSyncEvent(type, payload = {}) {
    // Собственная телеметрия MemorySync не должна запускать новый sync-цикл.
    const prev = suppressSchedule;
    suppressSchedule = true;
    try {
      window.Intelligence?.track?.(type, payload);
    } finally {
      suppressSchedule = prev;
    }
  }

  function shouldToastSuccess(options = {}) {
    // Автоматическая синхронизация не должна постоянно отвлекать пользователя.
    return options.force === true || options.reason === 'manual';
  }

  async function push(options = {}) {
    if (pushInFlight) return pushInFlight;

    pushInFlight = (async () => {
      if (!settings.enabled) return { skipped: true, reason: 'disabled' };
      if (!isConnected()) {
        setLastError('GistSync не подключён');
        if (!options.silent) window.Toast?.show?.('MemorySync: сначала подключите GistSync', 'error');
        return { ok: false, error: 'not_connected' };
      }

      const rateLeft = getRateLimitLeftMs();
      if (rateLeft > 0) {
        const message = 'GitHub API rate limit. Повторная отправка доступна после ' + formatTime(settings.rateLimitedUntil) + '.';
        setLastError(message);
        if (!options.silent) window.Toast?.show?.('MemorySync: отправка на паузе из-за GitHub rate limit', 'warn');
        return { skipped: true, reason: 'rate_limited', retryAfterMs: rateLeft };
      }

      let bundle;
      let hash;

      try {
        bundle = getBundle();
        hash = bundleHash(bundle);

        const isManual = options.force === true || options.reason === 'manual';
        if (!isManual && settings.lastFailedPushHash === hash && settings.lastFailedPushAt && now() - settings.lastFailedPushAt < FAILED_HASH_PAUSE_MS) {
          return { skipped: true, reason: 'failed_hash_cooldown' };
        }
        if (hash === settings.lastPushHash) {
          if (settings.dirty) saveSettings({ dirty: false });
          return { skipped: true, reason: 'unchanged' };
        }

        const gistId = getValidatedGistId();
        const payload = createSyncPayload(bundle);
        const content = JSON.stringify(payload);
        assertPayloadSize(content);

        await request('PATCH', `/gists/${encodeURIComponent(gistId)}`, {
          files: { [FILE_NAME]: { content } }
        });

        saveSettings({
          lastPushAt: now(),
          lastPushHash: hash,
          lastError: '',
          rateLimitedUntil: 0,
          dirty: false,
          lastFailedPushHash: '',
          lastFailedPushAt: 0
        });
        if (shouldToastSuccess(options)) {
          window.Toast?.show?.('MemorySync: метаданные отправлены ✓', 'success');
        }
        trackSyncEvent('memory.sync.push', {
          chars: content.length,
          action: options.reason || 'push'
        });
        return { ok: true, hash };
      } catch (err) {
        if (err?.localBudget) {
          return handleLocalBudgetError(err, 'push', options);
        }
        if (isRateLimitError(err)) {
          const result = pauseAfterRateLimit(err, 'push');
          if (!options.silent) window.Toast?.show?.('MemorySync: GitHub rate limit, автоотправка временно на паузе', 'warn');
          return result;
        }
        setLastError(err?.message || 'Ошибка отправки');
        if (hash) {
          saveSettings({ lastFailedPushHash: hash, lastFailedPushAt: now(), dirty: true });
        } else {
          saveSettings({ dirty: true });
        }
        if (!options.silent) window.Toast?.show?.(`MemorySync: ${err?.message || 'Ошибка отправки'}`, 'error');
        return { ok: false, error: err?.message || 'push_failed' };
      }
    })();

    try {
      return await pushInFlight;
    } finally {
      pushInFlight = null;
    }
  }

  async function pull(options = {}) {
    if (pullInFlight) return pullInFlight;

    pullInFlight = (async () => {
      if (!settings.enabled) return { skipped: true, reason: 'disabled' };
      if (!isConnected()) {
        setLastError('GistSync не подключён');
        if (!options.silent) window.Toast?.show?.('MemorySync: сначала подключите GistSync', 'error');
        return { ok: false, error: 'not_connected' };
      }

      const isAuto = options.reason === 'init-auto-pull' || options.reason === 'auto-pull';
      if (isAuto && settings.lastAutoPullAt && now() - settings.lastAutoPullAt < AUTO_PULL_MIN_INTERVAL_MS) {
        return { skipped: true, reason: 'auto_pull_cooldown' };
      }

      try {
        const gistId = getValidatedGistId();
        const gist = await request('GET', `/gists/${encodeURIComponent(gistId)}`);

        const file = gist?.files?.[FILE_NAME];
        if (!file) throw new Error('Файл памяти не найден в gist');
        if (file.truncated) {
          throw new Error('Файл памяти в gist слишком большой или усечён GitHub API');
        }

        const raw = file.content;
        if (!raw) throw new Error('Файл памяти не найден в gist');

        assertPayloadSize(raw);

        const bundle = safeParse(raw);
        if (!bundle || typeof bundle !== 'object') throw new Error('Некорректный формат памяти');

        if (bundle.schemaVersion !== SCHEMA_VERSION) {
          throw new Error(`Неподдерживаемая версия памяти: ${bundle.schemaVersion || '—'}`);
        }

        const prevSuppressSchedule = suppressSchedule;
        suppressSchedule = true;
        let importedUserMemory = false;
        let importedProjectGraph = false;

        try {
          if (bundle.userMemory) {
            window.UserMemory?.importData?.(bundle.userMemory);
            importedUserMemory = true;
          }
          if (bundle.projectGraph) {
            window.ProjectGraph?.importData?.(bundle.projectGraph);
            importedProjectGraph = true;
          }
        } catch (importErr) {
          if (importedUserMemory || importedProjectGraph) {
            markDirty('MemorySync: pull применён частично, требуется проверка состояния');
          }
          throw importErr;
        } finally {
          suppressSchedule = prevSuppressSchedule;
        }

        const hash = bundleHash(getBundle());
        clearTimeout(pushTimer);
        pushTimer = null;
        saveSettings({
          lastPullAt: now(),
          lastAutoPullAt: isAuto ? now() : settings.lastAutoPullAt,
          lastPushHash: hash,
          lastError: '',
          dirty: false
        });
        if (!options.silent) window.Toast?.show?.('MemorySync: метаданные загружены ✓', 'success');
        trackSyncEvent('memory.sync.pull', {
          action: options.reason || 'pull'
        });
        return { ok: true, hash };
      } catch (err) {
        suppressSchedule = false;

        if (err?.localBudget) {
          return handleLocalBudgetError(err, 'pull', options);
        }

        if (isRateLimitError(err)) {
          const result = pauseAfterRateLimit(err, 'pull');
          if (!options.silent) window.Toast?.show?.('MemorySync: GitHub rate limit, загрузка временно на паузе', 'warn');
          return result;
        }
        setLastError(err?.message || 'Ошибка загрузки');
        if (!options.silent) window.Toast?.show?.(`MemorySync: ${err.message}`, 'error');
        return { ok: false, error: err?.message || 'pull_failed' };
      }
    })();

    try {
      return await pullInFlight;
    } finally {
      pullInFlight = null;
    }
  }

  function schedulePush(reason = 'auto') {
    if (suppressSchedule || !settings.enabled) return;

    settings.dirty = true;

    if (settings.autoPush === false || !AUTO_PUSH_ALLOWED_REASONS.has(reason) || getRateLimitLeftMs() > 0) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (err) {
        console.warn('[MemorySync] schedulePush save failed:', err);
      }
      renderModal();
      return;
    }

    const elapsedSinceLastPush = settings.lastPushAt ? now() - settings.lastPushAt : Infinity;
    const delay = Math.max(PUSH_DEBOUNCE_MS, AUTO_PUSH_MIN_INTERVAL_MS - elapsedSinceLastPush);

    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      push({ reason, silent: true }).catch(() => {});
    }, delay);

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[MemorySync] schedulePush persist failed:', err);
    }
    renderModal();
  }

  function flush() {
    clearTimeout(pushTimer);
    pushTimer = null;
    return push({ force: true, reason: 'flush' });
  }

  function scheduleAutoPullCheck() {
    clearTimeout(autoPullTimer);
    autoPullTimer = null;

    if (!settings.enabled || !settings.autoPull || !isConnected()) return;

    const elapsed = settings.lastAutoPullAt ? now() - settings.lastAutoPullAt : Infinity;
    const delay = elapsed >= AUTO_PULL_MIN_INTERVAL_MS
      ? 5_000
      : AUTO_PULL_MIN_INTERVAL_MS - elapsed;

    autoPullTimer = setTimeout(async () => {
      try {
        await pull({ reason: 'auto-pull', silent: true });
      } catch (_) {
        // pull() сам пишет lastError
      } finally {
        scheduleAutoPullCheck();
      }
    }, delay);
  }

  function wrapSaveHooks() {
    if (wrapped) return;
    wrapped = true;

    const wrap = (target, key, reason) => {
      if (!target || typeof target[key] !== 'function') return;
      const original = target[key];
      if (original.__memorySyncWrapped) return;
      const next = function (...args) {
        const result = original.apply(this, args);
        schedulePush(reason);
        return result;
      };
      next.__memorySyncWrapped = true;
      target[key] = next;
    };

    [
      'updateFeatureScore',
      'dismiss',
      'addSuccessfulStructure',
      'resetSuggestionLearning',
      'enableSuggestionType',
      'importData',
      'reset',
      'save'
    ].forEach(key => wrap(window.UserMemory, key, `user-memory:${key}`));

    [
      'captureSnapshot',
      'captureNamedVersion',
      'captureBaselineFromCurrent',
      'pinBaseline',
      'unpinBaseline',
      'setRetention',
      'cleanup',
      'importData',
      'reset',
      'save'
    ].forEach(key => wrap(window.ProjectGraph, key, `project-graph:${key}`));
  }

  function init() {
    settings = loadSettings();
    wrapSaveHooks();
    if (settings.enabled && settings.autoPull && isConnected()) {
      setTimeout(() => pull({ reason: 'init-auto-pull' }).catch(() => {}), 1000);
    }
    scheduleAutoPullCheck();
  }

  function maskGistId(value) {
    const id = String(value || '');
    if (id.length <= 8) return id ? '***' : '';
    return id.slice(0, 4) + '…' + id.slice(-4);
  }

  function getDiagnostics() {
    return {
      storageKey: SETTINGS_KEY,
      fileName: FILE_NAME,
      schemaVersion: SCHEMA_VERSION,
      ...summarizeStatus(),
      connected: isConnected(),
      gistId: maskGistId(getGistId()),
      tokenPresent: Boolean(getToken()),
      pending: Boolean(pushTimer)
    };
  }

  window.MemorySync = {
    init,
    openDialog,
    closeDialog,
    schedulePush,
    flush,
    push,
    pull,
    setEnabled(value) {
      return saveSettings({ enabled: Boolean(value) });
    },
    getSettings,
    getDiagnostics,
    isEnabled: () => getSettings().enabled,
    isConnected,
    hashText
  };
})();
