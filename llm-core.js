// file_name: llm-core.js
'use strict';

window.LLMCore = (() => {
  // =провайдеры=
  const PROVIDERS = {
    lmstudio:   { label: 'LM Studio', baseUrl: 'http://localhost:1234', requiresKey: false, modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'openai' },
    ollama:     { label: 'Ollama', baseUrl: 'http://localhost:11434', requiresKey: false, modelsPath: '/api/tags', chatPath: '/api/chat', parseModels: 'ollama' },
    openai:     { label: 'OpenAI', baseUrl: 'https://api.openai.com', requiresKey: true, modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'openai' },
    groq:       { label: 'Groq', baseUrl: 'https://api.groq.com/openai', requiresKey: true, modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'openai' },
    cherry:     { label: 'Cherry Studio API', baseUrl: 'http://127.0.0.1:23333', requiresKey: true, modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'cherry', requestMode: 'chat' },
    cherryAnthropic: { label: 'Cherry Anthropic API', baseUrl: 'http://127.0.0.1:23333', requiresKey: true, modelsPath: '/v1/models', chatPath: '/v1/messages', parseModels: 'cherry', requestMode: 'anthropic', modelQueries: [{ providerType: 'anthropic' }] },
    openaiResponses: { label: 'OpenAI-compatible API', baseUrl: 'https://api.openai.com', requiresKey: false, modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'openai', requestMode: 'chat', probeModel: true },
    openrouter: {
      label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', requiresKey: true,
      modelsPath: '/v1/models', chatPath: '/v1/chat/completions', parseModels: 'openrouter',
      extraHeaders: { 'HTTP-Referer': 'paste-copy', 'X-Title': 'paste\\copy' },
    },
  };

  let _State = null;
  let _Storage = null;
  const _modelsCache = new Map();
  const _modelsMeta = new Map();

  // =очередь=
  class FetchSemaphore {
    constructor(max = 3) { this._max = max; this._active = 0; this._queue = []; }
    acquire() {
      return new Promise(resolve => {
        if (this._active < this._max) { this._active++; resolve(); }
        else this._queue.push(resolve);
      });
    }
    release() {
      this._active = Math.max(0, this._active - 1);
      if (this._queue.length && this._active < this._max) { this._active++; this._queue.shift()(); }
      _updateQueueBadge(this._active);
    }
    get active() { return this._active; }
  }
  const _sem = new FetchSemaphore(3);
  const _localSem = new FetchSemaphore(1);

  // =кэш=
  const LLMCache = (() => {
    let _data = null;
    const _load = () => { if (!_data) _data = _Storage?.loadLLMCache?.() ?? { entries: {}, order: [] }; };
    const _persist = () => _Storage?.saveLLMCache?.(_data);
    function get(key) {
      _load();
      const entry = _data.entries[key];
      if (!entry) return null;
      const ttlMs = ((_State?.getLayout()?.llm?.cache?.ttlH) ?? 24) * 3_600_000;
      if (Date.now() - entry.ts > ttlMs) {
        delete _data.entries[key];
        _data.order = _data.order.filter(k => k !== key);
        _persist();
        return null;
      }
      _data.order = _data.order.filter(k => k !== key);
      _data.order.push(key);
      entry.hits = (entry.hits ?? 0) + 1;
      return entry.value;
    }
    function set(key, value) {
      _load();
      const max = (_State?.getLayout()?.llm?.cache?.maxEntries) ?? 200;
      while (_data.order.length >= max) delete _data.entries[_data.order.shift()];
      _data.entries[key] = { value, ts: Date.now(), hits: 0 };
      _data.order = _data.order.filter(k => k !== key);
      _data.order.push(key);
      _persist();
    }
    function clear() { _data = { entries: {}, order: [] }; _Storage?.clearLLMCache?.(); }
    function stats() { _load(); return { count: _data.order.length, estimatedKb: Math.round(JSON.stringify(_data).length / 1024) }; }
    function invalidate() { _data = null; }
    return { get, set, clear, stats, invalidate };
  })();

  // =история=
  const LLMRequestLog = (() => {
    let _log = null;
    const _load = () => { if (!_log) _log = _Storage?.loadLLMHistory?.() ?? []; };
    function append(entry) {
      _load();
      _log.unshift(entry);
      const limit = _State?.getLayout()?.llm?.history?.limit ?? 100;
      if (_log.length > limit) _log.length = limit;
      _Storage?.saveLLMHistory?.(_log);
    }
    function getAll() { _load(); return [..._log]; }
    function clear() { _log = []; _Storage?.saveLLMHistory?.([]); }
    function remove(id) { _load(); _log = _log.filter(e => e.id !== id); _Storage?.saveLLMHistory?.(_log); }
    function invalidate() { _log = null; }
    return { append, getAll, clear, remove, invalidate };
  })();

  // =утилиты=
  function hashStr(s) {
    let h = 5381;
    s = String(s ?? '');
    for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36).padStart(8, '0');
  }
  function estimateTokens(s) { return Math.ceil((s || '').length / 4); }
  function _uid() { return Math.random().toString(36).slice(2, 10); }
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getCtxPct(promptText) {
    const profile = _getActiveProfile();
    if (!profile?.maxTokens) return 0;
    return Math.min(100, Math.round(estimateTokens(promptText) / profile.maxTokens * 100));
  }
  function updateCtxBadge(pct) {
    const badge = document.getElementById('llm-ctx-badge');
    const pctEl = document.getElementById('llm-ctx-pct');
    if (!badge || !pctEl) return;
    pctEl.textContent = pct + '%';
    badge.style.display = pct > 5 ? '' : 'none';
    badge.classList.toggle('llm-ctx-warn', pct > 80);
  }
  function _updateQueueBadge(active) {
    const badge = document.getElementById('llm-queue-badge');
    const nEl = document.getElementById('llm-queue-n');
    if (!badge || !nEl) return;
    nEl.textContent = active;
    badge.style.display = active > 0 ? '' : 'none';
  }
  function _getActiveProfile() {
    const lay = _State?.getLayout();
    return (lay?.llm?.profiles ?? []).find(p => p.id === lay?.llm?.activeProfileId) ?? null;
  }
  function _providerBaseUrl(providerId) { return PROVIDERS[providerId]?.baseUrl ?? ''; }
  function _isDefaultEndpoint(val) { return !val || Object.values(PROVIDERS).some(p => p.baseUrl === val); }
  function _buildHeaders(profile, apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    Object.assign(headers, PROVIDERS[profile.provider]?.extraHeaders ?? {});
    return headers;
  }
  function _isLocalProvider(providerId) { return providerId === 'lmstudio' || providerId === 'ollama'; }
  function _naturalCompare(a, b) { return String(a ?? '').localeCompare(String(b ?? ''), ['ru', 'en'], { sensitivity: 'base', numeric: true }); }
  function _splitProviderModelId(id, fallbackProvider = '') {
    const raw = String(id ?? '').trim();
    const fallback = String(fallbackProvider ?? '').trim();
    if (!raw) return { providerId: fallback || 'Cherry Studio', modelId: '' };
    if (fallback) {
      const prefix = fallback + ':';
      if (raw.toLowerCase().startsWith(prefix.toLowerCase())) {
        return { providerId: fallback, modelId: raw.slice(prefix.length) || raw };
      }
      return { providerId: fallback, modelId: raw };
    }
    const idx = raw.indexOf(':');
    if (idx <= 0) return { providerId: 'Cherry Studio', modelId: raw };
    return { providerId: raw.slice(0, idx), modelId: raw.slice(idx + 1) || raw };
  }
  function _providerDisplayName(providerId) {
    const raw = String(providerId ?? '').trim();
    if (!raw) return 'Cherry Studio';
    const known = { openai: 'OpenAI', openrouter: 'OpenRouter', lmstudio: 'LM Studio', ollama: 'Ollama', groq: 'Groq', gemini: 'Gemini', anthropic: 'Anthropic', mercury: 'Mercury', inception: 'Inception', mistral: 'Mistral', mistralai: 'Mistral AI', github: 'GitHub Models', 'github-copilot': 'GitHub Copilot', huggingface: 'Hugging Face', 'electron-hub': 'Electron Hub', 'new-api': 'New API', poe: 'Poe', siliconflow: 'SiliconFlow', zai: 'Z.ai', 'z-ai': 'Z.ai' };
    return known[raw.toLowerCase()] ?? raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function _joinApiUrl(baseUrl, path) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    const cleanPath = String(path ?? '').startsWith('/') ? String(path ?? '') : '/' + String(path ?? '');
    if (/\/v1$/i.test(base) && cleanPath.toLowerCase().startsWith('/v1/')) return base + cleanPath.slice(3);
    return base + cleanPath;
  }
  function _modelsUrl(baseUrl, path, query = null) {
    const url = _joinApiUrl(baseUrl, path);
    if (!query) return url;
    const params = new URLSearchParams(query);
    return url + (url.includes('?') ? '&' : '?') + params.toString();
  }
  function _apiUrl(baseUrl, path) {
    return _joinApiUrl(baseUrl, path);
  }
  async function _fetchModelsJson(url, profile, apiKey, opts = {}) {
    const fetchJson = async key => {
      const res = await fetch(url, { headers: _buildHeaders(profile, key), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        const txt = await _readErrorText(res);
        const err = new Error(_friendlyHttpError(res.status, txt, profile.provider));
        err.status = res.status;
        err.responseText = txt;
        throw err;
      }
      return res.json();
    };

    try {
      return await fetchJson(apiKey);
    } catch (err) {
      const canRetryWithoutAuth = opts.retryWithoutAuthOnAuthError && apiKey && (err.status === 401 || err.status === 403);
      if (!canRetryWithoutAuth) throw err;
      const json = await fetchJson('');
      _modelsMeta.set(profile.id, { authBypassedForModels: true, authError: err.message });
      return json;
    }
  }
  async function _readErrorText(res) {
    const txt = await res.text().catch(() => '');
    if (!txt) return '';
    try {
      const json = JSON.parse(txt);
      return json.error?.message || json.error?.code || json.message || txt;
    } catch { return txt; }
  }
  function _friendlyHttpError(status, text, providerId) {
    const details = text ? `: ${String(text).slice(0, 180)}` : '';
    if (status === 400) return `Неверный запрос или модель (${status})${details}`;
    if (status === 401) return `Ключ API не принят (${status})${details}`;
    if (status === 403) return `Нет доступа: проверьте ключ/права (${status})${details}`;
    if (status === 404) return `Endpoint или модель не найдены (${status})${details}`;
    if (status === 408) return `Timeout на стороне сервера (${status})${details}`;
    if (status === 429) return `Лимит запросов у провайдера (${status})${details}`;
    if (status >= 500) return `${providerId === 'cherry' ? 'Cherry API/провайдер вернул ошибку' : 'Сервер вернул ошибку'} (${status})${details}`;
    return `HTTP ${status}${details}`;
  }
  function _friendlyNetworkError(err, timedOut, seconds) {
    if (timedOut || err?.name === 'TimeoutError') return `Таймаут: модель/провайдер не ответили за ${seconds} сек.`;
    if (err?.name === 'AbortError') return 'Проверка отменена.';
    if (err instanceof TypeError) return 'Network/CORS error: сервер недоступен или браузер заблокировал запрос.';
    return err?.message || 'Неизвестная ошибка сети.';
  }
  function _extractCherryProviderId(model) {
    const direct = String(model.provider_id ?? model.providerId ?? model.provider?.id ?? '').trim();
    if (direct) return direct;
    const ownedBy = String(model.owned_by ?? model.ownedBy ?? '').trim();
    if (ownedBy) return ownedBy;
    return _splitProviderModelId(model.id, '').providerId;
  }
  function _extractCherryModelLabel(model, providerId) {
    const explicit = String(model.name ?? model.label ?? '').trim();
    if (explicit) return explicit;
    return _splitProviderModelId(model.id, providerId).modelId || String(model.id ?? '').trim();
  }
  function _parseCherryModels(json) {
    const byId = new Map();
    (json.data ?? []).forEach(m => {
      const id = String(m.id ?? '').trim();
      if (!id || byId.has(id)) return;
      const providerId = _extractCherryProviderId(m);
      const providerLabel = _providerDisplayName(providerId || 'Cherry Studio');
      const label = _extractCherryModelLabel(m, providerId);
      byId.set(id, { id, label, free: false, providerLabel, fullLabel: true });
    });
    return [...byId.values()]
      .sort((a, b) => _naturalCompare(a.providerLabel, b.providerLabel) || _naturalCompare(a.label, b.label) || _naturalCompare(a.id, b.id));
  }
  function _isTextGenerationModel(model) {
    const type = String(model.type ?? '').trim().toLowerCase();
    if (type && !['chat', 'text', 'language'].includes(type)) return false;
    const output = Array.isArray(model.output_modalities) ? model.output_modalities.map(x => String(x).toLowerCase()) : [];
    return !output.length || output.includes('text');
  }
  function _parseOpenAICompatibleModels(json, { grouped = false, textOnly = false } = {}) {
    const byId = new Map();
    (json.data ?? []).forEach(m => {
      const id = String(m.id ?? '').trim();
      if (!id || byId.has(id)) return;
      if (textOnly && !_isTextGenerationModel(m)) return;
      const label = String(m.name ?? m.id ?? '').trim() || id;
      const providerId = String(m.owned_by ?? m.ownedBy ?? '').trim();
      byId.set(id, {
        id,
        label,
        free: false,
        providerLabel: grouped && providerId ? _providerDisplayName(providerId) : '',
        fullLabel: grouped,
      });
    });
    return [...byId.values()]
      .sort((a, b) => _naturalCompare(a.providerLabel, b.providerLabel) || _naturalCompare(a.label, b.label) || _naturalCompare(a.id, b.id));
  }
  async function _loadCherryModelsPage(profile, prov, apiKey, extraQuery = {}) {
    const endpoint = profile.endpoint?.trim() || prov.baseUrl;
    const limit = 500;
    let offset = 0;
    let total = null;
    const data = [];

    for (let guard = 0; guard < 50; guard++) {
      const url = _modelsUrl(endpoint, prov.modelsPath, { ...extraQuery, limit, offset });
      const json = await _fetchModelsJson(url, profile, apiKey);
      const chunk = Array.isArray(json.data) ? json.data : [];
      data.push(...chunk);
      const numericTotal = Number(json.total);
      const numericLimit = Number(json.limit);
      total = Number.isFinite(numericTotal) && numericTotal >= 0 ? numericTotal : total;
      const pageLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : limit;
      if (!chunk.length || (total != null && data.length >= total) || (total == null && chunk.length < pageLimit)) break;
      offset += chunk.length;
    }

    return data;
  }
  async function _loadCherryModels(profile, prov, apiKey) {
    const providerTypeQueries = prov.modelQueries ?? [
      {},
      { providerType: 'openai' },
      { providerType: 'openai-response' },
      { providerType: 'anthropic' },
      { providerType: 'gemini' },
    ];
    const data = [];
    let firstError = null;
    let successCount = 0;

    for (const query of providerTypeQueries) {
      try {
        const chunk = await _loadCherryModelsPage(profile, prov, apiKey, query);
        data.push(...chunk);
        successCount++;
      } catch (err) {
        firstError ??= err;
        if (!Object.keys(query).length) throw err;
        console.warn('[LLMCore] Cherry models providerType skipped:', query.providerType, err);
      }
    }

    if (!successCount && firstError) throw firstError;
    return _parseCherryModels({ data });
  }
  function _shouldAddNoThink(profile) {
    const mode = profile.thinkingMode ?? 'auto';
    if (mode === 'none') return false;
    if (mode === 'off') return true;
    const model = String(profile.model ?? '').toLowerCase();
    return _isLocalProvider(profile.provider) && /(qwen|deepseek|reason|think|r1)/i.test(model);
  }
  function _withNoThink(messages, profile) {
    if (!_shouldAddNoThink(profile)) return messages;
    const list = (messages ?? []).map(m => ({ ...m }));
    const hasMarker = list.some(m => /(^|\s)\/no_think(\s|$)/i.test(String(m.content ?? '')));
    if (hasMarker) return list;
    const idx = list.findIndex(m => m.role === 'user');
    if (idx < 0) return list;
    list[idx].content = '/no_think\n\n' + String(list[idx].content ?? '');
    return list;
  }

  // =парсеры=
  async function _parseSSE(response, _provider, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') return full;
          try {
            const json = JSON.parse(raw);
            const delta = json.choices?.[0]?.delta?.content
              || json.choices?.[0]?.delta?.reasoning_content
              || (json.type === 'content_block_delta' ? json.delta?.text : '')
              || (json.type === 'content_block_start' ? json.content_block?.text : '')
              || json.delta
              || (json.type === 'response.output_text.delta' ? json.delta : '')
              || '';
            if (delta) { full += delta; onChunk?.(delta); }
          } catch {}
        }
      }
    }
    return full;
  }
  async function _parseNDJSON(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          const delta = json.message?.content || json.message?.reasoning_content || '';
          if (delta) { full += delta; onChunk?.(delta); }
          if (json.done) return full;
        } catch {}
      }
    }
    return full;
  }
  function _extractResponsesContent(json) {
    if (!json || typeof json !== 'object') return '';
    if (typeof json.output_text === 'string') return json.output_text;
    const chunks = [];
    (json.output ?? []).forEach(item => {
      (item.content ?? []).forEach(part => {
        const text = part.text ?? part.value ?? part.content;
        if (typeof text === 'string') chunks.push(text);
      });
    });
    return chunks.join('');
  }
  function _extractAnthropicContent(json) {
    if (!json || typeof json !== 'object') return '';
    if (typeof json.content === 'string') return json.content;
    if (!Array.isArray(json.content)) return '';
    return json.content.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      return part.text ?? part.value ?? part.content ?? '';
    }).join('');
  }
  function _extractContent(provider, json) {
    if (provider === 'ollama') return json.message?.content || json.message?.reasoning_content || '';
    const mode = PROVIDERS[provider]?.requestMode ?? 'chat';
    if (mode === 'responses') return _extractResponsesContent(json);
    if (mode === 'anthropic') return _extractAnthropicContent(json);
    const msg = json.choices?.[0]?.message;
    return msg?.content || msg?.reasoning_content || '';
  }
  function _messagesToResponsesInput(messages) {
    return (messages ?? []).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: String(m.content ?? '') }],
    }));
  }
  function _messagesToAnthropic(messages) {
    const system = [];
    const body = [];
    (messages ?? []).forEach(m => {
      const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
      const content = String(m.content ?? '');
      if (role === 'system') system.push(content);
      else body.push({ role, content });
    });
    return { system: system.join('\n\n'), messages: body.length ? body : [{ role: 'user', content: '' }] };
  }
  function _buildRequestBody(profile, messages, opts = {}) {
    const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
    const model = opts.model ?? profile.model ?? '';
    const temperature = opts.temperature ?? profile.temperature ?? 0.7;
    const maxTokens = opts.maxTokens ?? profile.maxTokens ?? 2000;
    const stream = !!(opts.stream ?? profile.streaming ?? false);
    if (prov.requestMode === 'responses') {
      return { model, input: _messagesToResponsesInput(messages), temperature, max_output_tokens: maxTokens, stream };
    }
    if (prov.requestMode === 'anthropic') {
      const anth = _messagesToAnthropic(messages);
      const body = { model, messages: anth.messages, max_tokens: maxTokens, stream };
      if (anth.system) body.system = anth.system;
      if (Number.isFinite(Number(temperature))) body.temperature = Math.max(0, Math.min(1, Number(temperature)));
      return body;
    }
    return { model, messages, temperature, max_tokens: maxTokens, stream };
  }

  // =модели=
  async function loadModels(profileId) {
    if (!_State) return [];
    if (_modelsCache.has(profileId)) return _modelsCache.get(profileId);
    const lay = _State.getLayout();
    const profile = (lay?.llm?.profiles ?? []).find(p => p.id === profileId);
    if (!profile) return [];
    const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
    const apiKey = _Storage?.loadLLMKey?.(profileId) ?? '';
    const url = _modelsUrl(profile.endpoint?.trim() || prov.baseUrl, prov.modelsPath);
    try {
      let models = [];
      _modelsMeta.delete(profileId);
      if (prov.parseModels === 'cherry') {
        models = await _loadCherryModels(profile, prov, apiKey);
      } else {
        const json = await _fetchModelsJson(url, profile, apiKey, { retryWithoutAuthOnAuthError: profile.provider === 'openaiResponses' });
        if (prov.parseModels === 'ollama') models = (json.models ?? []).map(m => ({ id: m.name, label: m.name, free: false }));
        else if (prov.parseModels === 'openrouter') models = (json.data ?? []).map(m => ({ id: m.id, label: m.name ?? m.id, free: m.pricing?.prompt === '0' })).sort((a, b) => Number(b.free) - Number(a.free));
        else models = _parseOpenAICompatibleModels(json, { grouped: profile.provider === 'openaiResponses', textOnly: profile.provider === 'openaiResponses' });
      }
      _modelsCache.set(profileId, models);
      return models;
    } catch (err) {
      console.warn('[LLMCore] loadModels error:', err);
      throw err;
    }
  }
  async function _probeModel(profile, prov, apiKey, model, opts = {}) {
    const t0 = Date.now();
    const emptyResult = { ok: false, warn: false, latencyMs: 0, model, error: null, message: '', stage: 'init' };
    const timeoutSec = Math.max(3, Math.min(240, Number(opts.timeoutSec) || Number(profile.timeout) || 30));
    if (!model) return { ...emptyResult, latencyMs: Date.now() - t0, error: 'Выберите модель для проверки.', stage: 'model' };
    if (prov.requiresKey && !apiKey) return { ...emptyResult, latencyMs: Date.now() - t0, error: 'Введите API key.', stage: 'key' };

    const endpoint = profile.endpoint?.trim() || prov.baseUrl;
    const url = _apiUrl(endpoint, prov.chatPath);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort('timeout'); }, timeoutSec * 1000);
    const body = _buildRequestBody(profile, [{ role: 'user', content: 'Ответь ровно одним словом: OK' }], { model, temperature: 0, maxTokens: 8, stream: false });

    try {
      const res = await fetch(url, { method: 'POST', headers: _buildHeaders(profile, apiKey), body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) {
        const txt = await _readErrorText(res);
        return { ...emptyResult, latencyMs: Date.now() - t0, error: _friendlyHttpError(res.status, txt, profile.provider), status: res.status, stage: res.status === 401 || res.status === 403 ? 'auth' : 'chat' };
      }
      const json = await res.json().catch(() => null);
      const content = _extractContent(profile.provider, json ?? {}).trim();
      if (!content) return { ...emptyResult, warn: true, latencyMs: Date.now() - t0, error: 'API доступен, key принят, но модель вернула пустой ответ.', message: 'Пустой ответ модели', stage: 'response' };
      return { ok: true, warn: !/^ok\b/i.test(content), latencyMs: Date.now() - t0, model, error: null, message: `модель отвечает: ${content.slice(0, 40)}`, stage: 'chat' };
    } catch (err) {
      return { ...emptyResult, latencyMs: Date.now() - t0, error: _friendlyNetworkError(err, timedOut, timeoutSec), stage: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  async function testConnection(profileId) {
    const t0 = Date.now();
    _modelsCache.delete(profileId);
    _modelsMeta.delete(profileId);
    const emptyResult = { ok: false, warn: false, latencyMs: 0, modelCount: 0, error: null, message: '', stage: 'init' };
    try {
      const lay = _State?.getLayout();
      const profile = (lay?.llm?.profiles ?? []).find(p => p.id === profileId);
      if (!profile) return { ...emptyResult, latencyMs: Date.now() - t0, error: 'Профиль не найден', stage: 'profile' };
      const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
      const apiKey = _Storage?.loadLLMKey?.(profileId) ?? '';
      const model = String(profile.model ?? '').trim();
      const mustProbe = profile.provider === 'cherry' || profile.provider === 'cherryAnthropic' || prov.probeModel === true || prov.requestMode === 'responses' || prov.requestMode === 'anthropic';

      if (!mustProbe) {
        const models = await loadModels(profileId);
        return { ok: true, warn: models.length === 0, latencyMs: Date.now() - t0, modelCount: models.length, error: null, message: models.length ? `OK · ${models.length} моделей` : 'Подключение есть, моделей не найдено', stage: 'models' };
      }

      const res = await _probeModel(profile, prov, apiKey, model);
      const providerLabel = prov.label || 'API';
      if (!res.ok) return { ...res, modelCount: _modelsCache.get(profileId)?.length ?? 0, error: res.error || 'Модель не отвечает' };
      return { ...res, modelCount: _modelsCache.get(profileId)?.length ?? 0, message: `${providerLabel} доступен · key принят · ${res.message}` };
    } catch (err) {
      return { ...emptyResult, latencyMs: Date.now() - t0, error: err.message || 'Ошибка проверки подключения', stage: 'fatal' };
    }
  }
  async function testAllModels(profileId, opts = {}) {
    const lay = _State?.getLayout();
    const profile = (lay?.llm?.profiles ?? []).find(p => p.id === profileId);
    if (!profile) throw new Error('Профиль не найден');
    const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
    const apiKey = _Storage?.loadLLMKey?.(profileId) ?? '';
    if (prov.requiresKey && !apiKey) throw new Error('Введите API key перед проверкой моделей.');
    const models = await loadModels(profileId);
    if (!models.length) throw new Error('Сначала загрузите список моделей: API не вернул ни одной модели.');
    const timeoutSec = Math.max(3, Math.min(120, Number(opts.timeoutSec) || 15));
    const parallel = opts.parallel === false ? 1 : Math.min(4, Math.max(1, Number(opts.parallel) || 2));
    const results = new Array(models.length);
    let cursor = 0;
    async function worker() {
      while (cursor < models.length) {
        const idx = cursor++;
        const item = models[idx];
        opts.onProgress?.({ index: idx, total: models.length, model: item, status: 'running' });
        const res = await _probeModel(profile, prov, apiKey, item.id, { timeoutSec });
        results[idx] = { ...res, id: item.id, label: item.label ?? item.id, providerLabel: item.providerLabel ?? '' };
        opts.onProgress?.({ index: idx, total: models.length, model: item, result: results[idx], status: 'done' });
      }
    }
    await Promise.all(Array.from({ length: parallel }, () => worker()));
    return results;
  }

  // =запрос=
  async function request(opts) {
    if (!_State) throw new Error('LLMCore not initialised');
    const lay = _State.getLayout();
    const llmCfg = lay?.llm ?? {};
    if (!llmCfg.enabled) throw new Error('LLM-модуль отключён');
    const profileId = opts.profileId ?? llmCfg.activeProfileId;
    const profile = (llmCfg.profiles ?? []).find(p => p.id === profileId);
    if (!profile) throw new Error('Профиль не выбран');
    const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
    const apiKey = _Storage?.loadLLMKey?.(profileId) ?? '';
    const effectiveCacheKey = opts.cacheKey ? `${profileId}:${profile.model ?? ''}:${profile.thinkingMode ?? 'auto'}:${opts.cacheKey}` : '';

    if (effectiveCacheKey && llmCfg.cache?.enabled && profile.useCache !== false) {
      const cached = LLMCache.get(effectiveCacheKey);
      if (cached != null) {
        if (!opts.skipLog) LLMRequestLog.append({ id: _uid(), ts: Date.now(), feature: opts.featureTag ?? 'unknown', profileId, model: profile.model ?? '', inputHash: hashStr(effectiveCacheKey).slice(0, 16), inputLen: 0, outputLen: cached.length, promptTokens: 0, completionTokens: estimateTokens(cached), durationMs: 0, response: cached, cached: true });
        opts.onChunk?.(cached);
        return cached;
      }
    }

    const useLocalQueue = _isLocalProvider(profile.provider);
    if (useLocalQueue) await _localSem.acquire();
    await _sem.acquire();
    _updateQueueBadge(_sem.active);
    const t0 = Date.now();
    let result = '';
    try {
      const url = _apiUrl(profile.endpoint?.trim() || prov.baseUrl, prov.chatPath);
      const useStream = !!(opts.stream ?? profile.streaming ?? llmCfg.streaming);
      const messages = _withNoThink(opts.messages, profile);
      const body = _buildRequestBody(profile, messages, { model: profile.model ?? '', temperature: opts.temperature, maxTokens: opts.maxTokens, stream: useStream });
      let retries = profile.retries ?? 2;
      let lastError = null;
      while (retries >= 0) {
        const controller = new AbortController();
        const timeoutMs = opts.noTimeout ? 0 : Math.max(1, Number(opts.timeoutMs) || (opts.featureTag === 'autopoet' ? Math.max((profile.timeout ?? 30) * 1000, 180_000) : (profile.timeout ?? 30) * 1000));
        let timer = null, timedOut = false;
        const onExternalAbort = () => controller.abort(opts.signal?.reason ?? 'external abort');
        if (timeoutMs > 0) timer = setTimeout(() => { timedOut = true; controller.abort('timeout'); }, timeoutMs);
        if (opts.signal) {
          if (opts.signal.aborted) { if (timer) clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
          opts.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
        try {
          const res = await fetch(url, { method: 'POST', headers: _buildHeaders(profile, apiKey), body: JSON.stringify(body), signal: controller.signal });
          if (res.status === 429) {
            if (retries-- > 0) { await _sleep(1500 * (3 - retries)); continue; }
            throw new Error('Превышен лимит запросов (429)');
          }
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
          }
          if (useStream) result = profile.provider === 'ollama' ? await _parseNDJSON(res, opts.onChunk) : await _parseSSE(res, profile.provider, opts.onChunk);
          else {
            const json = await res.json();
            result = _extractContent(profile.provider, json);
            if (!String(result ?? '').trim()) {
              console.warn('[LLM] Non-stream пустой:', { feature: opts.featureTag, provider: profile.provider, model: profile.model, finish: json?.choices?.[0]?.finish_reason, raw: JSON.stringify(json ?? {}).slice(0, 500) });
              if (retries-- > 0) { await _sleep(1000); continue; }
            }
            opts.onChunk?.(result);
          }
          lastError = null;
          break;
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) {
            if (timedOut) lastError = new Error(`Таймаут LLM-запроса (${Math.round(timeoutMs / 1000)} сек.)`);
            else throw err;
          } else lastError = err;
          if (retries-- > 0) await _sleep(800);
          else throw lastError;
        } finally {
          if (timer) clearTimeout(timer);
          opts.signal?.removeEventListener?.('abort', onExternalAbort);
        }
      }
      if (lastError) throw lastError;
    } finally {
      _sem.release();
      if (useLocalQueue) _localSem.release();
    }

    if (effectiveCacheKey && llmCfg.cache?.enabled && profile.useCache !== false && String(result ?? '').trim()) LLMCache.set(effectiveCacheKey, result);
    if (!opts.skipLog) {
      const inputText = (opts.messages ?? []).map(m => m.content).join(' ');
      LLMRequestLog.append({ id: _uid(), ts: Date.now(), feature: opts.featureTag ?? 'unknown', profileId, model: profile.model ?? '', inputHash: hashStr(inputText).slice(0, 16), inputLen: inputText.length, outputLen: result.length, promptTokens: estimateTokens(inputText), completionTokens: estimateTokens(result), durationMs: Date.now() - t0, response: result, cached: false });
    }
    return result;
  }

  // =настройки=
  const LLMSettingsModal = (() => {
    let _selectedProfileId = null;
    let _bound = false;
    let _promptGroupsReady = false;
    const _promptCollapsedGroups = new Set();
    const STORAGE_GROUP_KEY = '__storage__';
    let _storageSelectedId = null;
    let _lastNonStoragePromptKey = '';
    const _deleteConfirmTimers = new WeakMap();
    const _set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const _get = id => document.getElementById(id)?.value ?? '';
    const _setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const _getCheck = id => document.getElementById(id)?.checked ?? false;
    const _esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));

    function _statusIcon(kind) {
      if (kind === 'default') return '◌';
      if (kind === 'changed') return '✎';
      if (kind === 'risk') return '⚠';
      if (kind === 'error') return '⛔';
      return '•';
    }

    function _shortModelLabel(label) {
      const text = String(label ?? '').trim();
      if (text.length <= 28) return text;
      const parts = text.split(/[/:]/).filter(Boolean);
      const tail = parts.length ? parts[parts.length - 1] : text;
      return tail.length <= 26 ? '…/' + tail : text.slice(0, 12) + '…' + text.slice(-13);
    }
    function _armDangerButton(btn, armedText = 'Ещё раз') {
      if (!btn) return false;
      if (btn.classList.contains('confirm-pending')) return true;
      const originalText = btn.textContent;
      const originalTitle = btn.title;
      btn.classList.add('confirm-pending');
      btn.textContent = armedText;
      btn.title = 'Нажмите ещё раз для подтверждения';
      const timer = setTimeout(() => {
        btn.classList.remove('confirm-pending');
        btn.textContent = originalText;
        btn.title = originalTitle;
        _deleteConfirmTimers.delete(btn);
      }, 2500);
      _deleteConfirmTimers.set(btn, timer);
      return false;
    }
    function _clearDangerButton(btn, text, title) {
      if (!btn) return;
      const timer = _deleteConfirmTimers.get(btn);
      if (timer) clearTimeout(timer);
      _deleteConfirmTimers.delete(btn);
      btn.classList.remove('confirm-pending');
      if (text != null) btn.textContent = text;
      if (title != null) btn.title = title;
    }
    function _ensureModelStatusModal() {
      let modal = document.getElementById('llm-model-status-modal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'llm-model-status-modal';
      modal.className = 'modal-overlay';
      modal.style.display = 'none';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'llm-model-status-title');
      modal.innerHTML = `
        <div class="modal-box modal-box-md llm-model-status-box">
          <div class="modal-header">
            <span class="modal-title" id="llm-model-status-title">Проверка состояния моделей</span>
            <button type="button" class="modal-close" id="llm-model-status-close" aria-label="Закрыть">✕</button>
          </div>
          <div class="modal-body llm-model-status-body">
            <div class="llm-model-status-warn"><b>!</b><span>Проверка отправляет короткий запрос в каждую модель из списка. Если провайдер берёт оплату за запросы, возможны расходы.</span></div>
            <div class="llm-model-status-controls">
              <label class="settings-item settings-item-row">Таймаут <input id="llm-model-status-timeout" type="number" min="3" max="120" value="15"> s</label>
              <label class="settings-item"><input id="llm-model-status-parallel" type="checkbox" checked> Параллельно</label>
            </div>
            <div id="llm-model-status-summary" class="settings-hint">Готово к проверке.</div>
            <div id="llm-model-status-list" class="llm-model-status-list" role="list" aria-label="Результаты проверки моделей"></div>
            <div class="llm-model-status-actions">
              <button type="button" id="llm-model-status-cancel" class="btn-sm">Закрыть</button>
              <button type="button" id="llm-model-status-start" class="btn-sm btn-sm-accent">Начать</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#llm-model-status-close')?.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.querySelector('#llm-model-status-cancel')?.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
      modal.querySelector('#llm-model-status-start')?.addEventListener('click', _runModelStatusCheck);
      return modal;
    }
    function _renderModelStatusRow(result) {
      const status = result.ok ? (result.warn ? 'warn' : 'ok') : 'error';
      const text = result.ok ? (result.warn ? 'ответ не OK' : 'жива') : (result.stage === 'timeout' ? 'timeout' : result.stage === 'auth' ? 'key' : 'ошибка');
      const details = result.ok ? `${result.latencyMs} мс` : _esc(result.error || 'Не отвечает');
      return `<div class="llm-model-status-row ${status}" role="listitem"><span class="llm-model-status-dot"></span><span class="llm-model-status-main"><b>${_esc(result.providerLabel ? result.providerLabel + ' · ' + result.label : result.label)}</b><small>${_esc(result.id)}</small></span><span class="llm-model-status-state">${_esc(text)}</span><span class="llm-model-status-details">${details}</span></div>`;
    }
    async function _openModelStatusModal() {
      if (!_selectedProfileId) return;
      _saveCurrentProfile();
      const modal = _ensureModelStatusModal();
      const list = modal.querySelector('#llm-model-status-list');
      const summary = modal.querySelector('#llm-model-status-summary');
      const start = modal.querySelector('#llm-model-status-start');
      if (list) list.innerHTML = '';
      if (summary) summary.textContent = 'Нажмите «Начать», чтобы проверить все загруженные модели текущего профиля.';
      if (start) start.disabled = false;
      modal.dataset.profileId = _selectedProfileId;
      modal.style.display = 'flex';
    }
    async function _runModelStatusCheck() {
      const modal = _ensureModelStatusModal();
      const profileId = modal.dataset.profileId || _selectedProfileId;
      if (!profileId) return;
      const list = modal.querySelector('#llm-model-status-list');
      const summary = modal.querySelector('#llm-model-status-summary');
      const start = modal.querySelector('#llm-model-status-start');
      const timeoutSec = parseInt(modal.querySelector('#llm-model-status-timeout')?.value ?? '15', 10) || 15;
      const parallel = modal.querySelector('#llm-model-status-parallel')?.checked ? 2 : 1;
      if (start) start.disabled = true;
      if (list) list.innerHTML = '';
      const done = { n: 0, ok: 0, warn: 0, error: 0 };
      try {
        if (summary) summary.textContent = '⏳ Загружаю список моделей...';
        const results = await testAllModels(profileId, {
          timeoutSec, parallel,
          onProgress: ({ total, result, status }) => {
            if (status !== 'done' || !result) return;
            done.n++;
            if (result.ok && !result.warn) done.ok++;
            else if (result.ok && result.warn) done.warn++;
            else done.error++;
            if (list) list.insertAdjacentHTML('beforeend', _renderModelStatusRow(result));
            if (summary) summary.textContent = `Проверено ${done.n}/${total} · живы ${done.ok} · сомнительно ${done.warn} · ошибки ${done.error}`;
          },
        });
        if (summary) summary.textContent = `✓ Готово: ${done.ok} живы, ${done.warn} сомнительно, ${done.error} ошибок из ${results.length}`;
      } catch (err) {
        if (summary) summary.textContent = '✕ ' + (err.message || 'Ошибка проверки моделей');
        window.Toast?.show(err.message || 'Ошибка проверки моделей', 'error');
      } finally {
        if (start) start.disabled = false;
      }
    }

    function open(tabName) {
      if (!_State) return;
      const modal = document.getElementById('llm-settings-modal');
      if (!modal) return;
      modal.style.display = 'flex';
      _renderProfileList();
      _renderBroTags();
      _renderPromptFnList();
      _syncGeneral();
      _renderTextLintSettings();
      _syncAutoPoet();
      if (tabName) _switchTab(tabName);
      if (!_bound) { _bindEvents(); _bound = true; }
      requestAnimationFrame(() => modal.querySelector('button, input, select, textarea')?.focus());
    }
    function close() { const modal = document.getElementById('llm-settings-modal'); if (modal) modal.style.display = 'none'; }
    function _switchTab(name) {
      document.querySelectorAll('.llm-tab').forEach(t => t.classList.toggle('active', t.dataset.ltab === name));
      document.querySelectorAll('.llm-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'ltab-' + name));
    }
    function _renderProfileList() {
      const lay = _State.getLayout();
      const profiles = lay?.llm?.profiles ?? [];
      const list = document.getElementById('llm-prf-list');
      if (!list) return;
      list.innerHTML = '';
      if (!profiles.length) { list.innerHTML = '<div class="llm-prf-empty">Профилей пока нет</div>'; _clearProfileForm(); return; }
      const selectedId = _selectedProfileId ?? lay?.llm?.activeProfileId ?? profiles[0]?.id;
      profiles.forEach(p => {
        const btn = document.createElement('button');
        const isActive = p.id === lay?.llm?.activeProfileId;
        const isSelected = p.id === selectedId;
        btn.type = 'button';
        btn.className = 'llm-prf-card' + (isSelected ? ' selected' : '') + (isActive ? ' active-prf' : '');
        btn.dataset.profileId = p.id;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        btn.innerHTML = `<span class="llm-prf-card-main"><b>${_esc(p.name || p.id)}</b><small>${_esc(PROVIDERS[p.provider]?.label ?? p.provider ?? 'provider')} · ${_esc(p.model || 'модель не выбрана')}</small></span><span class="llm-prf-card-badge">${isActive ? 'активный' : 'профиль'}</span>`;
        list.appendChild(btn);
      });
      _selectProfile(selectedId);
    }
    function _selectProfile(id) {
      _selectedProfileId = id;
      const lay = _State.getLayout();
      const profile = (lay?.llm?.profiles ?? []).find(p => p.id === id);
      if (!profile) { _clearProfileForm(); return; }
      const prov = PROVIDERS[profile.provider] ?? PROVIDERS.lmstudio;
      _set('llm-prf-name', profile.name ?? '');
      _set('llm-prf-provider', profile.provider ?? 'lmstudio');
      _set('llm-prf-endpoint', profile.endpoint?.trim() || prov.baseUrl);
      _set('llm-prf-apikey', _Storage?.loadLLMKey?.(id) ?? '');
      _set('llm-prf-maxtok', profile.maxTokens ?? 2000);
      _set('llm-prf-timeout', profile.timeout ?? 30);
      _set('llm-prf-retries', profile.retries ?? 2);
      _set('llm-prf-thinking', profile.thinkingMode ?? 'auto');
      _setCheck('llm-prf-stream', profile.streaming ?? true);
      _setCheck('llm-prf-cache', profile.useCache ?? true);
      const title = document.getElementById('llm-prf-title');
      const status = document.getElementById('llm-prf-status');
      if (title) title.textContent = profile.name || profile.id;
      if (status) {
        status.className = 'llm-profile-status' + (lay?.llm?.activeProfileId === id ? ' ok' : '');
        status.textContent = lay?.llm?.activeProfileId === id ? 'активный' : 'не активный';
      }
      document.querySelectorAll('.llm-prf-card').forEach(btn => {
        const selected = btn.dataset.profileId === id;
        btn.classList.toggle('selected', selected);
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const tempEl = document.getElementById('llm-prf-temp');
      const tempVal = document.getElementById('llm-prf-temp-val');
      if (tempEl) tempEl.value = profile.temperature ?? 0.7;
      if (tempVal) tempVal.textContent = profile.temperature ?? 0.7;
      _populateModelSelect(profile);
    }
    function _clearProfileForm() {
      ['llm-prf-name', 'llm-prf-endpoint', 'llm-prf-apikey'].forEach(id => _set(id, ''));
      _set('llm-prf-thinking', 'auto');
      const title = document.getElementById('llm-prf-title');
      const status = document.getElementById('llm-prf-status');
      if (title) title.textContent = 'Профиль';
      if (status) status.textContent = 'не выбран';
      const msel = document.getElementById('llm-prf-model');
      if (msel) msel.innerHTML = '<option value="">— выберите модель —</option>';
    }
    function _populateModelSelect(profile) {
      const sel = document.getElementById('llm-prf-model');
      if (!sel) return;
      const cached = _modelsCache.get(profile.id) ?? [];
      sel.innerHTML = cached.length ? '' : '<option value="">— нажмите ↻ —</option>';
      const appendOption = (parent, m) => {
        const label = m.free ? `[FREE] ${m.label}` : m.label;
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.fullLabel ? label : _shortModelLabel(label);
        opt.title = m.providerLabel ? `${m.providerLabel}: ${label}\n${m.id}` : label;
        parent.appendChild(opt);
      };
      const grouped = cached.some(m => m.providerLabel);
      if (grouped) {
        const groups = new Map();
        cached.forEach(m => {
          const key = m.providerLabel || 'Другие';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        });
        [...groups.entries()]
          .sort((a, b) => _naturalCompare(a[0], b[0]))
          .forEach(([label, items]) => {
            const group = document.createElement('optgroup');
            group.label = label;
            items.sort((a, b) => _naturalCompare(a.label, b.label)).forEach(m => appendOption(group, m));
            sel.appendChild(group);
          });
      } else {
        cached.forEach(m => appendOption(sel, m));
      }
      if (profile.model && !cached.some(m => m.id === profile.model)) {
        const opt = document.createElement('option');
        opt.value = profile.model;
        opt.textContent = _shortModelLabel(profile.model);
        opt.title = profile.model;
        sel.appendChild(opt);
      }
      if (profile.model) sel.value = profile.model;
      const selected = cached.find(m => m.id === sel.value);
      sel.title = selected ? (selected.providerLabel ? `${selected.providerLabel}: ${selected.label}\n${selected.id}` : (selected.free ? `[FREE] ${selected.label}` : selected.label)) : (profile.model || '');
    }
    function _saveCurrentProfile() {
      if (!_selectedProfileId) return;
      const lay = _State.getLayout();
      const profiles = [...(lay?.llm?.profiles ?? [])];
      const idx = profiles.findIndex(p => p.id === _selectedProfileId);
      if (idx < 0) return;
      const providerId = _get('llm-prf-provider');
      profiles[idx] = {
        ...profiles[idx],
        name: _get('llm-prf-name'), provider: providerId,
        endpoint: _get('llm-prf-endpoint').trim() || (PROVIDERS[providerId]?.baseUrl ?? ''),
        model: document.getElementById('llm-prf-model')?.value ?? '',
        temperature: parseFloat(document.getElementById('llm-prf-temp')?.value ?? 0.7),
        maxTokens: parseInt(_get('llm-prf-maxtok'), 10) || 2000,
        timeout: parseInt(_get('llm-prf-timeout'), 10) || 30,
        retries: parseInt(_get('llm-prf-retries'), 10) || 2,
        thinkingMode: _get('llm-prf-thinking') || 'auto',
        streaming: _getCheck('llm-prf-stream'), useCache: _getCheck('llm-prf-cache'),
      };
      _Storage?.saveLLMKey?.(_selectedProfileId, _get('llm-prf-apikey'));
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), profiles } });
    }
    function _clampEffectMs(value, fallback = 3500) {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(1000, Math.min(10000, Math.round(n / 50) * 50));
    }
    function _syncGeneral() {
      const llm = _State.getLayout()?.llm ?? {};
      _setCheck('llm-enabled', llm.enabled ?? false);
      _setCheck('llm-auto-snapshot', llm.autoSnapshot ?? true);
      _setCheck('llm-save-results', llm.saveResults ?? true);
      _setCheck('llm-debug', llm.debugMode ?? false);
      _setCheck('llm-visual-diff', llm.visualDiff ?? false);
      _set('llm-diff-mode', llm.diffMode ?? 'classic');
      _set('llm-diff-effect-ms', _clampEffectMs(llm.diffEffectMs));
      _setCheck('llm-cache-enabled', llm.cache?.enabled ?? true);
      _set('llm-cache-ttl', llm.cache?.ttlH ?? 24);
      _set('llm-cache-max', llm.cache?.maxEntries ?? 200);
      const stats = LLMCache.stats();
      const statsEl = document.getElementById('llm-cache-stats');
      if (statsEl) statsEl.textContent = `${stats.count} записей · ~${stats.estimatedKb} KB`;
    }
    function _getTextLintMeta() {
      return window.TextLinter?.getSettingMeta?.() ?? [
        { key: 'trimLines', label: 'Обрезать края строк' },
        { key: 'collapseSpaces', label: 'Схлопывать лишние пробелы' },
        { key: 'punctuationSpacing', label: 'Пробелы у знаков препинания' },
        { key: 'normalizeAbbreviations', label: 'Нормализовать сокращения: т. д., т. п.' },
        { key: 'compactAbbreviations', label: 'Компактные сокращения: т.д., т.п.', risky: true },
        { key: 'collapseBlankLines', label: 'Убирать лишние пустые строки' },
        { key: 'showHints', label: 'Показывать подсказки без автоправки' },
      ];
    }
    function _renderTextLintSettings() {
      const box = document.getElementById('llm-text-lint-settings');
      if (!box) return;
      const api = window.TextLinter;
      const settings = api?.getSettings?.() ?? {};
      const disabled = !api?.setSetting;
      const meta = _getTextLintMeta();
      box.innerHTML = meta.map(item =>
        `<label class="llm-compact-option${item.risky ? ' llm-compact-option-risky' : ''}" title="${_esc(item.hint || (item.risky ? 'Осторожная опция: применяй осознанно' : 'Безопасная настройка'))}">` +
          `<input type="checkbox" data-llm-lint-setting="${_esc(item.key)}"${settings[item.key] ? ' checked' : ''}${disabled ? ' disabled' : ''}>` +
          `<span>${_esc(item.label)}${item.risky ? ' ⚠' : ''}</span>` +
        `</label>`
      ).join('') + (disabled ? '<span class="settings-hint">text-linter.js ещё не загружен</span>' : '');
    }
    function _syncAutoPoet() {
      const ghost = _State.getLayout()?.llm?.ghost ?? {};
      _setCheck('llm-ap-enabled', ghost.enabled ?? false);
      _set('llm-ap-strategy', ghost.strategy ?? 'word');
      _set('llm-ap-debounce', ghost.debounce ?? 800);
      _set('llm-ap-lines', ghost.lines ?? 3);
      _set('llm-ap-acceptkey', ghost.acceptKey ?? 'Tab');
      _set('llm-ap-minchars', ghost.minChars ?? 20);
      _setCheck('llm-ap-nocode', ghost.noCode ?? true);
      _setCheck('llm-ap-novars', ghost.noVars ?? true);
      _setCheck('llm-ap-matrix', ghost.matrixEffect ?? false);
      _set('llm-ap-matrix-ms', _clampEffectMs(ghost.matrixEffectMs));
      const wordsEl = document.getElementById('llm-ap-words');
      const wordsVal = document.getElementById('llm-ap-words-val');
      if (wordsEl) wordsEl.value = ghost.words ?? 5;
      if (wordsVal) wordsVal.textContent = ghost.words ?? 5;
      const apSel = document.getElementById('llm-ap-profile');
      if (apSel) {
        const profiles = _State.getLayout()?.llm?.profiles ?? [];
        apSel.innerHTML = '<option value="">— активный —</option>';
        profiles.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; apSel.appendChild(opt); });
        apSel.value = ghost.profileId ?? '';
      }
    }
    function _saveAutoPoet() {
      const lay = _State.getLayout();
      const wordsEl = document.getElementById('llm-ap-words');
      const ghost = {
        ...(lay?.llm?.ghost ?? {}), enabled: _getCheck('llm-ap-enabled'), profileId: _get('llm-ap-profile'),
        strategy: _get('llm-ap-strategy'), debounce: parseInt(_get('llm-ap-debounce'), 10) || 800,
        words: Math.max(1, Math.min(30, parseInt(wordsEl?.value ?? 5, 10) || 5)),
        lines: parseInt(_get('llm-ap-lines'), 10) || 3, acceptKey: _get('llm-ap-acceptkey'),
        minChars: parseInt(_get('llm-ap-minchars'), 10) || 20, noCode: _getCheck('llm-ap-nocode'),
        noVars: _getCheck('llm-ap-novars'), matrixEffect: _getCheck('llm-ap-matrix'),
        matrixEffectMs: _clampEffectMs(_get('llm-ap-matrix-ms')),
      };
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), ghost } });
    }
    function _saveGeneral() {
      const lay = _State.getLayout();
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), enabled: _getCheck('llm-enabled'), autoSnapshot: _getCheck('llm-auto-snapshot'), saveResults: _getCheck('llm-save-results'), debugMode: _getCheck('llm-debug'), visualDiff: _getCheck('llm-visual-diff'), diffMode: _get('llm-diff-mode') || 'classic', diffEffectMs: _clampEffectMs(_get('llm-diff-effect-ms')), cache: { ...(lay?.llm?.cache ?? {}), enabled: _getCheck('llm-cache-enabled'), ttlH: parseInt(_get('llm-cache-ttl'), 10) || 24, maxEntries: parseInt(_get('llm-cache-max'), 10) || 200 } } });
    }
    function _renderBroTags() {
      const lay = _State.getLayout();
      const profiles = lay?.llm?.profiles ?? [];
      const tags = lay?.llm?.bro?.tags ?? [];
      _set('llm-bro-depth', lay?.llm?.bro?.chatDepth ?? 6);
      const profileOptions = (cur = '') => '<option value="">— активный —</option>' + profiles.map(p => `<option value="${_esc(p.id)}"${p.id === cur ? ' selected' : ''}>${_esc(p.name || p.id)}</option>`).join('');
      document.querySelectorAll('.llm-tag-profile-sel[data-builtin]').forEach(sel => {
        const cur = tags.find(t => t.tag === sel.dataset.builtin)?.profileId ?? sel.value;
        sel.innerHTML = profileOptions(cur);
      });

      const list = document.getElementById('llm-custom-tags-list');
      if (!list) return;
      const customTags = tags.filter(t => t.custom);
      list.innerHTML = '';
      if (!customTags.length) {
        list.innerHTML = '<div class="llm-custom-tags-empty">Свои теги ещё не добавлены</div>';
        return;
      }
      customTags.forEach((tag, idx) => {
        const row = document.createElement('div');
        row.className = 'llm-custom-tag-row';
        row.dataset.idx = String(idx);
        row.innerHTML =
          `<input class="llm-custom-tag-name" value="${_esc(tag.tag || '!новый')}" placeholder="!тег" aria-label="Имя тега">` +
          `<select class="llm-custom-tag-profile" aria-label="Профиль пользовательского тега">${profileOptions(tag.profileId || '')}</select>` +
          `<textarea class="llm-custom-tag-prompt" rows="2" placeholder="Системный промпт для этого тега" aria-label="Промпт пользовательского тега">${_esc(tag.prompt || '')}</textarea>` +
          `<button type="button" class="btn-icon btn-icon-danger llm-custom-tag-del" title="Удалить тег" aria-label="Удалить тег">✕</button>`;
        list.appendChild(row);
      });
    }
    function _ensurePromptGroupsReady() {
      if (_promptGroupsReady) return;
      PROMPT_GROUPS.forEach(group => _promptCollapsedGroups.add(group.label));
      _promptCollapsedGroups.delete('Хранилище');
      _promptGroupsReady = true;
    }
    function _getPromptGroupList() {
      return [...PROMPT_GROUPS, { label: 'Хранилище', keys: [STORAGE_GROUP_KEY] }];
    }
    function _getStorageEntries() {
      const entries = _State.getLayout()?.llm?.promptStorage?.entries;
      return Array.isArray(entries) ? entries : [];
    }
    function _saveStorageEntries(entries) {
      const lay = _State.getLayout();
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), promptStorage: { entries } } });
    }
    function _storageEntryMeta(entry) {
      const title = String(entry?.title || '').trim() || 'Без названия';
      const notes = String(entry?.notes || '').trim();
      const modelHint = String(entry?.modelHint || '').trim();
      const prompt = String(entry?.prompt || '');
      const uses = Math.max(0, parseInt(entry?.uses, 10) || 0);
      const updatedAt = parseInt(entry?.updatedAt, 10) || 0;
      return { title, notes, modelHint, prompt, uses, updatedAt };
    }
    function _formatStorageTime(ts) {
      if (!ts) return 'ещё не сохранено';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return 'ещё не сохранено';
      return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function _ensureStorageSelection() {
      const entries = _getStorageEntries();
      if (!entries.length) {
        _storageSelectedId = null;
        return null;
      }
      if (entries.some(item => item.id === _storageSelectedId)) return _storageSelectedId;
      _storageSelectedId = entries[0].id;
      return _storageSelectedId;
    }
    function _createStorageEntry(seed = {}) {
      return {
        id: _uid(),
        title: seed.title || 'Новая запись',
        prompt: seed.prompt || '',
        notes: seed.notes || '',
        modelHint: seed.modelHint || '',
        uses: Math.max(0, parseInt(seed.uses, 10) || 0),
        updatedAt: Date.now(),
      };
    }
    function _saveStorageEditor() {
      const panel = document.getElementById('llm-prompt-storage-panel');
      if (!panel || panel.hidden || !_storageSelectedId) return;
      const entries = _getStorageEntries();
      const idx = entries.findIndex(item => item.id === _storageSelectedId);
      if (idx < 0) return;
      const titleInput = document.getElementById('llm-storage-title');
      const modelInput = document.getElementById('llm-storage-model-hint');
      const notesInput = document.getElementById('llm-storage-notes');
      const promptInput = document.getElementById('llm-storage-editor');
      const activeEl = document.activeElement;
      const activeId = activeEl?.id || '';
      const selStart = typeof activeEl?.selectionStart === 'number' ? activeEl.selectionStart : null;
      const selEnd = typeof activeEl?.selectionEnd === 'number' ? activeEl.selectionEnd : null;
      const next = [...entries];
      next[idx] = {
        ...next[idx],
        title: (titleInput?.value ?? '').replace(/\r\n/g, '\n'),
        modelHint: modelInput?.value ?? '',
        notes: notesInput?.value ?? '',
        prompt: promptInput?.value ?? '',
        updatedAt: Date.now(),
      };
      _saveStorageEntries(next);
      _renderStorageEditor();
      if (!activeId) return;
      const field = document.getElementById(activeId);
      if (!field || typeof field.setSelectionRange !== 'function' || selStart == null) return;
      field.focus();
      field.setSelectionRange(Math.min(selStart, field.value.length), Math.min(selEnd ?? selStart, field.value.length));
    }
    function _updateStorageActionState() {
      const hasSelection = !!_storageSelectedId && _getStorageEntries().some(item => item.id === _storageSelectedId);
      ['llm-storage-copy', 'llm-storage-duplicate', 'llm-storage-create-tag', 'llm-storage-delete', 'llm-storage-apply'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !hasSelection;
      });
      ['llm-storage-title', 'llm-storage-model-hint', 'llm-storage-notes', 'llm-storage-editor'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.disabled = !hasSelection;
      });
    }
    function _renderStorageEditor() {
      const panel = document.getElementById('llm-prompt-storage-panel');
      const list = document.getElementById('llm-storage-list');
      if (!panel || panel.hidden || !list) return;
      const entries = _getStorageEntries();
      const selectedId = _ensureStorageSelection();
      list.innerHTML = '';
      if (!entries.length) {
        list.innerHTML = '<div class="llm-storage-empty">Пока здесь пусто. Нажмите «Добавить промпт», чтобы собрать свою библиотеку готовых шаблонов.</div>';
        _set('llm-storage-title', '');
        _set('llm-storage-model-hint', '');
        _set('llm-storage-notes', '');
        _set('llm-storage-editor', '');
        const updated = document.getElementById('llm-storage-updated');
        if (updated) updated.textContent = '';
        _updateStorageActionState();
        return;
      }
      entries.forEach(entry => {
        const meta = _storageEntryMeta(entry);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'llm-storage-item' + (entry.id === selectedId ? ' active' : '');
        btn.dataset.storageId = entry.id;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', entry.id === selectedId ? 'true' : 'false');
        const subtitle = meta.modelHint || 'без привязки к модели';
        btn.innerHTML = `<span class="llm-storage-item-head"><span class="llm-storage-item-title">${_esc(meta.title)}</span><span class="llm-storage-item-uses" title="Использовано">${meta.uses}</span></span><span class="llm-storage-item-meta">${_esc(subtitle)}</span><span class="llm-storage-item-note">${_esc(meta.notes || 'Готовый шаблон для повторного использования.')}</span>`;
        list.appendChild(btn);
      });
      const selected = entries.find(item => item.id === selectedId) || entries[0];
      if (!selected) {
        _updateStorageActionState();
        return;
      }
      const meta = _storageEntryMeta(selected);
      const titleInput = document.getElementById('llm-storage-title');
      const modelInput = document.getElementById('llm-storage-model-hint');
      const notesInput = document.getElementById('llm-storage-notes');
      const promptInput = document.getElementById('llm-storage-editor');
      if (titleInput && document.activeElement !== titleInput) titleInput.value = selected.title ?? meta.title;
      if (modelInput && document.activeElement !== modelInput) modelInput.value = meta.modelHint;
      if (notesInput && document.activeElement !== notesInput) notesInput.value = selected.notes || '';
      if (promptInput && document.activeElement !== promptInput) promptInput.value = selected.prompt || '';
      const updated = document.getElementById('llm-storage-updated');
      if (updated) updated.textContent = 'обновлено ' + _formatStorageTime(meta.updatedAt);
      _updateStorageActionState();
    }
    function _showStoragePanel() {
      const panel = document.getElementById('llm-prompt-storage-panel');
      const editor = document.getElementById('llm-prompt-editor');
      const warnings = document.getElementById('llm-prompt-warnings');
      const actions = document.querySelector('.llm-prompt-actions');
      const test = document.querySelector('.llm-prompt-test');
      const meta = document.getElementById('llm-prompt-meta');
      const section = document.getElementById('llm-prompt-section-title');
      const title = document.getElementById('llm-prompt-title');
      const status = document.getElementById('llm-prompt-status');
      const card = document.querySelector('.llm-prompt-card');
      if (panel) panel.hidden = false;
      if (editor) editor.hidden = true;
      if (warnings) warnings.hidden = true;
      if (actions) actions.hidden = true;
      if (test) test.hidden = true;
      if (card) card.classList.add('llm-prompt-card-storage');
      if (meta) {
        meta.hidden = true;
        meta.innerHTML = '';
      }
      if (section) section.textContent = 'Хранилище';
      if (title) title.textContent = 'Библиотека готовых промптов';
      if (status) {
        status.hidden = true;
        status.className = 'llm-prompt-status llm-prompt-status-default';
        status.innerHTML = '<span aria-hidden="true">◌</span>';
        status.setAttribute('aria-label', 'Хранилище');
        status.title = 'Хранилище';
      }
      _clearDangerButton(document.getElementById('llm-storage-delete'), '✕', 'Удалить запись');
      _renderStorageEditor();
    }
    function _hideStoragePanel() {
      const panel = document.getElementById('llm-prompt-storage-panel');
      const editor = document.getElementById('llm-prompt-editor');
      const warnings = document.getElementById('llm-prompt-warnings');
      const actions = document.querySelector('.llm-prompt-actions');
      const test = document.querySelector('.llm-prompt-test');
      const meta = document.getElementById('llm-prompt-meta');
      const section = document.getElementById('llm-prompt-section-title');
      const status = document.getElementById('llm-prompt-status');
      const card = document.querySelector('.llm-prompt-card');
      if (panel) panel.hidden = true;
      if (editor) editor.hidden = false;
      if (warnings) warnings.hidden = false;
      if (actions) actions.hidden = false;
      if (test) test.hidden = false;
      if (card) card.classList.remove('llm-prompt-card-storage');
      if (meta) meta.hidden = false;
      if (status) status.hidden = false;
      if (section) section.textContent = 'Системный промпт';
    }
    function _addStorageEntry(seed = null) {
      const entries = _getStorageEntries();
      const entry = _createStorageEntry(seed || {});
      _storageSelectedId = entry.id;
      _saveStorageEntries([entry, ...entries]);
      _renderStorageEditor();
      document.getElementById('llm-storage-title')?.focus();
      document.getElementById('llm-storage-title')?.select?.();
    }
    function _duplicateStorageEntry() {
      const entries = _getStorageEntries();
      const current = entries.find(item => item.id === _storageSelectedId);
      if (!current) return;
      _addStorageEntry({
        title: `${String(current.title || 'Запись').trim() || 'Запись'} copy`,
        prompt: current.prompt || '',
        notes: current.notes || '',
        modelHint: current.modelHint || '',
      });
      window.Toast?.show('Запись продублирована ✓', 'success');
    }
    async function _copyStoragePrompt() {
      const entry = _getStorageEntries().find(item => item.id === _storageSelectedId);
      if (!entry?.prompt) {
        window.Toast?.show('Промпт пустой', 'error');
        return;
      }
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(entry.prompt);
        window.Toast?.show('Промпт скопирован ✓', 'success');
      } catch {
        window.Toast?.show('Не удалось скопировать промпт', 'error');
      }
    }
    function _applyStorageToCurrentPrompt() {
      const entry = _getStorageEntries().find(item => item.id === _storageSelectedId);
      const ed = document.getElementById('llm-prompt-editor');
      const key = ed?.dataset?.applyKey || _lastNonStoragePromptKey;
      if (!entry?.prompt) {
        window.Toast?.show('Сначала заполните промпт в хранилище', 'error');
        return;
      }
      if (!key || key === STORAGE_GROUP_KEY || !BUILTIN_PROMPTS[key]) {
        window.Toast?.show('Сначала выберите целевую функцию слева', 'error');
        return;
      }
      const lay = _State.getLayout();
      const customPrompts = { ...(lay?.llm?.customPrompts ?? {}) };
      if (entry.prompt === (BUILTIN_PROMPTS[key] ?? '')) delete customPrompts[key];
      else customPrompts[key] = entry.prompt;
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), customPrompts } });
      _lastNonStoragePromptKey = key;
      const entries = _getStorageEntries();
      const idx = entries.findIndex(item => item.id === entry.id);
      if (idx >= 0) {
        const next = [...entries];
        next[idx] = { ...next[idx], uses: (parseInt(next[idx].uses, 10) || 0) + 1, updatedAt: Date.now() };
        _saveStorageEntries(next);
      }
      _renderPromptFnList();
      _selectPromptKey(key, true);
      window.Toast?.show('Промпт применён к функции ✓', 'success');
    }
    function _createBroTagFromStorage() {
      const entry = _getStorageEntries().find(item => item.id === _storageSelectedId);
      const prompt = String(entry?.prompt || '').trim();
      if (!prompt) {
        window.Toast?.show('Сначала заполните промпт в хранилище', 'error');
        return;
      }
      const lay = _State.getLayout();
      const tags = [...(lay?.llm?.bro?.tags ?? [])];
      const baseRaw = String(entry?.title || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'мой-тег';
      let tag = '!' + baseRaw;
      let n = 2;
      while (tags.some(t => String(t.tag).toLowerCase() === tag)) tag = '!' + baseRaw + '-' + n++;
      tags.push({ tag, custom: true, action: 'custom', useTabContext: true, profileId: '', prompt });
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), bro: { ...(lay?.llm?.bro ?? {}), tags } } });
      _renderBroTags();
      window.Toast?.show('Создан БРО-тег ' + tag + ' ✓', 'success');
    }
    function _deleteStorageEntry() {
      const btn = document.getElementById('llm-storage-delete');
      if (!_storageSelectedId || !_armDangerButton(btn, '✕')) return;
      _clearDangerButton(btn, '✕', 'Удалить запись');
      const next = _getStorageEntries().filter(item => item.id !== _storageSelectedId);
      _storageSelectedId = next[0]?.id ?? null;
      _saveStorageEntries(next);
      _renderStorageEditor();
      window.Toast?.show('Запись удалена ✓', 'success');
    }
    function _renderPromptFnList() {
      const list = document.getElementById('llm-prompt-fn-list');
      if (!list) return;
      _ensurePromptGroupsReady();
      const ed = document.getElementById('llm-prompt-editor');
      const currentKey = ed?.dataset?.key;
      const fallbackKey = _lastNonStoragePromptKey && BUILTIN_PROMPTS[_lastNonStoragePromptKey]
        ? _lastNonStoragePromptKey
        : Object.keys(BUILTIN_PROMPTS)[0];
      const selectedKey = currentKey === STORAGE_GROUP_KEY || BUILTIN_PROMPTS[currentKey]
        ? currentKey
        : fallbackKey;
      const custom = _State.getLayout()?.llm?.customPrompts ?? {};
      list.innerHTML = '';

      const controls = document.createElement('div');
      controls.className = 'llm-prompt-group-controls';
      controls.innerHTML = '<button type="button" data-action="expand">Развернуть</button><button type="button" data-action="collapse">Свернуть</button>';
      controls.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const groups = _getPromptGroupList();
        if (btn.dataset.action === 'collapse') groups.forEach(group => _promptCollapsedGroups.add(group.label));
        else _promptCollapsedGroups.clear();
        _renderPromptFnList();
      });
      list.appendChild(controls);

      _getPromptGroupList().forEach(group => {
        const keys = group.keys.filter(key => key === STORAGE_GROUP_KEY || BUILTIN_PROMPTS[key] != null);
        if (!keys.length) return;
        const isCollapsed = _promptCollapsedGroups.has(group.label);
        const groupBox = document.createElement('section');
        groupBox.className = 'llm-prompt-group' + (isCollapsed ? ' collapsed' : '');
        const bodyId = 'llm-prompt-group-' + group.label.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-');
        const states = keys.map(key => {
          if (key === STORAGE_GROUP_KEY) {
            const entries = _getStorageEntries();
            return {
              key,
              isStorage: true,
              state: { level: entries.length ? 'changed' : 'default', label: entries.length ? `${entries.length} записей` : 'пусто', warnings: [] },
              count: entries.length,
            };
          }
          return { key, isCustom: Object.prototype.hasOwnProperty.call(custom, key), state: _validatePrompt(key, custom[key] ?? BUILTIN_PROMPTS[key] ?? '') };
        });
        const changedCount = states.filter(item => item.isCustom).length;
        const issueCount = states.filter(item => item.state.level === 'error' || item.state.level === 'risk').length;

        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'llm-prompt-group-title';
        title.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        title.setAttribute('aria-controls', bodyId);
        title.innerHTML = `<span class="llm-prompt-group-chevron" aria-hidden="true">▾</span><span>${_esc(group.label)}</span><span class="llm-prompt-group-count">${keys.length}</span>${changedCount ? `<span class="llm-prompt-group-mark changed">${changedCount} изм</span>` : ''}${issueCount ? `<span class="llm-prompt-group-mark risk">${issueCount} риск</span>` : ''}`;
        title.addEventListener('click', () => {
          if (_promptCollapsedGroups.has(group.label)) _promptCollapsedGroups.delete(group.label);
          else _promptCollapsedGroups.add(group.label);
          _renderPromptFnList();
        });
        groupBox.appendChild(title);

        const body = document.createElement('div');
        body.id = bodyId;
        body.className = 'llm-prompt-group-body';
        body.hidden = isCollapsed;
        states.forEach(({ key, isCustom, isStorage, state, count }) => {
          if (isStorage) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'llm-prompt-fn-item llm-prompt-fn-item-storage' + (key === selectedKey ? ' active' : '');
            btn.dataset.key = key;
            btn.setAttribute('aria-current', key === selectedKey ? 'true' : 'false');
            btn.innerHTML = `<span class="llm-prompt-fn-main"><span class="llm-prompt-fn-title">Хранилище</span></span><span class="llm-prompt-mini-status changed" title="${_esc(state.label)}" aria-label="${_esc(state.label)}">${count ?? 0}</span>`;
            btn.addEventListener('click', () => _selectPromptKey(key));
            body.appendChild(btn);
            return;
          }
          const meta = PROMPT_META[key] ?? _promptFallbackMeta(key, group.label);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'llm-prompt-fn-item' + (key === selectedKey ? ' active' : '');
          btn.dataset.key = key;
          btn.setAttribute('aria-current', key === selectedKey ? 'true' : 'false');
          const statusClass = state.level === 'error' || state.level === 'risk' ? state.level : (isCustom ? 'changed' : 'default');
          const statusText = state.level === 'error' || state.level === 'risk' ? state.label : (isCustom ? 'изм' : state.label);
          btn.innerHTML = `<span class="llm-prompt-fn-main"><span class="llm-prompt-fn-title">${_esc(meta.title)}</span><span class="llm-prompt-fn-desc">${_esc(meta.short)}</span></span><span class="llm-prompt-mini-status ${statusClass}" title="${_esc(statusText)}" aria-label="${_esc(statusText)}">${_statusIcon(statusClass)}</span>`;
          btn.addEventListener('click', () => _selectPromptKey(key));
          body.appendChild(btn);
        });
        groupBox.appendChild(body);
        list.appendChild(groupBox);
      });
      _selectPromptKey(selectedKey, true);
    }
    function _promptFallbackMeta(key, group = 'Служебные') {
      return { title: key, group, short: 'Системная инструкция встроенной функции.', usedIn: 'Внутренние LLM-функции.', output: 'Зависит от функции.', vars: [] };
    }
    function _selectPromptKey(key, keepFocus = false) {
      const ed = document.getElementById('llm-prompt-editor');
      if (!ed) return;
      if (key === STORAGE_GROUP_KEY) {
        const fallbackKey = _lastNonStoragePromptKey && BUILTIN_PROMPTS[_lastNonStoragePromptKey]
          ? _lastNonStoragePromptKey
          : Object.keys(BUILTIN_PROMPTS)[0];
        ed.dataset.key = STORAGE_GROUP_KEY;
        ed.dataset.applyKey = fallbackKey;
        document.querySelectorAll('.llm-prompt-fn-item').forEach(btn => {
          const active = btn.dataset.key === key;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-current', active ? 'true' : 'false');
        });
        _showStoragePanel();
        if (!keepFocus) document.getElementById('llm-storage-title')?.focus();
        return;
      }
      if (!BUILTIN_PROMPTS[key]) return;
      _lastNonStoragePromptKey = key;
      _hideStoragePanel();
      const custom = _State.getLayout()?.llm?.customPrompts ?? {};
      const meta = PROMPT_META[key] ?? _promptFallbackMeta(key);
      ed.value = custom[key] ?? BUILTIN_PROMPTS[key] ?? '';
      ed.dataset.key = key;
      ed.dataset.applyKey = key;
      document.querySelectorAll('.llm-prompt-fn-item').forEach(btn => {
        const active = btn.dataset.key === key;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-current', active ? 'true' : 'false');
      });
      const title = document.getElementById('llm-prompt-title');
      const metaBox = document.getElementById('llm-prompt-meta');
      if (title) title.textContent = meta.title;
      if (metaBox) {
        const vars = meta.vars?.length ? meta.vars.map(v => `<code>{${_esc(v)}}</code>`).join(' ') : 'нет';
        metaBox.innerHTML =
          `<div><b>Группа:</b> ${_esc(meta.group)}</div>` +
          `<div><b>Где используется:</b> ${_esc(meta.usedIn)}</div>` +
          `<div><b>Ожидаемый ответ:</b> ${_esc(meta.output)}</div>` +
          `<div><b>Нельзя удалять:</b> ${vars}</div>`;
      }
      _updatePromptStatus();
      if (!keepFocus) ed.focus();
    }
    function _validatePrompt(key, value) {
      const meta = PROMPT_META[key] ?? _promptFallbackMeta(key);
      const text = String(value ?? '').trim();
      const missing = (meta.vars ?? []).filter(v => !text.includes('{' + v + '}'));
      const warnings = [];
      if (!text) warnings.push('Промпт пустой. Функция не сможет корректно обратиться к модели.');
      if (missing.length) warnings.push('Удалены обязательные переменные: ' + missing.map(v => `{${v}}`).join(', ') + '.');
      if (meta.requiresJson && !/json/i.test(text)) warnings.push('Для этой функции нужно явно требовать JSON-ответ.');
      const hasOnlyRule = /\b(return|output|answer|respond)\b.{0,70}\bonly\b/i.test(text) || /(верни|ответь|выведи).{0,70}только/i.test(text) || /только.{0,70}(результат|ответ|текст|перевод|продолжение)/i.test(text);
      if (meta.requiresOnly && !hasOnlyRule) warnings.push('Есть риск лишних пояснений: лучше явно требовать вернуть только результат.');
      if (!text || missing.length) return { level: 'error', label: 'ошибка переменных', warnings };
      if (warnings.length) return { level: 'risk', label: 'есть риск', warnings };
      return { level: 'default', label: 'default', warnings };
    }
    function _updatePromptStatus() {
      const ed = document.getElementById('llm-prompt-editor');
      const st = document.getElementById('llm-prompt-status');
      const warn = document.getElementById('llm-prompt-warnings');
      if (!ed || !st) return;
      const key = ed.dataset.key;
      if (key === STORAGE_GROUP_KEY) {
        st.className = 'llm-prompt-status llm-prompt-status-default';
        st.innerHTML = `<span aria-hidden="true">${_statusIcon('default')}</span>`;
        st.setAttribute('aria-label', 'Хранилище');
        st.title = 'Хранилище';
        if (warn) warn.innerHTML = '';
        return;
      }
      const custom = _State.getLayout()?.llm?.customPrompts ?? {};
      const isCustom = Object.prototype.hasOwnProperty.call(custom, key);
      const changedInEditor = ed.value !== (BUILTIN_PROMPTS[key] ?? '');
      const state = _validatePrompt(key, ed.value);
      const label = state.level === 'error' ? state.label : (isCustom || changedInEditor ? 'изменён' : 'по умолчанию');
      const statusKind = state.level === 'error' ? 'error' : state.level === 'risk' ? 'risk' : (isCustom || changedInEditor ? 'changed' : 'default');
      st.className = 'llm-prompt-status llm-prompt-status-' + statusKind;
      st.innerHTML = `<span aria-hidden="true">${_statusIcon(statusKind)}</span>`;
      st.setAttribute('aria-label', label);
      st.title = label;
      if (warn) warn.innerHTML = state.warnings.map(w => `<div>${_esc(w)}</div>`).join('');
    }
    function _savePrompt() {
      const ed = document.getElementById('llm-prompt-editor');
      const key = ed?.dataset?.key;
      if (!key || key === STORAGE_GROUP_KEY) return;
      const state = _validatePrompt(key, ed.value);
      if (state.level === 'error') { window.Toast?.show(state.warnings[0] || 'Промпт нельзя сохранить', 'error'); _updatePromptStatus(); return; }
      const lay = _State.getLayout();
      const customPrompts = { ...(lay?.llm?.customPrompts ?? {}) };
      if (ed.value === (BUILTIN_PROMPTS[key] ?? '')) delete customPrompts[key];
      else customPrompts[key] = ed.value;
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), customPrompts } });
      _renderPromptFnList();
      _selectPromptKey(key, true);
      window.Toast?.show(ed.value === (BUILTIN_PROMPTS[key] ?? '') ? 'Промпт совпадает с дефолтом ✓' : (state.level === 'risk' ? 'Промпт сохранён с предупреждением' : 'Промпт сохранён ✓'), state.level === 'risk' ? 'error' : 'success');
    }
    function _resetPrompt() {
      const ed = document.getElementById('llm-prompt-editor');
      const key = ed?.dataset?.key;
      if (!key) return;
      const lay = _State.getLayout();
      const customPrompts = { ...(lay?.llm?.customPrompts ?? {}) };
      delete customPrompts[key];
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), customPrompts } });
      _renderPromptFnList();
      _selectPromptKey(key, true);
      window.Toast?.show('Промпт сброшен к дефолту ✓', 'success');
    }
    function _resetAllPrompts() {
      const btn = document.getElementById('llm-prompt-reset-all');
      if (!_armDangerButton(btn, '✕ Сбросить?')) return;
      _clearDangerButton(btn, '↺ Сбросить все', 'Сбросить все пользовательские системные промпты');
      const lay = _State.getLayout();
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), customPrompts: {} } });
      _renderPromptFnList();
      window.Toast?.show('Все системные промпты сброшены ✓', 'success');
    }
    async function _copyDefaultPrompt() {
      const key = document.getElementById('llm-prompt-editor')?.dataset?.key;
      if (!key) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(BUILTIN_PROMPTS[key] ?? '');
        window.Toast?.show('Дефолтный промпт скопирован ✓', 'success');
      } catch { window.Toast?.show('Не удалось скопировать промпт', 'error'); }
    }
    async function _testPrompt() {
      const ed = document.getElementById('llm-prompt-editor');
      const input = document.getElementById('llm-prompt-test-input');
      const output = document.getElementById('llm-prompt-test-output');
      const status = document.getElementById('llm-prompt-test-status');
      const btn = document.getElementById('llm-prompt-test-run');
      const key = ed?.dataset?.key;
      if (!key || key === STORAGE_GROUP_KEY || !ed || !input || !output) return;
      if (!input.value.trim()) { window.Toast?.show('Добавьте короткий тестовый текст', 'error'); return; }
      if (btn) btn.disabled = true;
      output.textContent = '';
      if (status) status.textContent = '⏳ Проверяю...';
      try {
        const result = await request({
          featureTag: 'prompt-test', stream: false, timeoutMs: 120_000, maxTokens: 900,
          messages: [{ role: 'system', content: ed.value }, { role: 'user', content: input.value.trim() || 'Коротко проверь, что системный промпт понятен.' }],
        });
        output.textContent = result || 'Модель вернула пустой ответ.';
        if (status) status.textContent = '✓ Готово';
      } catch (err) {
        output.textContent = '';
        if (status) status.textContent = '✕ Ошибка проверки';
        window.Toast?.show(err.message || 'Ошибка проверки промпта', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    function _normalizeBroTagName(raw) {
      const tag = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!tag) return '';
      return tag.startsWith('!') ? tag : '!' + tag;
    }
    function _saveBroDepth() { const lay = _State.getLayout(); _State.setLayout({ llm: { ...(lay?.llm ?? {}), bro: { ...(lay?.llm?.bro ?? {}), chatDepth: parseInt(_get('llm-bro-depth'), 10) || 6 } } }); }
    function _collectBroTags() {
      const tags = [];
      document.querySelectorAll('.llm-tag-profile-sel[data-builtin]').forEach(sel => {
        const tag = sel.dataset.builtin;
        if (sel.value) tags.push({ tag, profileId: sel.value });
      });
      const seen = new Set(tags.map(t => t.tag));
      document.querySelectorAll('.llm-custom-tag-row').forEach(row => {
        const tag = _normalizeBroTagName(row.querySelector('.llm-custom-tag-name')?.value);
        const prompt = row.querySelector('.llm-custom-tag-prompt')?.value?.trim() ?? '';
        if (!tag || seen.has(tag) || !prompt) return;
        seen.add(tag);
        tags.push({ tag, custom: true, action: 'custom', useTabContext: true, profileId: row.querySelector('.llm-custom-tag-profile')?.value ?? '', prompt });
      });
      return tags;
    }
    function _saveBroTags() {
      const lay = _State.getLayout();
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), bro: { ...(lay?.llm?.bro ?? {}), tags: _collectBroTags() } } });
    }
    function _addCustomBroTag() {
      _saveBroTags();
      const lay = _State.getLayout();
      const tags = [...(lay?.llm?.bro?.tags ?? [])];
      let n = tags.filter(t => t.custom).length + 1;
      let tag = '!мой-тег-' + n;
      while (tags.some(t => t.tag === tag)) tag = '!мой-тег-' + (++n);
tags.push({
  tag,
  custom: true,
  action: 'custom',
  useTabContext: true,
  profileId: '',
  prompt: 'Ты — помощник в редакторе промптов. Используй текст текущей вкладки как основной контекст и выполни задачу пользователя точно по нему. Сохраняй смысл, язык, важные детали и формат, если они важны. Не выдумывай факты и не добавляй лишнее. Верни только готовый полезный результат без пояснений, вступлений и Markdown-обёрток.'
});
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), bro: { ...(lay?.llm?.bro ?? {}), tags } } });
      _renderBroTags();
    }
    function _saveAll() { _saveCurrentProfile(); _saveAutoPoet(); _saveGeneral(); _saveBroDepth(); _saveBroTags(); }
    function _bindEvents() {
      document.querySelectorAll('.llm-tab').forEach(tab => tab.addEventListener('click', () => { _saveAll(); _switchTab(tab.dataset.ltab); }));
      document.getElementById('llm-prf-list')?.addEventListener('click', e => {
        const btn = e.target.closest('.llm-prf-card[data-profile-id]');
        if (!btn) return;
        _saveCurrentProfile();
        _selectProfile(btn.dataset.profileId);
      });
      document.getElementById('llm-prf-provider')?.addEventListener('change', e => { const ep = document.getElementById('llm-prf-endpoint'); if (ep && _isDefaultEndpoint(ep.value)) ep.value = _providerBaseUrl(e.target.value); if (_selectedProfileId) { _modelsCache.delete(_selectedProfileId); _modelsMeta.delete(_selectedProfileId); } });
      document.getElementById('llm-prf-endpoint')?.addEventListener('change', () => { if (_selectedProfileId) { _modelsCache.delete(_selectedProfileId); _modelsMeta.delete(_selectedProfileId); } });
      document.getElementById('llm-prf-model')?.addEventListener('change', e => { e.target.title = e.target.selectedOptions?.[0]?.title || e.target.value || ''; });
      document.getElementById('llm-prf-add')?.addEventListener('click', () => { const lay = _State.getLayout(); const profiles = [...(lay?.llm?.profiles ?? [])]; const id = _uid(); profiles.push({ id, name: 'Новый профиль', provider: 'lmstudio', endpoint: PROVIDERS.lmstudio.baseUrl, model: '', temperature: 0.7, maxTokens: 2000, timeout: 30, retries: 2, thinkingMode: 'auto', streaming: true, useCache: true }); _selectedProfileId = id; _State.setLayout({ llm: { ...(lay?.llm ?? {}), profiles, activeProfileId: id } }); _renderProfileList(); });
      document.getElementById('llm-prf-del')?.addEventListener('click', e => { if (!_selectedProfileId || !_armDangerButton(e.currentTarget, '✕')) return; const lay = _State.getLayout(); const profiles = (lay?.llm?.profiles ?? []).filter(p => p.id !== _selectedProfileId); const activeProfileId = lay?.llm?.activeProfileId === _selectedProfileId ? (profiles[0]?.id ?? null) : lay?.llm?.activeProfileId; _Storage?.removeLLMKey?.(_selectedProfileId); _modelsCache.delete(_selectedProfileId); _modelsMeta.delete(_selectedProfileId); _selectedProfileId = activeProfileId; _State.setLayout({ llm: { ...(lay?.llm ?? {}), profiles, activeProfileId } }); _renderProfileList(); });
      document.getElementById('llm-prf-activate')?.addEventListener('click', () => {
        if (!_selectedProfileId) return;
        _saveCurrentProfile();
        const lay = _State.getLayout();
        _State.setLayout({ llm: { ...(lay?.llm ?? {}), activeProfileId: _selectedProfileId } });
        _renderProfileList();
        window.Toast?.show('Активный профиль выбран ✓', 'success');
      });
      document.getElementById('llm-load-models')?.addEventListener('click', async () => {
        if (!_selectedProfileId) return;
        const btn = document.getElementById('llm-load-models');
        const st = document.getElementById('llm-conn-status');
        if (btn) btn.disabled = true;
        if (st) st.textContent = '⏳ Загружаю...';
        _modelsCache.delete(_selectedProfileId);
        _modelsMeta.delete(_selectedProfileId);
        _saveCurrentProfile();
        try {
          const models = await loadModels(_selectedProfileId);
          const profile = (_State.getLayout()?.llm?.profiles ?? []).find(p => p.id === _selectedProfileId);
          if (profile) _populateModelSelect(profile);
          if (st) {
            const meta = _modelsMeta.get(_selectedProfileId) ?? {};
            const cherryNote = profile?.provider === 'cherry'
              ? ' · /v1/models показывает только модели, экспонированные Cherry API'
              : profile?.provider === 'cherryAnthropic'
                ? ' · загружены Anthropic-модели Cherry; запросы идут через /v1/messages'
                : '';
            const authNote = meta.authBypassedForModels ? ' · каталог загружен без Authorization; ключ проверяется реальным запросом' : '';
            st.textContent = models.length ? `✓ Загружено ${models.length} моделей${cherryNote}${authNote}` : '⚠ Подключение есть, моделей не найдено';
          }
        } catch (err) {
          if (st) st.textContent = '✕ Ошибка загрузки моделей';
          window.Toast?.show(err.message || 'Не удалось загрузить модели', 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
      document.getElementById('llm-test-all-models')?.addEventListener('click', _openModelStatusModal);
      document.getElementById('llm-test-conn')?.addEventListener('click', async () => {
        if (!_selectedProfileId) return;
        const st = document.getElementById('llm-conn-status');
        const status = document.getElementById('llm-prf-status');
        _saveCurrentProfile();
        if (st) st.textContent = '⏳ Проверяю...';
        const res = await testConnection(_selectedProfileId);
        if (st) st.textContent = res.ok ? `✓ ${res.message || 'OK'} · ${res.latencyMs} мс` : `✕ ${res.error}`;
        if (status) {
          status.className = 'llm-profile-status ' + (res.ok ? (res.warn ? 'warn' : 'ok') : 'error');
          status.textContent = res.ok ? (res.warn ? (res.stage === 'models' ? 'нет моделей' : 'ответ не OK') : 'OK') : (res.stage === 'auth' ? 'key error' : 'ошибка');
        }
      });
      const tempEl = document.getElementById('llm-prf-temp'); const tempVal = document.getElementById('llm-prf-temp-val'); if (tempEl && tempVal) tempEl.oninput = () => { tempVal.textContent = parseFloat(tempEl.value).toFixed(2); };
      const wordsEl = document.getElementById('llm-ap-words'); const wordsVal = document.getElementById('llm-ap-words-val'); if (wordsEl && wordsVal) wordsEl.oninput = () => { wordsVal.textContent = wordsEl.value; _saveAutoPoet(); };
      document.getElementById('llm-prompt-editor')?.addEventListener('input', _updatePromptStatus);
      document.getElementById('llm-storage-list')?.addEventListener('click', e => {
        const btn = e.target.closest('.llm-storage-item[data-storage-id]');
        if (!btn) return;
        _saveStorageEditor();
        _storageSelectedId = btn.dataset.storageId;
        _renderStorageEditor();
      });
      ['llm-storage-title','llm-storage-model-hint','llm-storage-notes','llm-storage-editor'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', _saveStorageEditor);
      });
      document.getElementById('llm-storage-add')?.addEventListener('click', () => _addStorageEntry());
      document.getElementById('llm-storage-duplicate')?.addEventListener('click', _duplicateStorageEntry);
      document.getElementById('llm-storage-copy')?.addEventListener('click', _copyStoragePrompt);
      document.getElementById('llm-storage-create-tag')?.addEventListener('click', _createBroTagFromStorage);
      document.getElementById('llm-storage-delete')?.addEventListener('click', _deleteStorageEntry);
      document.getElementById('llm-storage-apply')?.addEventListener('click', _applyStorageToCurrentPrompt);
      document.getElementById('llm-prompt-copy-default')?.addEventListener('click', _copyDefaultPrompt);
      document.getElementById('llm-prompt-reset')?.addEventListener('click', _resetPrompt);
      document.getElementById('llm-prompt-reset-all')?.addEventListener('click', _resetAllPrompts);
      document.getElementById('llm-prompt-save')?.addEventListener('click', _savePrompt);
      document.getElementById('llm-prompt-test-run')?.addEventListener('click', _testPrompt);
      document.getElementById('llm-cache-clear')?.addEventListener('click', e => { if (!_armDangerButton(e.currentTarget, '✕ Очистить?')) return; _clearDangerButton(e.currentTarget, '🗑 Очистить кэш', 'Очистить кэш'); LLMCache.clear(); LLMCache.invalidate(); _syncGeneral(); window.Toast?.show('Кэш очищен ✓', 'success'); });
      ['llm-enabled','llm-auto-snapshot','llm-save-results','llm-debug','llm-visual-diff','llm-diff-mode','llm-diff-effect-ms','llm-cache-enabled','llm-cache-ttl','llm-cache-max'].forEach(id => document.getElementById(id)?.addEventListener('change', _saveGeneral));
      document.getElementById('llm-text-lint-settings')?.addEventListener('change', e => {
        const input = e.target.closest('[data-llm-lint-setting]');
        if (!input) return;
        window.TextLinter?.setSetting?.(input.dataset.llmLintSetting, input.checked);
        window.Blocks?.clearTextLintBadgeCache?.();
      });
      ['llm-ap-enabled','llm-ap-profile','llm-ap-strategy','llm-ap-debounce','llm-ap-lines','llm-ap-acceptkey','llm-ap-minchars','llm-ap-nocode','llm-ap-novars','llm-ap-matrix','llm-ap-matrix-ms'].forEach(id => document.getElementById(id)?.addEventListener('change', _saveAutoPoet));
      document.getElementById('llm-bro-depth')?.addEventListener('change', _saveBroDepth);
      document.getElementById('llm-builtin-tags-body')?.addEventListener('change', e => { if (e.target.classList.contains('llm-tag-profile-sel')) _saveBroTags(); });
      document.getElementById('llm-add-tag')?.addEventListener('click', _addCustomBroTag);
      document.getElementById('llm-custom-tags-list')?.addEventListener('input', _saveBroTags);
      document.getElementById('llm-custom-tags-list')?.addEventListener('change', _saveBroTags);
      document.getElementById('llm-custom-tags-list')?.addEventListener('click', e => {
        const btn = e.target.closest('.llm-custom-tag-del');
        if (!btn || !_armDangerButton(btn, '✕')) return;
        btn.closest('.llm-custom-tag-row')?.remove();
        _saveBroTags();
        _renderBroTags();
      });
      document.getElementById('llm-modal-close')?.addEventListener('click', () => { _saveAll(); close(); });
    }
    return { open, close };
  })();

// =промпты=
const BUILTIN_PROMPTS = {
  autopot: 'You are an inline writing assistant. Continue ONLY from the end of the user’s text with exactly {N} words. Match the same language, tone, style, tense, and context. Make the continuation smooth, coherent, and directly usable. Do NOT repeat the input, mention the prompt, add explanations, quotes, headings, or extra text. If the last sentence is incomplete, only complete the sentence and nothing else. If the last sentence is complete, generate a new sentence that follows logically: Output exactly {N} words only.',
  groom_edit: 'You are a careful proofreader. Fix only typos, punctuation, spelling, and grammar in the text below. Preserve the author\'s language, meaning, tone, style, formatting, and line breaks. Do NOT rewrite, rephrase, simplify, expand, or add commentary. Return ONLY the corrected text.',
  groom_format: 'You are a Markdown formatter. Improve only the structure of the text using headings (##), bullet lists, spacing, and paragraphs. Do NOT change wording, meaning, tone, facts, or order unless required for clean formatting. Return ONLY the formatted text, with no Markdown fences or commentary.',
  groom_shrink_20: 'You are a text condenser. Shorten this text by about 20%. Remove filler, repetition, and weak phrases. Preserve all key facts, names, numbers, conclusions, and logical connections. Do NOT add new information or change meaning. Return ONLY the shortened text.',
  groom_shrink_40: 'You are a text condenser. Shorten this text by about 40%. Remove filler, merge repeated or similar points, and tighten wording. Preserve every important fact, name, number, conclusion, and logical connection. Do NOT add new information. Return ONLY the shortened text.',
  groom_shrink_60: 'You are a text condenser. Shorten this text by about 60%. Keep only essential facts, names, numbers, decisions, and conclusions. Remove examples, side notes, repetition, and elaboration. Do NOT add new information or distort meaning. Return ONLY the shortened text.',
  groom_expand: 'You are a text expander. Expand the text with relevant details, concrete examples, and brief explanations that directly support the original meaning. Stay strictly on topic. Do NOT invent facts, names, dates, statistics, sources, or promises. Return ONLY the expanded text.',
  groom_formal: 'You are a tone adapter. Rewrite this text in a formal business tone using neutral, clear vocabulary. Avoid slang, contractions, jokes, and emotional exaggeration. Preserve all facts, names, numbers, formatting, and exact meaning. Return ONLY the rewritten text.',
  groom_casual: 'You are a tone adapter. Rewrite this text in a casual conversational tone with everyday words and short natural sentences. Keep it clear, respectful, and not overly informal. Preserve all facts, names, numbers, formatting, and exact meaning. Return ONLY the rewritten text.',
  groom_tech: 'You are a tone adapter. Rewrite this text in a precise technical style. Use clear terms, exact descriptions, and concise sentences. Do NOT overcomplicate or add unsupported technical details. Preserve all facts, names, numbers, formatting, and meaning. Return ONLY the rewritten text.',
  groom_friendly: 'You are a tone adapter. Rewrite this text in a warm, friendly tone using positive phrasing and inclusive language. Keep it natural, clear, and not childish. Preserve all facts, names, numbers, formatting, and exact meaning. Return ONLY the rewritten text.',
  positive_instr: 'You are an instruction rewriter. Rewrite each negative instruction as a positive, action-oriented instruction. Preserve the original intent, scope, strength, and constraints exactly. Do NOT add new requirements. Return ONLY the rewritten text.',
  audit: 'Ты — аудитор промптов. Анализируй текст ниже и находи только самые критичные проблемы качества. Ищи максимум 5 проблем, фокусируясь на неоднозначности формулировок, противоречиях, расплывчатых или абстрактных инструкциях, повторах и избыточности, слабых или отсутствующих ограничениях, недостатке контекста, влияющем на результат. Для каждой проблемы укажи: ПРОБЛЕМА — краткое название, ГДЕ — конкретный фрагмент текста, ИСПРАВЛЕНИЕ — точечная правка (заменить, добавить или удалить). Не добавляй общих рассуждений, не переписывай весь текст и не выходи за пределы 5 пунктов.',
  compress: 'You are a prompt compressor. Remove redundancy from this prompt by merging repeated instructions, deleting filler, and tightening phrases. Preserve every unique instruction, constraint, variable, priority, and output requirement exactly. Do NOT change meaning or format requirements. Return ONLY the compressed prompt.',
  variations: 'You are a paraphraser. Give exactly 3 alternative phrasings of the text below. Preserve the same meaning, tone, and level of detail. Make each version clearly different. Return ONLY a numbered list from 1 to 3.',
  negatives: 'Ты — тестировщик промптов. Проанализируй промпт ниже и предскажи 3–5 конкретных способов, как LLM может неправильно его понять или выдать неожиданный, неполный или вредный ответ. Каждый риск должен быть конкретным и проверяемым. Верни ТОЛЬКО нумерованный список на русском.',
  autotitle: 'You are a title generator. Based on the text below, create exactly 10 alternative block titles. Requirements: exactly 3–5 words each; no period, no quotes, no markdown, no numbering; each title on its own line. Return exactly 10 lines, nothing else.',
  subtab_autotitle: 'You are a tab-title generator. Based on the text below, create exactly 10 alternative tab titles. Rules: (1) each title is 3–6 words; (2) the FIRST word should be a short powerful keyword (4–6 chars) that captures the core essence — for example "цвет", "GPT", "баг", "код"; (3) avoid generic openers like "это", "как", "вот"; (4) no periods, quotes, markdown, numbering. Return exactly 10 lines, one title per line, nothing else.',
  summary: 'Ты — редактор промптов. Составь краткое резюме (3–5 предложений) промпта ниже: опиши задачу, ожидаемый ввод, требуемый вывод и ключевые ограничения. Говори на русском. Верни ТОЛЬКО резюме без пояснений.',
  thesaurus: 'You are a contextual thesaurus. Suggest exactly 10 synonyms for the word "{word}" in the context: "{ctx}". Match the language of the input word (if English — respond in English, if Russian — respond in Russian). Avoid rare or awkward options. Return ONLY a numbered list without tags or explanations, e.g.: 1. word',
  fill_ph: 'You are an instruction completer. Complete this inline instruction: "{instruction}". Keep the result short, concrete, natural, and in the same style as the original. Do NOT add quotes, explanation, or extra alternatives. Return ONLY the completed instruction.',
  grade_prompt: 'You are a prompt evaluator. Rate this prompt on 5 criteria using integers from 1 to 10 only. Judge clarity, specificity, completeness, consistency, and conciseness. Return ONLY a valid JSON object with no markdown: {"clarity":N,"specificity":N,"completeness":N,"consistency":N,"conciseness":N,"summary":"one sentence overall verdict"}',
  bro_system: 'You are a concise helpful assistant embedded in a prompt editor. Answer directly in 1–3 sentences. Do NOT restate the question, add filler, or give examples unless asked. If the request is unclear, ask one short clarifying question.',
  fix_system: 'You are a text fixer. Fix only typos, punctuation, spelling, and grammar in the text below. Preserve meaning, tone, language, formatting, and line breaks. Do NOT rewrite, rephrase, expand, or add commentary. Return ONLY the corrected text.',
  eng_system: 'You are a translator to English. Translate the text below into natural, accurate English. Preserve formatting, line breaks, lists, code, placeholders, variables, and special markers. Do NOT add explanations. Return ONLY the translation.',
  ru_system: 'Ты — переводчик на русский язык. Переведи текст ниже на естественный и точный русский. Сохрани форматирование, переносы строк, списки, код, плейсхолдеры, переменные и специальные маркеры. Не добавляй пояснений. Верни ТОЛЬКО перевод.',
  sum_system: 'You are a summarizer. Summarize the text below in exactly 2–3 sentences. Keep only the main point, key facts, and conclusion. Do NOT add opinions or information not present in the text. Return ONLY the summary.',
  ask_system: 'You are a Q&A assistant. Answer the question using only the provided text. Do NOT add outside knowledge, guesses, or unsupported details. Format the answer as a Markdown blockquote: every line must start with "> ". Return ONLY the blockquote answer.',
  plan_system: 'Ты — планировщик задач в редакторе промптов. По тексту ниже составь короткий практичный план улучшений. Дай 3–7 шагов, где каждый шаг представляет одно конкретное действие, начинается с глагола (например: добавить, удалить, уточнить, разделить, переписать) и описывает точное изменение текста. Без вступлений, объяснений и выводов, только список действий, направленных на улучшение промпта.',
  chat_system: 'Ты — помощник в приложении. Пиши ясно и по делу: 1–3 предложения на ответ. Упрощай сложные вещи до сути, не теряя смысл, и давай конкретные, применимые советы вместо общих рассуждений. Если уместно — добавь лёгкую метафору или короткую шутку, но только если она усиливает понимание и не отвлекает. Всегда отвечай на языке пользователя. Если запрос неясен или двусмысленен — не угадывай, а задавай уточняющий вопрос.',
};

  const PROMPT_GROUPS = [
    { label: 'Автопоэт', keys: ['autopot'] },
    { label: 'Груминг текста', keys: ['groom_edit', 'groom_format', 'groom_shrink_20', 'groom_shrink_40', 'groom_shrink_60', 'groom_expand', 'groom_formal', 'groom_casual', 'groom_tech', 'groom_friendly'] },
    { label: 'Промпт-инженерия', keys: ['positive_instr', 'audit', 'compress', 'variations', 'negatives', 'grade_prompt'] },
    { label: 'БРО-теги', keys: ['bro_system', 'fix_system', 'eng_system', 'ru_system', 'sum_system', 'ask_system', 'plan_system'] },
    { label: 'Чат', keys: ['chat_system'] },
    { label: 'Служебные', keys: ['autotitle', 'subtab_autotitle', 'summary', 'thesaurus', 'fill_ph'] },
  ];

  const PROMPT_META = {
    autopot: { title: 'Автопоэт: продолжение текста', group: 'Автопоэт', short: 'Генерирует ghost-подсказку прямо при наборе текста.', usedIn: 'Автопоэт / inline continuation.', output: 'Только продолжение текста, без пояснений.', vars: ['N'], requiresOnly: true },
    groom_edit: { title: 'Исправить ошибки', group: 'Груминг текста', short: 'Правит опечатки, пунктуацию и грамматику.', usedIn: 'Меню «Причесать» → «Исправить».', output: 'Только исправленный текст в исходном языке.', vars: [], requiresOnly: true },
    groom_format: { title: 'Отформатировать Markdown', group: 'Груминг текста', short: 'Добавляет структуру без изменения смысла.', usedIn: 'Меню «Причесать» → форматирование.', output: 'Только Markdown-текст без code fences.', vars: [], requiresOnly: true },
    groom_shrink_20: { title: 'Сократить на 20%', group: 'Груминг текста', short: 'Мягко убирает лишнее, сохраняя детали.', usedIn: 'Меню «Причесать» → сокращение.', output: 'Только сокращённый текст.', vars: [], requiresOnly: true },
    groom_shrink_40: { title: 'Сократить на 40%', group: 'Груминг текста', short: 'Заметно уплотняет текст без новых фактов.', usedIn: 'Меню «Причесать» → сокращение.', output: 'Только сокращённый текст.', vars: [], requiresOnly: true },
    groom_shrink_60: { title: 'Сократить на 60%', group: 'Груминг текста', short: 'Оставляет только ключевые факты и выводы.', usedIn: 'Меню «Причесать» → сокращение.', output: 'Только короткая версия текста.', vars: [], requiresOnly: true },
    groom_expand: { title: 'Расширить текст', group: 'Груминг текста', short: 'Добавляет детали и примеры без выдуманных фактов.', usedIn: 'Меню «Причесать» → расширение.', output: 'Только расширенный текст.', vars: [], requiresOnly: true },
    groom_formal: { title: 'Формальный тон', group: 'Груминг текста', short: 'Переписывает текст деловым стилем.', usedIn: 'Меню «Причесать» → тон.', output: 'Только переписанный текст.', vars: [], requiresOnly: true },
    groom_casual: { title: 'Разговорный тон', group: 'Груминг текста', short: 'Делает текст проще и разговорнее.', usedIn: 'Меню «Причесать» → тон.', output: 'Только переписанный текст.', vars: [], requiresOnly: true },
    groom_tech: { title: 'Технический стиль', group: 'Груминг текста', short: 'Уточняет формулировки в техническом стиле.', usedIn: 'Меню «Причесать» → тон.', output: 'Только переписанный текст.', vars: [], requiresOnly: true },
    groom_friendly: { title: 'Дружелюбный тон', group: 'Груминг текста', short: 'Смягчает и делает текст теплее.', usedIn: 'Меню «Причесать» → тон.', output: 'Только переписанный текст.', vars: [], requiresOnly: true },
    positive_instr: { title: 'Позитивные инструкции', group: 'Промпт-инженерия', short: 'Переводит запреты в позитивные формулировки.', usedIn: 'Инструменты промпт-инженерии.', output: 'Только переписанные инструкции.', vars: [], requiresOnly: true },
    audit: { title: 'Аудит промпта', group: 'Промпт-инженерия', short: 'Ищет неоднозначности, повторы и дыры контекста.', usedIn: 'LLM-меню и кнопка аудита превью.', output: 'Список проблем с конкретными исправлениями.', vars: [] },
    compress: { title: 'Сжать промпт', group: 'Промпт-инженерия', short: 'Убирает лишнее без потери требований.', usedIn: 'LLM-меню и кнопка сжатия превью.', output: 'Только сжатый промпт.', vars: [], requiresOnly: true },
    variations: { title: '3 варианта формулировки', group: 'Промпт-инженерия', short: 'Даёт альтернативные варианты текста.', usedIn: 'Инструменты вариаций.', output: 'Нумерованный список из 3 вариантов.', vars: [], requiresOnly: true },
    negatives: { title: 'Что пойдёт не так', group: 'Промпт-инженерия', short: 'Прогнозирует типичные провалы ответа модели.', usedIn: 'LLM-меню → «Что пойдёт не так?».', output: 'Нумерованный список рисков.', vars: [], requiresOnly: true },
    grade_prompt: { title: 'Оценка промпта JSON', group: 'Промпт-инженерия', short: 'Оценивает промпт по критериям.', usedIn: 'Функции оценки качества prompt-а.', output: 'Только валидный JSON без markdown.', vars: [], requiresJson: true, requiresOnly: true },
    bro_system: { title: 'БРО: обычный ответ', group: 'БРО-теги', short: 'Системный стиль ответа для !бро.', usedIn: 'БРО-тег !бро.', output: 'Короткий ответ 1–3 предложения.', vars: [] },
    fix_system: { title: 'БРО: исправить текст', group: 'БРО-теги', short: 'Исправляет текст через !фикс.', usedIn: 'БРО-тег !фикс.', output: 'Только исправленный текст.', vars: [], requiresOnly: true },
    eng_system: { title: 'БРО: перевод EN', group: 'БРО-теги', short: 'Переводит текст на английский.', usedIn: 'БРО-тег !эн.', output: 'Только перевод.', vars: [], requiresOnly: true },
    ru_system: { title: 'БРО: перевод RU', group: 'БРО-теги', short: 'Переводит текст на русский.', usedIn: 'БРО-тег !ру.', output: 'Только перевод.', vars: [], requiresOnly: true },
    sum_system: { title: 'БРО: резюме', group: 'БРО-теги', short: 'Кратко суммирует вкладку.', usedIn: 'БРО-тег !сум.', output: '2–3 предложения.', vars: [], requiresOnly: true },
    ask_system: { title: 'БРО: вопрос по тексту', group: 'БРО-теги', short: 'Отвечает строго по контексту вкладки.', usedIn: 'БРО-тег !вопрос.', output: 'Markdown blockquote.', vars: [] },
    plan_system: { title: 'БРО: план действий', group: 'БРО-теги', short: 'Строит практичный план по тексту.', usedIn: 'БРО-тег !план.', output: '3–7 пунктов, каждый начинается с глагола.', vars: [] },
    chat_system: { title: 'Мини-чат', group: 'Чат', short: 'Задаёт стиль ответов MiniChat.', usedIn: 'LLM-меню → Мини-чат.', output: 'Короткие полезные ответы с примерами при необходимости.', vars: [] },
    autotitle: { title: 'Авто-заголовок', group: 'Служебные', short: 'Генерирует 10 вариантов, выбирает 4 лучших.', usedIn: 'Кнопка авто-заголовка блока.', output: '10 строк, фильтр до 4 (первое слово 4–6 символов).', vars: [], requiresOnly: true },
    subtab_autotitle: { title: 'Авто-заголовок вкладки', group: 'Служебные', short: 'Генерирует 10 вариантов, выбирает 4 лучших.', usedIn: 'Кнопка авто-заголовка вкладки <12345>.', output: '10 строк, фильтр до 4 (первое слово 4–6 символов).', vars: [], requiresOnly: true },
    summary: { title: 'Резюме вкладки', group: 'Служебные', short: 'Объясняет назначение prompt-а.', usedIn: 'LLM-меню → «Резюме вкладки».', output: '3–5 предложений.', vars: [], requiresOnly: true },
    thesaurus: { title: 'Тезаурус', group: 'Служебные', short: 'Предлагает синонимы выделенного слова.', usedIn: 'Функция подбора слов.', output: 'Нумерованный список из 5 синонимов.', vars: ['word'], requiresOnly: true },
    fill_ph: { title: 'Заполнить {{llm:...}}', group: 'Служебные', short: 'Дозаполняет inline-инструкцию.', usedIn: 'LLM-меню → «Заполнить {{llm:...}}».', output: 'Короткое завершение без кавычек.', vars: ['instruction'], requiresOnly: true },
  };

  function getPrompt(key, vars = {}) {
    const lay = _State?.getLayout();
    let template = lay?.llm?.customPrompts?.[key] ?? BUILTIN_PROMPTS[key] ?? '';
    Object.entries(vars).forEach(([k, v]) => { template = template.replaceAll('{' + k + '}', v); });
    return template;
  }
  function init(stateRef, storageRef) {
    _State = stateRef;
    _Storage = storageRef;
    LLMCache.invalidate();
    LLMRequestLog.invalidate();
  }

  return { init, PROVIDERS, BUILTIN_PROMPTS, loadModels, testConnection, testAllModels, request, hashStr, estimateTokens, getCtxPct, updateCtxBadge, getPrompt, LLMCache, LLMRequestLog, LLMSettingsModal };
})();
