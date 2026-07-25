// file_name: smart-suggestions.js

/* ============================================================
   SmartSuggestions — тихая strip-панель prepared actions
   ============================================================ */
(function () {
  'use strict';

  const SHOWN_KEYS_LIMIT = 200; // предохранитель от роста Set в долгих сессиях

  let strip = null;
  let current = [];
  let menuSuggestions = [];
  let menuButton = null;
  let menuPanel = null;
  let reportModal = null;
  let diagnosticsModal = null;
  let lastFocusedBeforeReport = null;
  let lastFocusedBeforeDiagnostics = null;
  const shownKeys = new Set();

  function ensureStrip() {
    strip = document.getElementById('smart-suggestions-strip');
    if (!strip) {
      const previewBar = document.getElementById('preview-bar');
      strip = document.createElement('div');
      strip.id = 'smart-suggestions-strip';
      strip.className = 'smart-suggestions-strip';
      strip.hidden = true;
      strip.setAttribute('aria-live', 'polite');
      strip.setAttribute('aria-label', 'Умные подсказки');
      if (previewBar) {
        previewBar.insertAdjacentElement('afterend', strip);
      } else {
        document.body.appendChild(strip);
      }
    }
    return strip;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function formatDate(ts) {
    const n = Number(ts) || 0;
    if (!n) return '—';
    try { return new Date(n).toLocaleString(); } catch (_) { return String(n); }
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.round(Math.max(0, Math.min(1, n)) * 100) + '%';
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 Б';
    if (n < 1024) return `${Math.round(n)} Б`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
    return `${(n / 1024 / 1024).toFixed(2)} МБ`;
  }

  function readNumberInput(id, fallback, min, max) {
    const n = Number(document.getElementById(id)?.value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function readRetentionFromReport() {
    return {
      maxSnapshots: readNumberInput('pg-retention-snapshots', 80, 20, 500),
      maxBlockNodes: readNumberInput('pg-retention-blocks', 240, 80, 2000),
      maxRelations: readNumberInput('pg-retention-relations', 300, 80, 3000),
      maxAgeDays: readNumberInput('pg-retention-age', 0, 0, 365),
      preserveNamed: !!document.getElementById('pg-retention-preserve-named')?.checked,
      preserveBaselines: !!document.getElementById('pg-retention-preserve-baselines')?.checked,
      pruneUnreferencedBlocks: !!document.getElementById('pg-retention-prune-blocks')?.checked
    };
  }

  function trackShownKey(key) {
    if (!key || shownKeys.has(key)) return false;
    // ограничиваем размер Set, выкидывая самый старый ключ (FIFO)
    if (shownKeys.size >= SHOWN_KEYS_LIMIT) {
      const firstKey = shownKeys.values().next().value;
      if (firstKey !== undefined) shownKeys.delete(firstKey);
    }
    shownKeys.add(key);
    return true;
  }

  function ensureMenu() {
    if (menuButton?.isConnected && menuPanel?.isConnected) return { button: menuButton, panel: menuPanel };

    if (menuButton && !menuButton.isConnected) menuButton = null;
    if (menuPanel && !menuPanel.isConnected) menuPanel = null;

    const controls = document.querySelector('.preview-controls') || document.getElementById('preview-bar');
    if (!controls) return { button: null, panel: null };

    const existingButton = document.getElementById('smart-suggestions-menu-btn');
    const existingPanel = document.getElementById('smart-suggestions-menu');

    if (existingButton && existingPanel) {
      // оба элемента уже в DOM — адоптируем, чтобы не плодить дубликаты ID
      menuButton = existingButton;
      menuPanel = existingPanel;
      return { button: menuButton, panel: menuPanel };
    }

    // если в DOM застрял только один — удалим осиротевший, иначе при создании новых получим дубль ID
    existingButton?.remove();
    existingPanel?.remove();

    menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.id = 'smart-suggestions-menu-btn';
    menuButton.className = 'smart-menu-btn';
    menuButton.title = 'Intelligence status';
    menuButton.setAttribute('aria-label', 'Открыть умные подсказки');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.innerHTML = '<span aria-hidden="true">✨</span><span class="smart-menu-count">0</span>';

    menuPanel = document.createElement('div');
    menuPanel.id = 'smart-suggestions-menu';
    menuPanel.className = 'smart-suggestions-menu';
    menuPanel.hidden = true;

    menuButton.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu();
    });
    menuPanel.addEventListener('click', e => e.stopPropagation());

    if (!document.documentElement.dataset.smartSuggestionsGlobalEvents) {
      document.documentElement.dataset.smartSuggestionsGlobalEvents = '1';
      document.addEventListener('click', closeMenu);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          if (diagnosticsModal && !diagnosticsModal.hidden) { closeDiagnostics(); return; }
          if (reportModal && !reportModal.hidden) { closeReport(); return; }
          closeMenu();
          return;
        }
        // Enter в инпутах модала отправляет primary-действие, но только если модал реально виден
        if (
          e.key === 'Enter' &&
          reportModal &&
          !reportModal.hidden &&
          (e.target?.id === 'intelligence-version-name' || e.target?.id === 'intelligence-baseline-update-name')
        ) {
          const primary = reportModal.querySelector('.intelligence-report-footer button.primary');
          if (primary) {
            e.preventDefault();
            primary.click();
          }
        }
      });
    }

    controls.appendChild(menuButton);
    document.body.appendChild(menuPanel);
    return { button: menuButton, panel: menuPanel };
  }

  function render(suggestions = []) {
    const el = ensureStrip();
    current = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];

    if (!current.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    current.forEach(s => {
      const shownKey = `${s.type}:${s.contextKey || ''}:${s.preparedHash || s.id || ''}`;
      if (trackShownKey(shownKey)) {
        window.UserMemory?.updateFeatureScore?.(s.type, 'shown', s.contextKey);
      }
    });

    el.hidden = false;
    el.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'smart-suggestions-list';

    current.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'smart-suggestion' + (index === 0 ? ' primary' : '');
      item.dataset.id = suggestion.id;

      item.innerHTML = `
        <span class="smart-suggestion-icon" aria-hidden="true">✨</span>
        <span class="smart-suggestion-reason">${esc(suggestion.reason)}</span>
        <button type="button" class="smart-suggestion-action">${esc(suggestion.label || 'Открыть')}</button>
        <button type="button" class="smart-suggestion-dismiss">Не сейчас</button>
        <button type="button" class="smart-suggestion-hide" aria-label="Скрыть подсказку" title="Скрыть">×</button>
      `;

      item.querySelector('.smart-suggestion-action')?.addEventListener('click', () => {
        window.Intelligence?.acceptSuggestion?.(suggestion.id);
      });
      item.querySelector('.smart-suggestion-dismiss')?.addEventListener('click', () => {
        window.Intelligence?.dismissSuggestion?.(suggestion.id, false);
      });
      item.querySelector('.smart-suggestion-hide')?.addEventListener('click', () => {
        window.Intelligence?.dismissSuggestion?.(suggestion.id, true);
      });

      list.appendChild(item);
    });

    el.appendChild(list);
  }

  function closeMenu() {
    if (!menuPanel || !menuButton) return;
    if (menuPanel.hidden) return; // меню уже скрыто — нет смысла трогать атрибуты
    menuPanel.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const menu = ensureMenu();
    if (!menu.button || !menu.panel) return;
    const nextHidden = !menu.panel.hidden;
    menu.panel.hidden = nextHidden;
    menu.button.setAttribute('aria-expanded', String(!nextHidden));
    if (!nextHidden) {
      positionMenu();
      menu.panel.querySelector('button')?.focus();
    }
  }

  function positionMenu() {
    if (!menuButton || !menuPanel || menuPanel.hidden) return;
    const rect = menuButton.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(360, Math.max(220, window.innerWidth - margin * 2));
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width));

    menuPanel.style.width = width + 'px';
    menuPanel.style.left = left + 'px';
    menuPanel.style.maxHeight = '';

    const desiredHeight = Math.min(menuPanel.scrollHeight || menuPanel.offsetHeight || 0, 420);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const spaceAbove = Math.max(0, rect.top - margin - gap);
    const openAbove = spaceBelow < Math.min(desiredHeight, 180) && spaceAbove > spaceBelow;
    const available = Math.max(96, openAbove ? spaceAbove : spaceBelow);
    const finalHeight = Math.min(desiredHeight, available);
    const top = openAbove
      ? Math.max(margin, rect.top - gap - finalHeight)
      : Math.min(window.innerHeight - margin - finalHeight, rect.bottom + gap);

    menuPanel.style.maxHeight = Math.floor(available) + 'px';
    menuPanel.style.top = Math.max(margin, top) + 'px';
  }

  function updateMenu(suggestions = [], ctx = null) {
    const menu = ensureMenu();
    if (!menu.button || !menu.panel) return;
    menuSuggestions = Array.isArray(suggestions) ? suggestions.slice(0, 8) : [];
    const count = menu.button.querySelector('.smart-menu-count');
    if (count) count.textContent = String(menuSuggestions.length);
    menu.button.classList.toggle('has-items', menuSuggestions.length > 0);

    const title = ctx?.previewTokens ? `Intelligence · ~${ctx.previewTokens} токенов` : 'Intelligence';
    menu.panel.innerHTML = `
      <div class="smart-menu-head">
        <strong>${esc(title)}</strong>
        <span>${menuSuggestions.length ? 'Prepared actions' : 'Пока нет подходящих действий'}</span>
      </div>
      <div class="smart-menu-status"></div>
      <div class="smart-menu-list"></div>
    `;

    renderBaselineStatus(menu.panel, ctx);

    const list = menu.panel.querySelector('.smart-menu-list');
    if (!menuSuggestions.length) {
      const empty = document.createElement('div');
      empty.className = 'smart-menu-empty';
      empty.textContent = 'Я наблюдаю тихо и покажу действие, когда уверенность станет выше.';
      list.appendChild(empty);
      return;
    }

    menuSuggestions.forEach(suggestion => {
      const row = document.createElement('div');
      row.className = 'smart-menu-row';
      row.innerHTML = `
        <div class="smart-menu-row-main">
          <strong>${esc(suggestion.reason)}</strong>
          <span>${esc(suggestion.type)} · confidence ${Math.round((suggestion.confidence || 0) * 100)}%</span>
        </div>
        <button type="button">${esc(suggestion.label || 'Открыть')}</button>
      `;
      row.querySelector('button')?.addEventListener('click', () => {
        closeMenu();
        window.Intelligence?.acceptSuggestion?.(suggestion.id);
      });
      list.appendChild(row);
    });

    positionMenu();
  }

  function formatDelta(value, unit) {
    const n = Number(value) || 0;
    if (!n) return `0 ${unit}`;
    return `${n > 0 ? '+' : ''}${n} ${unit}`;
  }

  function summarizeBaselineDrift(drift) {
    const comparison = drift?.comparison || null;
    const diff = comparison?.diff || {};
    if (!comparison) return 'baseline закреплён';
    const blockDelta = Number(diff.blockDelta || 0);
    const tokenDelta = Number(diff.tokensDelta || 0);
    if (blockDelta) return `отличается на ${formatDelta(blockDelta, 'блоков')}`;
    if (tokenDelta) return `отличается на ${formatDelta(tokenDelta, 'токенов')}`;
    if (diff.titleDiff?.reordered || diff.roleDiff?.reordered) return 'изменён порядок блоков';
    return 'структура близка к baseline';
  }

  function renderBaselineStatus(container, ctx = null) {
    const box = container?.querySelector?.('.smart-menu-status');
    if (!box) return;

    const tab = window.State?.getActive?.();
    const baseline = ctx?.pinnedBaselineDrift?.baseline || window.ProjectGraph?.getPinnedBaseline?.(tab?.id || '') || null;
    const drift = ctx?.pinnedBaselineDrift || (baseline ? window.ProjectGraph?.comparePinnedBaselineToCurrent?.(tab, window.Preview?.getText?.() || '') : null);

    if (!baseline?.version) {
      box.innerHTML = `
        <div class="smart-menu-baseline is-empty">
          <div><strong>Baseline</strong><span>Не закреплён для текущей вкладки</span></div>
          <button type="button" data-smart-baseline-action="update">Сделать baseline</button>
        </div>
      `;
    } else {
      const version = baseline.version;
      box.innerHTML = `
        <div class="smart-menu-baseline">
          <div>
            <strong>Baseline: ${esc(version.name || baseline.name || 'Baseline')}</strong>
            <span>${esc(summarizeBaselineDrift(drift))}</span>
          </div>
          <div class="smart-menu-baseline-actions">
            <button type="button" data-smart-baseline-action="compare" ${drift?.comparison ? '' : 'disabled'}>Сравнить</button>
            <button type="button" data-smart-baseline-action="update">Обновить</button>
          </div>
        </div>
      `;
    }

    box.querySelector('[data-smart-baseline-action="compare"]')?.addEventListener('click', () => {
      closeMenu();
      if (drift?.comparison && window.Intelligence?.openPreparedReport) {
        window.Intelligence.openPreparedReport('pinned-baseline-drift', { pinnedBaselineDrift: drift });
        return;
      }
      window.Intelligence?.acceptSuggestion?.('pinned-baseline-compare');
    });

    box.querySelector('[data-smart-baseline-action="update"]')?.addEventListener('click', () => {
      closeMenu();
      openQuickBaselineUpdate();
    });
  }

  let positionMenuScheduled = false;
  function schedulePositionMenu() {
    if (positionMenuScheduled) return;
    positionMenuScheduled = true;
    requestAnimationFrame(() => {
      positionMenuScheduled = false;
      positionMenu();
    });
  }

  window.addEventListener('resize', schedulePositionMenu);
  window.addEventListener('scroll', schedulePositionMenu, { capture: true, passive: true });

  function ensureReportModal() {
    if (reportModal?.isConnected) return reportModal;

    reportModal = document.createElement('div');
    reportModal.className = 'intelligence-report-backdrop';
    reportModal.hidden = true;
    reportModal.innerHTML = `
      <section class="intelligence-report" role="dialog" aria-modal="true" aria-labelledby="intelligence-report-title">
        <header class="intelligence-report-header">
          <div>
            <h2 id="intelligence-report-title">Отчёт</h2>
            <p id="intelligence-report-subtitle"></p>
          </div>
          <button type="button" class="intelligence-report-close" aria-label="Закрыть">×</button>
        </header>
        <div class="intelligence-report-body"></div>
        <footer class="intelligence-report-footer"></footer>
      </section>
    `;

    reportModal.addEventListener('click', e => {
      if (e.target === reportModal) closeReport();
    });
    reportModal.querySelector('.intelligence-report-close')?.addEventListener('click', closeReport);

    document.body.appendChild(reportModal);
    return reportModal;
  }

  function button(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className || '';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderLines(body, lines) {
    const list = document.createElement('div');
    list.className = 'intelligence-report-list';
    (lines || []).forEach(line => {
      const item = document.createElement('div');
      item.className = 'intelligence-report-line';
      item.textContent = line;
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  function openReport(options = {}) {
    const modal = ensureReportModal();
    const title = modal.querySelector('#intelligence-report-title');
    const subtitle = modal.querySelector('#intelligence-report-subtitle');
    const body = modal.querySelector('.intelligence-report-body');
    const footer = modal.querySelector('.intelligence-report-footer');

    title.textContent = options.title || 'Отчёт';
    subtitle.textContent = options.subtitle || '';
    body.innerHTML = '';
    footer.innerHTML = '';

    if (typeof options.renderBody === 'function') {
      options.renderBody(body);
    } else {
      renderLines(body, options.lines || []);
    }

    (options.actions || []).forEach(action => {
      footer.appendChild(button(action.label, action.className, () => {
        const result = action.onClick?.();
        if (result !== false) closeReport();
      }));
    });
    footer.appendChild(button('Закрыть', 'secondary', closeReport));

    // запоминаем фокус, чтобы вернуть его после закрытия модала
    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeEl || !modal.contains(activeEl)) {
      lastFocusedBeforeReport = activeEl;
    }
    modal.hidden = false;
    modal.querySelector('.intelligence-report-close')?.focus();
  }

  function closeReport() {
    if (!reportModal || reportModal.hidden) return;
    reportModal.hidden = true;
    if (lastFocusedBeforeReport && lastFocusedBeforeReport.isConnected) {
      try { lastFocusedBeforeReport.focus(); } catch (_) { /* ignore */ }
    }
    lastFocusedBeforeReport = null;
  }

  function ensureDiagnosticsModal() {
    if (diagnosticsModal?.isConnected) return diagnosticsModal;

    diagnosticsModal = document.createElement('div');
    diagnosticsModal.className = 'intelligence-report-backdrop intelligence-diagnostics-backdrop';
    diagnosticsModal.hidden = true;
    diagnosticsModal.innerHTML = `
      <section class="intelligence-report intelligence-diagnostics" role="dialog" aria-modal="true" aria-labelledby="intelligence-diagnostics-title">
        <header class="intelligence-report-header">
          <div>
            <h2 id="intelligence-diagnostics-title">Intelligence diagnostics</h2>
            <p id="intelligence-diagnostics-subtitle">Локальный профиль хранится только в этом браузере.</p>
          </div>
          <button type="button" class="intelligence-report-close" aria-label="Закрыть">×</button>
        </header>
        <div class="intelligence-report-body intelligence-diagnostics-body"></div>
        <footer class="intelligence-report-footer intelligence-diagnostics-footer"></footer>
      </section>
    `;

    diagnosticsModal.addEventListener('click', e => {
      if (e.target === diagnosticsModal) closeDiagnostics();
    });
    diagnosticsModal.querySelector('.intelligence-report-close')?.addEventListener('click', closeDiagnostics);
    document.body.appendChild(diagnosticsModal);
    return diagnosticsModal;
  }

  function diagnosticsMetric(label, value) {
    return `<div class="intelligence-diagnostics-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function renderDiagnosticsBody(body, data, ctx, projectGraph = null) {
    const counters = data.counters || {};
    const scores = data.personalScores || {};
    const visible = window.Intelligence?.getSuggestions?.() || [];
    const menu = window.Intelligence?.getMenuSuggestions?.() || [];
    const activeTypes = [...visible, ...menu].map(s => s.type).filter(Boolean);

    body.innerHTML = `
      <div class="intelligence-diagnostics-grid">
        ${diagnosticsMetric('События', counters.events || 0)}
        ${diagnosticsMetric('Сессии', counters.sessions || 0)}
        ${diagnosticsMetric('Принято', counters.acceptedSuggestions || 0)}
        ${diagnosticsMetric('Отклонено', counters.dismissedSuggestions || 0)}
        ${diagnosticsMetric('Скрыто', counters.ignoredSuggestions || 0)}
        ${diagnosticsMetric('Recent log', data.recentEvents || 0)}
        ${diagnosticsMetric('Prepared actions', activeTypes.length)}
        ${diagnosticsMetric('Finality', pct(ctx?.finalityScore || 0))}
      </div>

      <div class="intelligence-diagnostics-section">
        <h3>Локальный профиль</h3>
        <p><strong>Storage:</strong> ${esc(data.storageKey)}</p>
        <p><strong>Создан:</strong> ${esc(formatDate(data.createdAt))}</p>
        <p><strong>Обновлён:</strong> ${esc(formatDate(data.updatedAt))}</p>
        <p><strong>Успешных структур:</strong> ${esc(data.successfulStructures || 0)}</p>
      </div>

      ${projectGraph ? `
      <div class="intelligence-diagnostics-section">
        <h3>ProjectGraph</h3>
        <p><strong>Storage:</strong> ${esc(projectGraph.storageKey)}</p>
        <p><strong>Snapshots:</strong> ${esc(projectGraph.snapshots || 0)} · <strong>Named:</strong> ${esc(projectGraph.namedSnapshots || 0)} · <strong>Baselines:</strong> ${esc(projectGraph.pinnedBaselines || 0)} · <strong>Block nodes:</strong> ${esc(projectGraph.blockNodes || 0)}</p>
            ${projectGraph.activeBaseline?.version ? `<p><strong>Active baseline:</strong> ${esc(projectGraph.activeBaseline.version.name || projectGraph.activeBaseline.name || 'Baseline')} · ${esc(formatDate(projectGraph.activeBaseline.pinnedAt))}</p>` : ''}
        <p><strong>often_with:</strong> ${esc(projectGraph.oftenWith || 0)} · <strong>derived_from:</strong> ${esc(projectGraph.derivedFrom || 0)} · <strong>Storage size:</strong> ${esc(formatBytes(projectGraph.estimatedBytes || 0))}</p>
        <p><strong>Retention:</strong> snapshots ${esc(projectGraph.retention?.maxSnapshots ?? '—')} · blocks ${esc(projectGraph.retention?.maxBlockNodes ?? '—')} · relations ${esc(projectGraph.retention?.maxRelations ?? '—')} · age ${esc(projectGraph.retention?.maxAgeDays ?? 0)}d</p>
        <p><strong>Semantic aliases:</strong> ${esc(projectGraph.semanticTitleAliases || 0)} roles</p>
        ${(projectGraph.recentDerivedFrom || []).length ? `
          <p><strong>Recent versions:</strong></p>
          <ul class="intelligence-diagnostics-list">
            ${(projectGraph.recentDerivedFrom || []).map(item => `<li>${esc(item.fromTabName || 'Вкладка')} → ${esc(item.toTabName || 'Вкладка')} · ${esc(item.count || 0)}× · ${esc(formatDate(item.lastSeenAt))}</li>`).join('')}
          </ul>
        ` : ''}
      </div>` : ''}

      <div class="intelligence-diagnostics-section">
        <h3>Personal scores</h3>
        <div class="intelligence-diagnostics-tags">
          <span>decisiveness ${esc(pct(scores.decisiveness))}</span>
          <span>chaos ${esc(pct(scores.chaos))}</span>
          <span>reuse ${esc(pct(scores.reuse))}</span>
          <span>discipline ${esc(pct(scores.promptDiscipline))}</span>
          <span>finishing ${esc(pct(scores.finishing))}</span>
        </div>
      </div>

      <div class="intelligence-diagnostics-section">
        <h3>Suggestion learning</h3>
        <div class="intelligence-diagnostics-table" role="table" aria-label="Статистика подсказок"></div>
      </div>
    `;

    const table = body.querySelector('.intelligence-diagnostics-table');
    // клонируем массив, чтобы не мутировать источник из UserMemory.getDiagnostics()
    const types = [...(data.suggestionTypes || [])].sort((a, b) => (b.shown || 0) - (a.shown || 0));
    if (!types.length) {
      table.innerHTML = '<div class="intelligence-diagnostics-empty">Пока нет статистики подсказок.</div>';
    } else {
      types.forEach(item => {
        const disabled = (data.disabledTypes || []).includes(item.type);
        const row = document.createElement('div');
        row.className = 'intelligence-diagnostics-row';
        row.innerHTML = `
          <div>
            <strong>${esc(item.type)}</strong>
            <span>shown ${esc(Number(item.shown) || 0)} · accepted ${esc(Number(item.accepted) || 0)} · dismissed ${esc(Number(item.dismissed) || 0)} · ignored ${esc(Number(item.ignored) || 0)}</span>
          </div>
          <div class="intelligence-diagnostics-row-actions">
            <span class="${disabled ? 'is-disabled' : ''}">${disabled ? 'disabled' : 'score ' + pct(item.score)}</span>
            ${disabled ? '<button type="button" data-enable-type="' + esc(item.type) + '">Включить</button>' : ''}
          </div>
        `;
        row.querySelector('[data-enable-type]')?.addEventListener('click', () => {
          window.UserMemory?.enableSuggestionType?.(item.type);
          window.Intelligence?.refresh?.();
          renderDiagnostics();
        });
        table.appendChild(row);
      });
    }
  }

  function renderDiagnostics() {
    const modal = ensureDiagnosticsModal();
    const body = modal.querySelector('.intelligence-diagnostics-body');
    const footer = modal.querySelector('.intelligence-diagnostics-footer');
    const data = window.UserMemory?.getDiagnostics?.() || {};
    const ctx = window.Intelligence?.getContext?.() || null;
    const projectGraph = window.ProjectGraph?.getDiagnostics?.() || null;

    renderDiagnosticsBody(body, data, ctx, projectGraph);
    footer.innerHTML = '';
    footer.appendChild(button('Обновить', 'secondary', () => {
      window.Intelligence?.refresh?.();
      renderDiagnostics();
    }));
    footer.appendChild(button('Сбросить обучение подсказок', 'secondary danger', () => {
      if (!confirm('Сбросить статистику и cooldown подсказок? Тексты и проект не будут затронуты.')) return false;
      window.UserMemory?.resetSuggestionLearning?.();
      shownKeys.clear();
      window.Intelligence?.refresh?.();
      renderDiagnostics();
      window.Toast?.show?.('Обучение подсказок сброшено', 'success');
      return false;
    }));
    footer.appendChild(button('Сбросить весь профиль', 'secondary danger', () => {
      if (!confirm('Полностью сбросить локальный Intelligence profile? Проект, блоки и сниппеты не будут удалены.')) return false;
      window.UserMemory?.reset?.();
      shownKeys.clear();
      window.Intelligence?.refresh?.();
      renderDiagnostics();
      window.Toast?.show?.('Intelligence profile сброшен', 'success');
      return false;
    }));
    if (window.ProjectGraph?.cleanup) {
      footer.appendChild(button('Очистка ProjectGraph', 'secondary', () => {
        closeDiagnostics();
        openProjectGraphCleanup();
      }));
    }
    if (window.ProjectGraph?.reset) {
      footer.appendChild(button('Сбросить ProjectGraph', 'secondary danger', () => {
        if (!confirm('Сбросить локальную карту проекта ProjectGraph? Тексты проекта не будут удалены.')) return false;
        window.ProjectGraph.reset();
        window.Intelligence?.refresh?.();
        renderDiagnostics();
        window.Toast?.show?.('ProjectGraph сброшен', 'success');
        return false;
      }));
    }
    footer.appendChild(button('Закрыть', 'secondary', closeDiagnostics));
  }

  function openSaveVersion() {
    const tab = window.State?.getActive?.();
    const text = window.Preview?.getText?.() || '';
    if (!tab || !String(text).trim()) {
      window.Toast?.show?.('Нет содержимого для сохранения версии', 'warning');
      return false;
    }

    const defaultName = `${tab.name || 'Вкладка'} · ${new Date().toLocaleString()}`.slice(0, 80);
    const recent = window.ProjectGraph?.getNamedVersions?.(tab.id) || [];

    openReport({
      title: 'Сохранить версию структуры',
      subtitle: 'Будут сохранены только названия блоков, роли, размеры и fingerprints. Полный текст не сохраняется.',
      renderBody(body) {
        body.innerHTML = `
          <div class="intelligence-placement-box">
            <label for="intelligence-version-name"><strong>Название версии</strong></label>
            <input id="intelligence-version-name" class="intelligence-version-input" type="text" maxlength="80" value="${esc(defaultName)}" autocomplete="off">
            <small>Например: “До сжатия”, “Финальная структура”, “Вариант для API”.</small>
          </div>
          ${recent.length ? `
            <div class="intelligence-report-section">
              <strong>Недавние именованные версии</strong>
              <div class="intelligence-report-list">
                ${recent.slice(0, 5).map(item => `<div class="intelligence-report-line">${esc(item.name || 'Версия')} · ${esc(formatDate(item.ts))} · ${esc(item.blockTitles?.join(' → ') || item.structureSignature || '—')}</div>`).join('')}
              </div>
            </div>
          ` : ''}
        `;
        setTimeout(() => body.querySelector('#intelligence-version-name')?.focus(), 0);
      },
      actions: [{
        label: 'Сохранить версию',
        className: 'primary',
        onClick: () => {
          const input = document.getElementById('intelligence-version-name');
          const name = String(input?.value || '').trim();
          if (!name) {
            window.Toast?.show?.('Введите название версии', 'warning');
            input?.focus();
            return false;
          }
          const snapshot = window.ProjectGraph?.captureNamedVersion?.(name);
          if (!snapshot) {
            window.Toast?.show?.('Версию не удалось сохранить: нет preview-текста', 'warning');
            return false;
          }
          window.Intelligence?.track?.('projectGraph.namedVersion.captured', {
            chars: 0,
            tabId: snapshot.tabId || '',
            tabName: snapshot.tabName || '',
            title: snapshot.name || name,
            textHash: snapshot.textHash || '',
            sectionCount: snapshot.blockCount || 0
          });
          window.Intelligence?.refresh?.();
          window.Toast?.show?.('Версия структуры сохранена', 'success');
          return true;
        }
      }]
    });
    return true;
  }

  function renderNamedVersionSummary(version) {
    if (!version) return '—';
    const name = version.name || 'Версия';
    const structure = version.blockTitles?.join(' → ') || version.structureSignature || '—';
    return `${name} · ${formatDate(version.ts)} · ${structure}`;
  }

  function diffLine(label, items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    return `${label}: ${list.length ? list.join(', ') : '—'}`;
  }

  function openQuickBaselineUpdate() {
    const tab = window.State?.getActive?.();
    const text = window.Preview?.getText?.() || '';
    if (!tab || !String(text).trim()) {
      window.Toast?.show?.('Нет содержимого для baseline', 'warning');
      return false;
    }

    const currentBaseline = window.ProjectGraph?.getPinnedBaseline?.(tab.id) || null;
    const defaultName = `Baseline · ${tab.name || 'Вкладка'} · ${new Date().toLocaleString()}`.slice(0, 80);

    openReport({
      title: 'Сделать текущую структуру baseline',
      subtitle: 'Будет создана новая именованная версия структуры и сразу закреплена как baseline. Полный текст не сохраняется.',
      renderBody(body) {
        body.innerHTML = `
          <div class="intelligence-placement-box">
            <label for="intelligence-baseline-update-name"><strong>Название новой baseline-версии</strong></label>
            <input id="intelligence-baseline-update-name" class="intelligence-version-input" type="text" maxlength="80" value="${esc(defaultName)}" autocomplete="off">
            <small>Текущая структура будет сохранена как именованная версия и закреплена baseline для этой вкладки.</small>
          </div>
          <div class="intelligence-report-section">
            <strong>Сейчас</strong>
            <div class="intelligence-report-line">Вкладка: ${esc(tab.name || 'без имени')} · символов: ${esc(text.length)} · блоков: ${esc(tab.blocks?.length || 0)}</div>
            <div class="intelligence-report-line">Текущий baseline: ${currentBaseline?.version ? esc(renderNamedVersionSummary(currentBaseline.version)) : 'не закреплён'}</div>
          </div>
        `;
        setTimeout(() => body.querySelector('#intelligence-baseline-update-name')?.focus(), 0);
      },
      actions: [{
        label: 'Сохранить и закрепить baseline',
        className: 'primary',
        onClick: () => {
          const input = document.getElementById('intelligence-baseline-update-name');
          const name = String(input?.value || '').trim();
          if (!name) {
            window.Toast?.show?.('Введите название baseline', 'warning');
            input?.focus();
            return false;
          }
          const result = window.ProjectGraph?.captureBaselineFromCurrent?.(name);
          if (!result?.snapshot || !result?.baseline) {
            window.Toast?.show?.('Baseline не удалось обновить', 'warning');
            return false;
          }
          window.Intelligence?.track?.('projectGraph.baseline.updatedFromCurrent', {
            chars: 0,
            tabId: result.snapshot.tabId || tab.id,
            tabName: result.snapshot.tabName || tab.name || '',
            title: result.snapshot.name || name,
            textHash: result.snapshot.textHash || '',
            sectionCount: result.snapshot.blockCount || 0
          });
          window.Intelligence?.refresh?.();
          window.Toast?.show?.('Текущая структура закреплена baseline', 'success');
          return true;
        }
      }]
    });
    return true;
  }

  function openBaselineManager() {
    const tab = window.State?.getActive?.();
    const versions = window.ProjectGraph?.getNamedVersions?.(tab?.id || '') || [];
    const currentBaseline = window.ProjectGraph?.getPinnedBaseline?.(tab?.id || '') || null;
    if (!tab) return false;
    if (!versions.length) {
      window.Toast?.show?.('Сначала сохраните хотя бы одну именованную версию структуры', 'warning');
      return false;
    }

    openReport({
      title: 'Baseline структуры',
      subtitle: 'Закрепите именованную версию как базу сравнения. Полный текст не хранится и не восстанавливается.',
      renderBody(body) {
        const options = versions.map(version => `<option value="${esc(version.id)}">${esc(version.name || 'Версия')} · ${esc(formatDate(version.ts))}</option>`).join('');
        body.innerHTML = `
          <div class="intelligence-placement-box">
            <label for="intelligence-baseline-version"><strong>Версия baseline</strong></label>
            <select id="intelligence-baseline-version" class="intelligence-placement-select">${options}</select>
            <small>Intelligence будет сравнивать текущую структуру именно с этой версией, а не с последней подходящей.</small>
          </div>
          <div class="intelligence-report-section">
            <strong>Текущий baseline</strong>
            <div class="intelligence-report-line">${currentBaseline?.version ? esc(renderNamedVersionSummary(currentBaseline.version)) : 'Baseline не закреплён.'}</div>
          </div>
        `;
        const select = body.querySelector('#intelligence-baseline-version');
        if (select && currentBaseline?.version?.id) select.value = currentBaseline.version.id;
      },
      actions: [
        {
          label: 'Закрепить baseline',
          className: 'primary',
          onClick: () => {
            const versionId = document.getElementById('intelligence-baseline-version')?.value || '';
            const baseline = window.ProjectGraph?.pinBaseline?.(versionId, tab.id);
            if (!baseline) {
              window.Toast?.show?.('Baseline не удалось закрепить', 'warning');
              return false;
            }
            window.Intelligence?.track?.('projectGraph.baseline.pinned', {
              chars: 0,
              tabId: tab.id,
              tabName: tab.name || '',
              title: baseline.version?.name || baseline.name || 'Baseline',
              textHash: baseline.version?.textHash || baseline.textHash || '',
              sectionCount: baseline.version?.blockCount || 0
            });
            window.Intelligence?.refresh?.();
            window.Toast?.show?.('Baseline закреплён', 'success');
            return true;
          }
        },
        ...(currentBaseline?.version ? [{
          label: 'Снять baseline',
          className: 'secondary danger',
          onClick: () => {
            const ok = window.ProjectGraph?.unpinBaseline?.(tab.id);
            if (!ok) return false;
            window.Intelligence?.track?.('projectGraph.baseline.unpinned', {
              chars: 0,
              tabId: tab.id,
              tabName: tab.name || '',
              title: currentBaseline.version?.name || currentBaseline.name || 'Baseline',
              textHash: currentBaseline.version?.textHash || currentBaseline.textHash || '',
              sectionCount: 1
            });
            window.Intelligence?.refresh?.();
            window.Toast?.show?.('Baseline снят', 'success');
            return true;
          }
        }] : [])
      ]
    });
    return true;
  }

  function openNamedVersionCompare() {
    const tab = window.State?.getActive?.();
    const versions = window.ProjectGraph?.getNamedVersions?.(tab?.id || '') || [];
    if (versions.length < 2) {
      window.Toast?.show?.('Нужно минимум две именованные версии текущей вкладки', 'warning');
      return false;
    }

    const newest = versions[0];
    const previous = versions[1];

    openReport({
      title: 'Сравнить именованные версии',
      subtitle: 'Сравнение privacy-safe: используются только названия, роли, размеры и fingerprints. Полный текст не показывается и не хранится.',
      renderBody(body) {
        const options = versions.map(version => `<option value="${esc(version.id)}">${esc(version.name || 'Версия')} · ${esc(formatDate(version.ts))}</option>`).join('');
        body.innerHTML = `
          <div class="intelligence-compare-grid">
            <label><strong>Версия A</strong><select id="intelligence-compare-from" class="intelligence-placement-select">${options}</select></label>
            <label><strong>Версия B</strong><select id="intelligence-compare-to" class="intelligence-placement-select">${options}</select></label>
          </div>
          <div id="intelligence-compare-preview" class="intelligence-report-section"></div>
        `;

        const fromSelect = body.querySelector('#intelligence-compare-from');
        const toSelect = body.querySelector('#intelligence-compare-to');
        if (fromSelect) fromSelect.value = previous.id;
        if (toSelect) toSelect.value = newest.id;

        const renderPreview = () => {
          const preview = body.querySelector('#intelligence-compare-preview');
          const comparison = window.ProjectGraph?.compareNamedVersions?.(fromSelect?.value, toSelect?.value);
          if (!preview) return;
          if (!comparison) {
            preview.innerHTML = '<div class="intelligence-report-line">Выберите две разные версии.</div>';
            return;
          }
          const diff = comparison.diff || {};
          const roleAdded = (diff.roleDiff?.added || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
          const roleRemoved = (diff.roleDiff?.removed || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
          preview.innerHTML = `
            <strong>Preview diff</strong>
            <div class="intelligence-report-list">
              <div class="intelligence-report-line">A: ${esc(renderNamedVersionSummary(comparison.from))}</div>
              <div class="intelligence-report-line">B: ${esc(renderNamedVersionSummary(comparison.to))}</div>
              <div class="intelligence-report-line">Сходство структуры: ${esc(Math.round((comparison.score || diff.structureScore || 0) * 100) + '%')} · блоков ${esc(comparison.from.blockCount || 0)} → ${esc(comparison.to.blockCount || 0)} (${diff.blockDelta > 0 ? '+' : ''}${esc(diff.blockDelta || 0)}) · токенов ~${esc(comparison.from.tokens || 0)} → ~${esc(comparison.to.tokens || 0)} (${diff.tokensDelta > 0 ? '+' : ''}${esc(diff.tokensDelta || 0)})</div>
              <div class="intelligence-report-line">${esc(diffLine('Добавлены блоки', diff.titleDiff?.added))}<br>${esc(diffLine('Удалены блоки', diff.titleDiff?.removed))}</div>
              <div class="intelligence-report-line">${esc(diffLine('Добавлены роли', roleAdded))}<br>${esc(diffLine('Удалены роли', roleRemoved))}</div>
              ${(diff.titleDiff?.reordered || diff.roleDiff?.reordered) ? '<div class="intelligence-report-line">Порядок блоков/ролей изменился без явных добавлений или удалений.</div>' : ''}
            </div>
          `;
        };

        fromSelect?.addEventListener('change', renderPreview);
        toSelect?.addEventListener('change', renderPreview);
        renderPreview();
      },
      actions: [{
        label: 'Записать просмотр diff',
        className: 'primary',
        onClick: () => {
          const fromId = document.getElementById('intelligence-compare-from')?.value || '';
          const toId = document.getElementById('intelligence-compare-to')?.value || '';
          const comparison = window.ProjectGraph?.compareNamedVersions?.(fromId, toId);
          if (!comparison) {
            window.Toast?.show?.('Выберите две разные версии', 'warning');
            return false;
          }
          window.Intelligence?.track?.('projectGraph.namedVersion.compare.opened', {
            chars: 0,
            tabId: comparison.to?.tabId || comparison.from?.tabId || '',
            tabName: comparison.tabName || '',
            sectionCount: 2,
            textHash: `${comparison.from?.textHash || ''}->${comparison.to?.textHash || ''}`
          });
          window.Toast?.show?.('Diff просмотрен', 'success');
          return true;
        }
      }]
    });
    return true;
  }

  function openProjectGraphCleanup() {
    if (!window.ProjectGraph?.getDiagnostics || !window.ProjectGraph?.cleanup) {
      window.Toast?.show?.('ProjectGraph недоступен', 'warning');
      return false;
    }

    const diagnostics = window.ProjectGraph.getDiagnostics();
    const retention = window.ProjectGraph.getRetention?.() || diagnostics.retention || {};

    openReport({
      title: 'Очистка ProjectGraph',
      subtitle: 'Настройки retention применяются только к privacy-safe fingerprints, версиям и связям. Текст проекта не удаляется.',
      renderBody(body) {
        body.innerHTML = `
          <div class="intelligence-diagnostics-grid">
            ${diagnosticsMetric('Snapshots', diagnostics.snapshots || 0)}
            ${diagnosticsMetric('Named', diagnostics.namedSnapshots || 0)}
            ${diagnosticsMetric('Block nodes', diagnostics.blockNodes || 0)}
            ${diagnosticsMetric('Relations', Number(diagnostics.oftenWith || 0) + Number(diagnostics.derivedFrom || 0))}
            ${diagnosticsMetric('Storage', formatBytes(diagnostics.estimatedBytes || 0))}
          </div>

          <div class="intelligence-cleanup-grid">
            <label><strong>Max snapshots</strong><input id="pg-retention-snapshots" class="intelligence-version-input" type="number" min="20" max="500" step="10" value="${esc(retention.maxSnapshots || 80)}"></label>
            <label><strong>Max block nodes</strong><input id="pg-retention-blocks" class="intelligence-version-input" type="number" min="80" max="2000" step="20" value="${esc(retention.maxBlockNodes || 240)}"></label>
            <label><strong>Max relations</strong><input id="pg-retention-relations" class="intelligence-version-input" type="number" min="80" max="3000" step="50" value="${esc(retention.maxRelations || 300)}"></label>
            <label><strong>Max age, days</strong><input id="pg-retention-age" class="intelligence-version-input" type="number" min="0" max="365" step="1" value="${esc(retention.maxAgeDays || 0)}"></label>
          </div>

          <div class="intelligence-cleanup-options">
            <label><input id="pg-retention-preserve-named" type="checkbox" ${retention.preserveNamed !== false ? 'checked' : ''}> Сохранять именованные версии сверх лимита</label>
            <label><input id="pg-retention-preserve-baselines" type="checkbox" ${retention.preserveBaselines !== false ? 'checked' : ''}> Сохранять закреплённые baseline-версии</label>
            <label><input id="pg-retention-prune-blocks" type="checkbox" ${retention.pruneUnreferencedBlocks === true ? 'checked' : ''}> Удалять block nodes без ссылок из оставшихся snapshots</label>
          </div>

          <div class="intelligence-report-section">
            <strong>Privacy note</strong>
            <div class="intelligence-report-line">ProjectGraph хранит hashes, роли, названия блоков, размеры и связи. Полный текст блоков не хранится.</div>
          </div>
        `;
      },
      actions: [
        {
          label: 'Применить retention',
          className: 'primary',
          onClick: () => {
            const next = readRetentionFromReport();
            const result = window.ProjectGraph.cleanup({ retention: next });
            window.Intelligence?.track?.('projectGraph.cleanup.applied', {
              chars: 0,
              sectionCount: Number(result?.removed?.snapshots || 0) + Number(result?.removed?.blockNodes || 0) + Number(result?.removed?.relations || 0)
            });
            window.Intelligence?.refresh?.();
            window.Toast?.show?.(`ProjectGraph очищен: snapshots −${result?.removed?.snapshots || 0}, blocks −${result?.removed?.blockNodes || 0}`, 'success');
            return true;
          }
        },
        {
          label: 'Только сохранить настройки',
          className: 'secondary',
          onClick: () => {
            window.ProjectGraph.setRetention?.(readRetentionFromReport());
            window.Toast?.show?.('Retention настройки сохранены', 'success');
            return true;
          }
        }
      ]
    });
    return true;
  }

  function openDiagnostics() {
    const modal = ensureDiagnosticsModal();
    renderDiagnostics();
    if (modal.hidden) {
      lastFocusedBeforeDiagnostics = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    modal.hidden = false;
    modal.querySelector('.intelligence-report-close')?.focus();
  }

  function closeDiagnostics() {
    if (!diagnosticsModal || diagnosticsModal.hidden) return;
    diagnosticsModal.hidden = true;
    if (lastFocusedBeforeDiagnostics && lastFocusedBeforeDiagnostics.isConnected) {
      try { lastFocusedBeforeDiagnostics.focus(); } catch (_) { /* ignore */ }
    }
    lastFocusedBeforeDiagnostics = null;
  }

  function hideAll() {
    const el = ensureStrip();
    // копируем массив, чтобы dismissSuggestion не повлиял на итерацию через цепочку refresh
    const snapshot = current.slice();
    snapshot.forEach(s => window.Intelligence?.dismissSuggestion?.(s.id, true));
    current = [];
    el.hidden = true;
    el.innerHTML = '';
  }

  window.SmartSuggestions = {
    render,
    hideAll,
    openReport,
    closeReport,
    openSaveVersion,
    openBaselineManager,
    openQuickBaselineUpdate,
    openNamedVersionCompare,
    openProjectGraphCleanup,
    openDiagnostics,
    closeDiagnostics,
    updateMenu,
    closeMenu,
    getCurrent: () => current.slice(),
    getMenu: () => menuSuggestions.slice()
  };
})();