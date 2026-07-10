// file_name: gist-sync.js
// ==UserScript dependency==
// @grant  GM_xmlhttpRequest
// @grant  GM_getValue
// @grant  GM_setValue
// @connect github.com
// @connect api.github.com
// @connect gist.githubusercontent.com
// ==/UserScript dependency==
const GistSync = (() => {
'use strict';
// ═══ Constants ═══════════════════════════════════════════════════════════
const CLIENT_ID     = 'Ov23lilZq46oMUFQ55qd';
const GIST_FILE     = 'paste-copy.json';
const WORDLIST_FILE = 'llm-wordlist.json';
const GIST_DESC     = 'paste-copy-sync';
const K_TOKEN      = 'gs_token';
const K_GIST_ID    = 'gs_gist_id';
const K_LAST_SYNC  = 'gs_last_sync';
const K_DIRTY      = 'gs_dirty';
const K_PWD        = 'gs_pwd';
const K_SETTINGS   = 'gs_settings';
const K_CLOUD_HIST = 'gs_cloud_hist';
const K_HIST_FILTER = 'gs_history_filter';
const K_LAST_HASH   = 'gs_last_hash';
const MIN_COOLDOWN_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const DEFAULT_SETTINGS = {
autoSave:     true,
debounceMin:  5,
batchMax:     10,
compress:     true,
encrypt:      false,
historyDepth: 10,
saveOnCtrlS:  true,
};
// ═══ Base64 ═══════════════════════════════════════════════════════════════
function bytesToB64(bytes) {
const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
const CHUNK = 0x8000;
let bin = '';
for (let i = 0; i < u8.length; i += CHUNK)
bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
return btoa(bin);
}
const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// ═══ Compress ═════════════════════════════════════════════════════════════
const Compress = (() => {
const supported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function _readStream(readable) {
  const chunks = [];
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function compress(str) {
  if (!supported) return { data: str, compressed: false };
  const encoded = new TextEncoder().encode(str);
  const cs      = new CompressionStream('deflate-raw');
  const writer  = cs.writable.getWriter();
  await writer.write(encoded);
  await writer.close();
  return { data: bytesToB64(await _readStream(cs.readable)), compressed: true };
}

async function decompress({ data, compressed }) {
  if (!compressed) return data;
  const ds     = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  await writer.write(b64ToBytes(data));
  await writer.close();
  return new TextDecoder().decode(await _readStream(ds.readable));
}

return { compress, decompress };
})();
// ═══ Cipher ═══════════════════════════════════════════════════════════════
const Cipher = (() => {
const enc = new TextEncoder();
const dec = new TextDecoder();
async function _deriveKey(password, salt) {
  const km = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

return {
  getPassword()  { return localStorage.getItem(K_PWD) || ''; },
  setPassword(p) {
    p ? localStorage.setItem(K_PWD, p) : localStorage.removeItem(K_PWD);
  },
  isEnabled() { return !!localStorage.getItem(K_PWD); },

  async encrypt(plaintext) {
    const pwd = this.getPassword();
    if (!pwd) return plaintext;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await _deriveKey(pwd, salt);
    const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    const out  = new Uint8Array(28 + ct.byteLength);
    out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(ct), 28);
    return JSON.stringify({ _enc: true, d: bytesToB64(out) });
  },

  async decrypt(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return raw; }
    if (!parsed?._enc) return raw;
    const pwd = this.getPassword();
    if (!pwd) throw new Error('Установите пароль шифрования для расшифровки');
    if (typeof parsed.d !== 'string') throw new Error('Данные шифрования повреждены: отсутствует ciphertext');
    const buf = b64ToBytes(parsed.d);
    if (buf.length < 29) throw new Error('Данные шифрования повреждены: слишком короткий буфер');
    const salt = buf.slice(0, 16);
    const iv   = buf.slice(16, 28);
    const data = buf.slice(28);
    const key  = await _deriveKey(pwd, salt);
    try {
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
    } catch {
      throw new Error('Неверный пароль или данные повреждены');
    }
  },
};
})();
// ═══ GithubApi ════════════════════════════════════════════════════════════
const GithubApi = (() => {
function getToken() { return localStorage.getItem(K_TOKEN) || ''; }
function parseBody(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { /* not JSON */ }
  if (/[=&]/.test(text)) {
    try { return Object.fromEntries(new URLSearchParams(text)); } catch { /* not form-encoded */ }
  }
  return {};
}

function parseHeader(rawHeaders, name) {
  if (!rawHeaders) return null;
  const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  return rawHeaders.match(re)?.[1]?.trim() ?? null;
}

function xhr(method, url, body, headers = {}) {
  if (typeof GM_xmlhttpRequest !== 'undefined') {
    return new Promise((resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error('Таймаут запроса (15 с)')), 16_000);
      const done = fn => (...args) => { clearTimeout(fallback); fn(...args); };
      GM_xmlhttpRequest({
        method, url,
        headers: { Accept: 'application/json', ...headers },
        data:    body ?? undefined,
        timeout: 15_000,
        onload:    done(r => resolve(r)),
        onerror:   done(r => reject(new Error(r?.statusText || r?.error || 'Ошибка сети'))),
        ontimeout: done(() => reject(new Error('Таймаут запроса (15 с)'))),
      });
    });
  }

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 15_000);
  return fetch(url, {
    method, signal: ctrl.signal,
    headers: { Accept: 'application/json', ...headers },
    ...(body != null ? { body } : {}),
  }).then(async res => {
    clearTimeout(tid);
    const text = await res.text();
    let rawHeaders = '';
    res.headers.forEach((v, k) => { rawHeaders += `${k}: ${v}\r\n`; });
    return { status: res.status, responseText: text, responseHeaders: rawHeaders };
  }).catch(e => {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('Таймаут запроса (15 с)');
    throw e;
  });
}

async function req(method, path, body) {
  const token  = getToken();
  if (!token) throw new Error('not_connected');
  const r = await xhr(
    method,
    'https://api.github.com' + path,
    body ? JSON.stringify(body) : undefined,
    {
      Authorization:          `Bearer ${token}`,
      'Content-Type':         'application/json',
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  );
  if (r.status === 401) { localStorage.removeItem(K_TOKEN); throw new Error('token_expired'); }
  if (r.status === 404) throw new Error('not_found');
  if (r.status === 403) {
    const remaining = parseHeader(r.responseHeaders, 'x-ratelimit-remaining');
    const reset     = parseHeader(r.responseHeaders, 'x-ratelimit-reset');
    if (remaining === '0') throw new Error(`rate_limit:${reset ?? '0'}`);
    throw new Error('GitHub HTTP 403');
  }
  if (r.status  >= 400) throw new Error(`GitHub HTTP ${r.status}`);
  if (r.status === 204) return null;
  return parseBody(r.responseText);
}

async function fetchRaw(url) {
  // gist.githubusercontent.com — CDN, не поддерживает CORS preflight.
  // Authorization-заголовок триггерит OPTIONS → ERR_FAILED.
  // Приватный raw_url защищён самим URL-путём (sha-based) — токен здесь не нужен.
  const isRawCdn = url.startsWith('https://gist.githubusercontent.com');
  const token = getToken();
  const headers = isRawCdn
    ? {}  // никаких кастомных заголовков — простой GET без preflight
    : { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const r = await xhr('GET', url, undefined, headers);
  if (r.status >= 400) throw new Error(`Не удалось загрузить полные данные (HTTP ${r.status})`);
  return r.responseText;
}

async function connectWithPAT(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('Введите токен');
  const r = await xhr(
    'GET', 'https://api.github.com/user', undefined,
    {
      Authorization:          `Bearer ${token}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  );
  if (r.status === 401) throw new Error('Недействительный токен');
  if (r.status  >= 400) throw new Error(`GitHub HTTP ${r.status}`);
  const scopesHdr = parseHeader(r.responseHeaders, 'x-oauth-scopes') || '';
  const scopes    = scopesHdr.split(',').map(s => s.trim()).filter(Boolean);
  if (scopes.length  && !scopes.includes('gist'))
    throw new Error('У токена нет scope "gist"');
  const user = parseBody(r.responseText);
  localStorage.setItem(K_TOKEN, token);
  return { login: user?.login || 'unknown', scopes };
}

async function deviceCode() {
  const r = await xhr(
    'POST', 'https://github.com/login/device/code',
    `client_id=${CLIENT_ID}&scope=gist`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  if (r.status  >= 400) throw new Error(`GitHub Device Flow: HTTP ${r.status}`);
  return parseBody(r.responseText);
}

async function pollToken(code, grantType) {
  const r = await xhr(
    'POST', 'https://github.com/login/oauth/access_token',
    `client_id=${CLIENT_ID}&device_code=${encodeURIComponent(code)}&grant_type=${encodeURIComponent(grantType)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  if (r.status  >= 400) throw new Error(`GitHub OAuth: HTTP ${r.status}`);
  return parseBody(r.responseText);
}

return { req, fetchRaw, deviceCode, pollToken, getToken, connectWithPAT };
})();
// ═══ Settings ═════════════════════════════════════════════════════════════
function loadSettings() {
try {
const raw = localStorage.getItem(K_SETTINGS);
if (!raw) return { ...DEFAULT_SETTINGS };
const saved = JSON.parse(raw);
if (saved.debounceMs !== undefined && saved.debounceMin === undefined) {
  saved.debounceMin = Math.max(1, Math.round(saved.debounceMs / 60_000)) || DEFAULT_SETTINGS.debounceMin;
  delete saved.debounceMs;
}
const clampNum = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
return {
  autoSave:     typeof saved.autoSave === 'boolean' ? saved.autoSave : DEFAULT_SETTINGS.autoSave,
  debounceMin:  clampNum(saved.debounceMin, 1, 1440, DEFAULT_SETTINGS.debounceMin),
  batchMax:     clampNum(saved.batchMax, 1, 100, DEFAULT_SETTINGS.batchMax),
  compress:     typeof saved.compress === 'boolean' ? saved.compress : DEFAULT_SETTINGS.compress,
  encrypt:      typeof saved.encrypt === 'boolean' ? saved.encrypt : DEFAULT_SETTINGS.encrypt,
  historyDepth: clampNum(saved.historyDepth, 1, 50, DEFAULT_SETTINGS.historyDepth),
  saveOnCtrlS:  typeof saved.saveOnCtrlS === 'boolean' ? saved.saveOnCtrlS : DEFAULT_SETTINGS.saveOnCtrlS,
};
} catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(patch) {
try {
localStorage.setItem(K_SETTINGS, JSON.stringify({ ...loadSettings(), ...patch }));
} catch { /* quota exceeded */ }
}
// ═══ Helpers ══════════════════════════════════════════════════════════════
const isConnected = () => !!GithubApi.getToken();
function getCloudHistory() {
try { return JSON.parse(localStorage.getItem(K_CLOUD_HIST) || '[]'); }
catch { return []; }
}
function saveCloudHistory(history, depth = loadSettings().historyDepth) {
const limit = Math.max(1, Math.min(50, Number(depth) || DEFAULT_SETTINGS.historyDepth));
const out = [];
let normalCount = 0;
for (const entry of Array.isArray(history) ? history : []) {
if (!entry || typeof entry !== 'object') continue;
if (entry.immortal) { out.push(entry); continue; }
if (normalCount < limit) { out.push(entry); normalCount++; }
}
  try { localStorage.setItem(K_CLOUD_HIST, JSON.stringify(out)); }
  catch (e) { console.warn('GistSync: cannot save cloud history:', e); }
  return out;
}
function toggleHistoryImmortal(ts) {
const hist = getCloudHistory();
const entry = hist.find(item => Number(item?.ts) === Number(ts));
if (!entry) return false;
entry.immortal = !entry.immortal;
saveCloudHistory(hist);
return entry.immortal;
}
function clearNormalHistory() {
const before = getCloudHistory();
const kept = before.filter(entry => entry?.immortal);
saveCloudHistory(kept);
return before.length - kept.length;
}
function clearAllImmortalMarks() {
const hist = getCloudHistory();
let changed = 0;
hist.forEach(entry => {
if (entry?.immortal) { entry.immortal = false; changed++; }
});
saveCloudHistory(hist);
return changed;
}
function getHistoryFilter() {
const value = localStorage.getItem(K_HIST_FILTER);
return value === 'immortal' ? 'immortal' : 'all';
}
function setHistoryFilter(value) {
localStorage.setItem(K_HIST_FILTER, value === 'immortal' ? 'immortal' : 'all');
}
function calcTotalChars(state) {
let total = 0;
state.tabs?.forEach(tab =>
tab.blocks?.forEach(b => {
if (b.type === 'text')     b.subtabs?.forEach(st => { total += (st.value || '').length; });
if (b.type === 'snippets') b.items?.forEach(i    => { total += (i.value  || '').length; });
if (b.type === 'commands') b.items?.forEach(i    => { total += (i.value  || '').length; });
}),
);
state.layout?.globalSnippets?.items?.forEach?.(i => { total += (i.value || '').length; });
return total;
}
function getStats() {
const state    = State.serialize();
const lastSync = parseInt(localStorage.getItem(K_LAST_SYNC) || '0', 10);
const history  = getCloudHistory();
const dirty    = localStorage.getItem(K_DIRTY) === 'true';
const gistId   = localStorage.getItem(K_GIST_ID) || '';
const rawSize  = JSON.stringify(state).length;
const storageInfo = Storage.getStorageInfo?.() || null;
const anchorCount = state.tabs?.reduce((s, t) => s + (t.anchors?.length ?? 0), 0) ?? 0;
return {
isConnected:  isConnected(),
lastSync,
lastSyncStr:  lastSync ? new Date(lastSync).toLocaleString('ru') : 'никогда',
dirty,
gistId,
gistUrl:      gistId ? `https://gist.github.com/${gistId}` : null,
tabsCount:    state.tabs?.length ?? 0,
blocksTotal:  state.tabs?.reduce((s, t) => s + (t.blocks?.length ?? 0), 0) ?? 0,
charTotal:    calcTotalChars(state),
anchorCount,
rawSize,
nearLimit:    rawSize > 9_000_000,
saveCount:    history.length,
immortalCount: history.filter(entry => entry?.immortal).length,
historyFilter: getHistoryFilter(),
storageInfo,
history,
settings:     loadSettings(),
};
}
// ═══ JSON Validation ══════════════════════════════════════════════════════
function validateJsonString(str, context = 'данные') {
  if (!str || typeof str !== 'string') {
    return { valid: false, error: 'Пустые или некорректные данные' };
  }
  
  const trimmed = str.trim();
  const len = trimmed.length;
  
  if (len < 2) {
    return { valid: false, error: `Данные слишком короткие (${len} симв.)` };
  }
  
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { 
      valid: false, 
      error: `Данные не начинаются с { или [ (начинаются с "${trimmed.slice(0, 20)}..."). Файл повреждён`
    };
  }
  
  if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
    const lastChar = trimmed.slice(-1);
    const last50 = trimmed.slice(-50);
    return { 
      valid: false, 
      error: `Данные не заканчиваются на } или ] (последний символ: "${lastChar}"). ` +
             `Файл обрезан (truncated) на позиции ${len}. ` +
             `Последние 50 символов: "${last50}"`
    };
  }
  
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < len; i++) {
    const c = trimmed[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (c === '{') braceCount++;
      else if (c === '}') braceCount--;
      else if (c === '[') bracketCount++;
      else if (c === ']') bracketCount--;
    }
  }
  
  if (braceCount !== 0 || bracketCount !== 0) {
    return {
      valid: false,
      error: `Несбалансированные скобки: { осталось ${braceCount}, [ осталось ${bracketCount}. ` +
             `Данные обрезаны или повреждены.`
    };
  }
  
  try {
    JSON.parse(str);
    return { valid: true };
  } catch (e) {
    const msg = e.message.toLowerCase();
    if (msg.includes('unterminated string') || msg.includes('unexpected end of input')) {
      const pos = e.message.match(/position (\d+)/)?.[1] || 'unknown';
      return { 
        valid: false, 
        error: `JSON обрезан на позиции ${pos}. Файл был повреждён при загрузке.`
      };
    }
    return { valid: false, error: `Ошибка парсинга JSON: ${e.message}` };
  }
}

// ═══ Gist Content Fetcher ═════════════════════════════════════════════════
async function _getFullContent(files, fileName) {
  const fileObj = files?.[fileName];
  if (!fileObj) return null;
  
  if (fileObj.truncated) {
    if (!fileObj.raw_url) {
      throw new Error(`Файл "${fileName}" обрезан, но raw_url недоступен. Размер: ${fileObj.size || '?'} байт`);
    }
    console.log(`${fileName}: контент обрезан API (${fileObj.size} байт), загружаю полностью через raw_url`);
    return await GithubApi.fetchRaw(fileObj.raw_url);
  }
  
  return fileObj.content;
}

// ═══ Retry Helper ═════════════════════════════════════════════════════════
async function withRetry(fn, operation = 'операция', maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isRetryable =
        error.message.includes('Таймаут') ||
        error.message.includes('Ошибка сети') ||
        error.message.includes('Failed to fetch') ||
        /^GitHub HTTP (502|503|504)$/.test(error.message);
      
      if (!isRetryable || attempt === maxRetries) {
        break;
      }
      
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`${operation}: попытка ${attempt} не удалась, повтор через ${delay}мс...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// ═══ Push ═════════════════════════════════════════════════════════════════
let _pushing = false;
let _syncOperation = null;
async function push(label = 'Автосохранение', options = {}) {
if (_pushing) return null;
if (_syncOperation) throw new Error(`Уже выполняется операция: ${_syncOperation}`);
_syncOperation = 'push';
_pushing = true;
try {
  return await Promise.race([
    _pushImpl(label, options),
    new Promise((_, rej) => setTimeout(() => rej(new Error('push_timeout')), 30_000)),
  ]);
}
finally { _pushing = false; _syncOperation = null; }
}
async function _pushImpl(label, { immortal = false } = {}) {
const settings = loadSettings();
const state    = State.serialize();
const raw      = JSON.stringify(state);
const pushedHash = _quickHash(raw);
const { data, compressed } = (settings.compress && raw.length > 8_000_000)
  ? await Compress.compress(raw)
  : { data: raw, compressed: false };

const shouldEncrypt = settings.encrypt;
if (shouldEncrypt && !Cipher.isEnabled()) {
  throw new Error('Шифрование включено, но пароль не задан');
}
const payload = shouldEncrypt ? await Cipher.encrypt(data) : data;

const stats = {
  tabsCount:     state.tabs?.length ?? 0,
  blocksTotal:   state.tabs?.reduce((s, t) => s + (t.blocks?.length ?? 0), 0) ?? 0,
  charTotal:     calcTotalChars(state),
  anchorCount:   state.tabs?.reduce((s, t) => s + (t.anchors?.length ?? 0), 0) ?? 0,
  rawSize:       raw.length,
  clientVersion: '1.0',
  pushedAt:      new Date().toISOString(),
};

const content = JSON.stringify({
  _v: 2, _ts: Date.now(),
  _compressed: compressed,
  _encrypted:  shouldEncrypt,
  _stats:      stats,
  payload,
});

stats.gistSize = content.length;

if (content.length > 9_900_000) throw new Error('size_limit');

const id = localStorage.getItem(K_GIST_ID);
let response;

if (id) {
  try {
    response = await GithubApi.req('PATCH', `/gists/${id}`, {
      files: { [GIST_FILE]: { content } },
    });
  } catch (e) {
    if (e.message !== 'not_found') throw e;
    localStorage.removeItem(K_GIST_ID);
    response = await GithubApi.req('POST', '/gists', {
      description: GIST_DESC, public: false,
      files: { [GIST_FILE]: { content } },
    });
    localStorage.setItem(K_GIST_ID, response.id);
  }
} else {
  response = await GithubApi.req('POST', '/gists', {
    description: GIST_DESC, public: false,
    files: { [GIST_FILE]: { content } },
  });
  localStorage.setItem(K_GIST_ID, response.id);
}

const sha  = response?.history?.[0]?.version ?? '';
const hist = getCloudHistory();
const entry = { ts: Date.now(), ...stats, label, gistVersion: sha, immortal: !!immortal, pushedHash };
hist.unshift(entry);
saveCloudHistory(hist, settings.historyDepth);
  try { localStorage.setItem(K_LAST_SYNC, Date.now().toString()); } catch {}
  const currentHash = (() => { try { return _quickHash(JSON.stringify(State.serialize())); } catch { return null; } })();
  if (currentHash === pushedHash) {
    try { localStorage.setItem(K_DIRTY, 'false'); } catch {}
    setLastPushedHash(pushedHash);
  } else {
    try { localStorage.setItem(K_DIRTY, 'true'); } catch {}
  }
  try { await LocalBackup.save(state); } catch (e) { console.warn('LocalBackup failed:', e); }
return entry;
}
// ═══ Wordlist Gist sync ═══════════════════════════════════════════════════
let _wordlistPushing = false;
async function pushWordlist(words) {
if (_wordlistPushing || !isConnected()) return;
const id = localStorage.getItem(K_GIST_ID);
if (!id) return;
_wordlistPushing = true;
try {
  const json = JSON.stringify({ _v: 1, _ts: Date.now(), words });
  const { data, compressed } = await Compress.compress(json);
  const content = JSON.stringify({ _v: 1, _ts: Date.now(), data, compressed });
  await GithubApi.req('PATCH', `/gists/${id}`, {
    files: { [WORDLIST_FILE]: { content } },
  });
} catch {
  /* non-critical — best-effort */
} finally {
  _wordlistPushing = false;
}
}

async function pullWordlist() {
if (!isConnected()) return null;
const id = localStorage.getItem(K_GIST_ID);
if (!id) return null;
try {
const res = await GithubApi.req('GET', `/gists/${id}`);
const raw = await _getFullContent(res?.files, WORDLIST_FILE);
if (!raw) return null;
const env = JSON.parse(raw);
if (!env._v) return null;
const str = await Compress.decompress({ data: env.data, compressed: env.compressed });
const data = JSON.parse(str);
return Array.isArray(data.words) ? data.words : null;
} catch {
return null;
}
}

// ═══ Unified Gist Fetch & Decode ══════════════════════════════════════════
async function _fetchAndDecodeGist(gistIdOrNull, version = null) {
  let id = gistIdOrNull || localStorage.getItem(K_GIST_ID);
  
  if (!id) {
    const list  = await GithubApi.req('GET', '/gists');
    const found = Array.isArray(list) &&
      list.find(g => g.description === GIST_DESC && g.files?.[GIST_FILE]);
    if (!found) throw new Error('Gist не найден — сначала сделайте Push');
    id = found.id;
    localStorage.setItem(K_GIST_ID, id);
  }
  
  const path = version ? `/gists/${id}/${version}` : `/gists/${id}`;
  const res = await GithubApi.req('GET', path);
  
  const rawContent = await _getFullContent(res.files, GIST_FILE);
  
  if (!rawContent) {
    throw new Error('Gist пустой или файл отсутствует');
  }
  
  console.log(`Fetch: загружено ${rawContent.length.toLocaleString()} символов`);
  
  let envelope;
  try {
    envelope = JSON.parse(rawContent);
  } catch (e) {
    throw new Error(`Не удалось распарсить обёртку Gist: ${e.message}`);
  }
  
  if (!envelope._v) {
    throw new Error('Неверный формат данных в Gist (отсутствует версия _v)');
  }
  
  if (!envelope.payload) {
    throw new Error('Gist не содержит данных (отсутствует payload)');
  }
  
  let payloadStr = envelope.payload;
  
  if (envelope._encrypted) {
    try {
      payloadStr = await Cipher.decrypt(payloadStr);
    } catch (e) {
      throw new Error(`Ошибка расшифровки: ${e.message}`);
    }
  }
  
  if (envelope._compressed) {
    try {
      payloadStr = await Compress.decompress({ data: payloadStr, compressed: true });
    } catch (e) {
      throw new Error(`Ошибка распаковки: ${e.message}. Данные могут быть повреждены.`);
    }
  }
  
  const payloadValidation = validateJsonString(payloadStr, 'payload');
  if (!payloadValidation.valid) {
    throw new Error(`✗ Повреждённые данные payload: ${payloadValidation.error}`);
  }
  
  console.log(`Fetch: распаковано ${payloadStr.length.toLocaleString()} символов`);
  
  return JSON.parse(payloadStr);
}

// ═══ Pull ═════════════════════════════════════════════════════════════════
async function pull({ useVersion = null } = {}) {
  if (_syncOperation) throw new Error(`Уже выполняется операция: ${_syncOperation}`);
  _syncOperation = 'pull';
  try {
    return await withRetry(async () => {
      return await _fetchAndDecodeGist(null, useVersion);
    }, 'Pull', MAX_RETRIES);
  } finally { _syncOperation = null; }
}
function markPulledSynced(stateData) {
  const hash = _quickHash(JSON.stringify(stateData));
  setLastPushedHash(hash);
  _lastPushAt = Date.now();
  try { localStorage.setItem(K_LAST_SYNC, Date.now().toString()); } catch {}
  try { localStorage.setItem(K_DIRTY, 'false'); } catch {}
  updateBadge();
}

// ═══ Restore version ══════════════════════════════════════════════════════
async function restoreVersion(sha) {
  if (_syncOperation) throw new Error(`Уже выполняется операция: ${_syncOperation}`);
  _syncOperation = 'restore';
  try {
    return await withRetry(async () => {
      const gistId = localStorage.getItem(K_GIST_ID);
      if (!gistId) throw new Error('Нет сохранённого Gist ID');
      
      const stateData = await _fetchAndDecodeGist(gistId, sha);

      Storage.save(stateData);
      State.load(stateData);
      
      const hash = _quickHash(JSON.stringify(stateData));
      setLastPushedHash(hash);
      _lastPushAt     = Date.now();

      try { localStorage.setItem(K_LAST_SYNC, Date.now().toString()); } catch {}
      try { localStorage.setItem(K_DIRTY, 'false'); } catch {}
      updateBadge();
    }, 'Restore', MAX_RETRIES);
  } finally { _syncOperation = null; }
}
function _formatStateStats(state) {
const tabs = state?.tabs?.length ?? 0;
const blocks = state?.tabs?.reduce((s, t) => s + (t.blocks?.length ?? 0), 0) ?? 0;
const chars = calcTotalChars(state || {});
const anchors = state?.tabs?.reduce((s, t) => s + (t.anchors?.length ?? 0), 0) ?? 0;
return `${tabs} вкл. / ${blocks} бл. / ${fmtNum(chars)} симв. / ${anchors} ⚓`;
}
async function createEmergencySnapshot(reason) {
if (!Storage.saveEmergencySnapshot) return null;
const state = State.serialize();
const entry = await Storage.saveEmergencySnapshot(state, {
  reason,
  stats: _formatStateStats(state),
});
await _refreshEmergencySnapshots();
return entry;
}
function _needsOverwriteProtection() {
return localStorage.getItem(K_DIRTY) === 'true' || _hasChanges();
}
async function protectCurrentBeforeOverwrite(actionName, targetStats = '') {
if (!_needsOverwriteProtection()) return true;
const currentStats = _formatStateStats(State.serialize());
const details = targetStats ? `\nВыбранная версия: ${targetStats}` : '';
const ok = confirm(
`Перед ${actionName} есть локальные изменения.\n\n` +
`Текущая версия: ${currentStats}${details}\n\n` +
`ОК — создать ☠-сохранение "Перед ${actionName}" и продолжить.\n` +
`Отмена — ничего не менять.`
);
if (!ok) return false;
const protectedEntry = await push(`☠ Перед ${actionName}`, { immortal: true });
if (!protectedEntry) throw new Error('Сейчас уже идёт Push — попробуйте ещё раз');
setLastPushedHash(protectedEntry.pushedHash || _quickHash(JSON.stringify(State.serialize())));
_lastPushAt = Date.now();
return true;
}

// ═══ Auth: PAT ════════════════════════════════════════════════════════════
async function connectPAT(token) {
return GithubApi.connectWithPAT(token);
}
// ═══ Auth: Device Flow ════════════════════════════════════════════════════
let _connectAbort = null;
async function connect({ onCode, onSuccess, onError }) {
let r1;
try {
r1 = await GithubApi.deviceCode();
} catch (e) {
const msg   = String(e?.message || e);
const lower = msg.toLowerCase();
const isCors = lower.includes('failed to fetch') ||
lower.includes('networkerror')    ||
lower.includes('cors')            ||
lower.includes('ошибка сети');
onError(isCors
? 'OAuth недоступен в браузере (CORS). Используйте Personal Access Token.'
: msg);
return;
}
const {
  device_code, user_code, verification_uri,
  interval   = 5,
  expires_in = 900,
} = r1;

if (!device_code || !user_code) {
  onError('Нет ответа от GitHub. Проверьте соединение.');
  return;
}

navigator.clipboard?.writeText(user_code).catch(() => {});

const a = document.createElement('a');
a.href = verification_uri || 'https://github.com/login/device';
a.target = '_blank'; a.rel = 'noopener noreferrer';
document.body.appendChild(a); a.click(); a.remove();

onCode(user_code, verification_uri || 'https://github.com/login/device');

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
let interval_ms = (interval + 1) * 1000;
let pollTimer   = null;
let done        = false;

const finish = (fn, arg) => {
  if (done) return;
  done = true;
  _connectAbort = null;
  clearTimeout(pollTimer);
  clearTimeout(expireTimer);
  fn?.(arg);
};

_connectAbort = () => finish(onError, 'Отменено');

const expireTimer = setTimeout(
  () => finish(onError, 'Время ожидания истекло (15 мин)'),
  expires_in * 1000,
);

const poll = async () => {
  if (done) return;
  try {
    const r2 = await GithubApi.pollToken(device_code, GRANT);
    if (done) return;
    if (r2.access_token) {
      localStorage.setItem(K_TOKEN, r2.access_token);
      finish(onSuccess);
      return;
    }
    if (r2.error === 'slow_down')     interval_ms = Math.min(interval_ms + 5000, 30_000);
    if (r2.error === 'access_denied') { finish(onError, 'Авторизация отклонена'); return; }
    if (r2.error === 'expired_token') { finish(onError, 'Код подтверждения истёк'); return; }
  } catch { /* transient — retry */ }
  if (!done) pollTimer = setTimeout(poll, interval_ms);
};
pollTimer = setTimeout(poll, interval_ms);
}
function disconnect() {
_connectAbort?.();
_connectAbort = null;
_clearDebounce();
_pendingCount   = 0;
_lastPushAt     = 0;
_lastPushedHash = '';
[K_TOKEN, K_GIST_ID, K_LAST_SYNC, K_DIRTY, K_CLOUD_HIST, K_PWD, K_SETTINGS, K_HIST_FILTER, K_LAST_HASH]
.forEach(k => localStorage.removeItem(k));
}
// ═══ Auto-push ════════════════════════════════════════════════════════════
let _pendingCount   = 0;
let _debounceTimer  = null;
let _debounceUntil  = 0;
let _lastPushAt     = 0;
let _lastPushedHash = localStorage.getItem(K_LAST_HASH) || '';
function _quickHash(str) {
let h1 = 5381;
let h2 = 2166136261;
for (let i = 0; i < str.length; i++) {
  const c = str.charCodeAt(i);
  h1 = (Math.imul(h1, 33) ^ c) >>> 0;
  h2 = Math.imul(h2 ^ c, 16777619) >>> 0;
}
return `${str.length}:${h1.toString(36)}:${h2.toString(36)}`;
}
function setLastPushedHash(hash) {
_lastPushedHash = hash || '';
try {
  if (_lastPushedHash) localStorage.setItem(K_LAST_HASH, _lastPushedHash);
  else localStorage.removeItem(K_LAST_HASH);
} catch {}
}
function _hasChanges() {
try { return _quickHash(JSON.stringify(State.serialize())) !== _lastPushedHash; }
catch { return true; }
}
function _intervalMs() {
return Math.max(MIN_COOLDOWN_MS, loadSettings().debounceMin * 60_000);
}
function _cooldownLeft() {
return Math.max(0, MIN_COOLDOWN_MS - (Date.now() - _lastPushAt));
}
function _clearDebounce() {
clearTimeout(_debounceTimer);
_debounceTimer = null;
_debounceUntil = 0;
}
function _scheduleDebounce(delay, label) {
clearTimeout(_debounceTimer);
_debounceUntil = Date.now() + delay;
_debounceTimer = setTimeout(() => {
_debounceUntil = 0;
_pendingCount  = 0;
if (_hasChanges()) _doPush(label);
}, delay);
}
function schedulePush() {
const settings = loadSettings();
if (!_hasChanges()) {
  try { localStorage.setItem(K_DIRTY, 'false'); } catch {}
  updateBadge();
  return;
}
try { localStorage.setItem(K_DIRTY, 'true'); } catch {}
updateBadge();
if (!isConnected() || !settings.autoSave) return;
_pendingCount++;

if (_pendingCount >= settings.batchMax) {
  _pendingCount = 0;
  const left = _cooldownLeft();
  if (left === 0) {
    _clearDebounce();
    _doPush('Пакет изменений');
  } else {
    _scheduleDebounce(left, 'Пакет изменений');
  }
  return;
}

const delay = Math.max(_intervalMs(), _cooldownLeft());
_scheduleDebounce(delay, 'Автосохранение');
}
async function _doPush(label) {
if (!isConnected()) return;
if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
if (!_hasChanges()) {
  localStorage.setItem(K_DIRTY, 'false');
  updateBadge();
  return;
}

const left = _cooldownLeft();
if (left > 0) { _scheduleDebounce(left, label); return; }

try {
  const result = await push(label);
  if (!result) {
    localStorage.setItem(K_DIRTY, 'true');
    updateBadge();
    _scheduleDebounce(_cooldownLeft() || MIN_COOLDOWN_MS, label);
    return;
  }
  _lastPushAt = Date.now();
  updateBadge();
} catch (e) {
  localStorage.setItem(K_DIRTY, 'true');
  updateBadge();
  const msg = String(e?.message ?? '');
  if (msg.startsWith('Уже выполняется операция:')) {
    _scheduleDebounce(MIN_COOLDOWN_MS, label);
    return;
  }
  if      (msg === 'token_expired')       Toast.show('☁ Gist: токен истёк, переподключитесь', 'error');
  else if (msg === 'size_limit')          Toast.show('☁ Gist: данные превышают лимит 10 MB', 'error');
  else if (msg === 'not_connected')       { /* silent */ }
  else if (msg.startsWith('rate_limit:')) {
    const resetTs = parseInt(msg.split(':')[1], 10) * 1000;
    Toast.show(
      `☁ Gist: лимит запросов. Сброс в ${resetTs ? new Date(resetTs).toLocaleTimeString('ru') : '—'}`,
      'error',
    );
  }
}
}
function onSaveTrigger() {
const settings = loadSettings();
if (!isConnected()) { Toast.show('Сохранено локально ✓', 'success'); return; }
if (settings.saveOnCtrlS) {
_clearDebounce();
_pendingCount = 0;
if (!_hasChanges()) { Toast.show('☁ Данные актуальны ✓', 'success'); return; }
_doPush('Ctrl+S').then(() => {
if (localStorage.getItem(K_DIRTY) !== 'true')
  Toast.show('☁ Сохранено в Gist ✓', 'success');
});
} else {
Toast.show('Сохранено локально ✓', 'success');
schedulePush();
}
}
window.addEventListener('online', () => {
if (isConnected() && localStorage.getItem(K_DIRTY) === 'true')
_doPush('Восстановление после offline');
});
// ═══ UI helpers ═══════════════════════════════════════════════════════════
const esc    = s => String(s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const fmtNum = n => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
const fmtBytes = n => {
  const size = Math.max(0, Number(n) || 0);
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
};
function safeNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function updateBadge() {
const btn = document.getElementById('btn-gist-sync');
if (!btn) return;
btn.classList.remove('synced', 'dirty', 'gs-disconnected');
if (!isConnected()) {
btn.classList.add('gs-disconnected');
btn.title = 'Sync → GitHub Gist (не подключено)';
} else if (localStorage.getItem(K_DIRTY) === 'true') {
btn.classList.add('dirty');
btn.title = 'Sync → GitHub Gist (есть несохранённые изменения ⬆)';
} else {
btn.classList.add('synced');
btn.title = 'Sync → GitHub Gist (синхронизировано ✓)';
}
}
// ═══ Modal ════════════════════════════════════════════════════════════════
let _connectingCode = null;
let _compareView = null;
let _tipsAbort = null;
let _manualPushOpen = false;
let _historyMenuOpen = false;
let _emergencyList = [];
const isModalOpen = () => document.getElementById('gist-sync-modal')?.style.display === 'flex';
async function _refreshEmergencySnapshots() {
try { _emergencyList = await Storage.listEmergencySnapshots?.() || []; }
catch { _emergencyList = []; }
}
function openDialog() {
const modal = document.getElementById('gist-sync-modal');
if (!modal) return;
renderModal();
modal.style.display = 'flex';
_refreshEmergencySnapshots().then(() => { if (isModalOpen()) renderModal(); });
}
function closeDialog() {
const modal = document.getElementById('gist-sync-modal');
if (!modal) return;
modal.style.display = 'none';
_tipsAbort?.abort();
_tipsAbort = null;
document.querySelectorAll('.gs-floating-tip').forEach(node => node.remove());
_connectingCode = null;
_manualPushOpen = false;
_historyMenuOpen = false;
}
function _relativeTime(ts, now) {
const diff = now - ts;
const sec = Math.floor(diff / 1000);
if (sec < 60) return 'только что';
const min = Math.floor(sec / 60);
if (min < 60) return `${min} мин назад`;
const hr = Math.floor(min / 60);
if (hr < 24) return `${hr} ч назад`;
const day = Math.floor(hr / 24);
if (day === 1) return 'Вчера';
if (day < 7) return `${day} дн назад`;
return new Date(ts).toLocaleDateString('ru');
}
function _nextPushStr() {
if (!isConnected() || !loadSettings().autoSave || !_debounceUntil) return null;
const left = _debounceUntil - Date.now();
if (left <= 0) return 'скоро';
const sec = Math.ceil(left / 1000);
if (sec < 60) return `через ~${sec} с`;
return `через ~${Math.ceil(sec / 60)} мин`;
}
function _readSettingsForm(body) {
const num = (id, min, max, def) =>
  Math.max(min, Math.min(max, Number(body.querySelector(id)?.value) || def));
const encryptChecked = body.querySelector('#gs-set-encrypt')?.checked ?? DEFAULT_SETTINGS.encrypt;
const historyDepth = num('#gs-set-hist', 1, 50, DEFAULT_SETTINGS.historyDepth);
return {
  autoSave:     body.querySelector('#gs-set-autosave')?.checked  ?? DEFAULT_SETTINGS.autoSave,
  debounceMin:  num('#gs-set-debounce', 1, 1440, DEFAULT_SETTINGS.debounceMin),
  batchMax:     num('#gs-set-batchmax', 1, 100,  DEFAULT_SETTINGS.batchMax),
  saveOnCtrlS:  body.querySelector('#gs-set-ctrls')?.checked     ?? DEFAULT_SETTINGS.saveOnCtrlS,
  compress:     body.querySelector('#gs-set-compress')?.checked  ?? DEFAULT_SETTINGS.compress,
  encrypt:      encryptChecked,
  historyDepth,
};
}
function _saveSettingsFromForm(body, { silent = false } = {}) {
const next = _readSettingsForm(body);
if (!next.encrypt) Cipher.setPassword('');
saveSettings(next);
saveCloudHistory(getCloudHistory(), next.historyDepth);
updateBadge();
if (!silent) Toast.show('Настройки сохранены ✓', 'success');
return next;
}
function _renderBackupsHTML(backups) {
  if (!backups.length) {
    return `<div class="backup-empty">Пока нет локальных копий. Появятся после первой синхронизации.</div>`;
  }
  let h = `<div class="backup-list">`;
  const now = Date.now();
  for (let i = 0; i < backups.length; i++) {
    const entry = backups[i] || {};
    const ts = Number.isFinite(Number(entry.ts)) ? Number(entry.ts) : 0;
    const d = new Date(ts);
    const timeStr = d.toLocaleString('ru');
    const relative = _relativeTime(ts, now);
    const size = fmtBytes(entry.size || 0);
    const tabs = Number.isFinite(Number(entry.tabsCount)) ? Number(entry.tabsCount) : 0;
    const immortal = !!entry.immortal;
    h += `
     <div class="backup-item${immortal ? ' backup-immortal' : ''}">
       <span class="backup-meta" title="${esc(timeStr)}">
         <span class="backup-dot${immortal ? ' dot-immortal' : ''}">●</span>${esc(relative)} · ${tabs} вклад${tabs === 1 ? 'ка' : tabs < 5 ? 'ки' : 'ок'} · ${size}
       </span>
       <span class="backup-actions">
         <button type="button" class="gs-btn gs-btn-sm gs-btn-immortal${immortal ? ' active' : ''}" data-ts="${esc(ts)}"
                 data-tip="${immortal ? 'Снять защиту от вытеснения' : 'Защитить от вытеснения'}">☠</button>
         <button type="button" class="gs-btn gs-btn-sm gs-tip gs-btn-restore-backup" data-ts="${esc(ts)}"
                 data-tip="Восстановить копию. Текущее состояние будет сохранено автоматически.">↺</button>
         <button type="button" class="gs-btn gs-btn-sm gs-tip gs-btn-download-backup" data-ts="${esc(ts)}"
                 data-tip="Скачать JSON-файл.">⬇</button>
       </span>
     </div>`;
  }
  h += `</div>`;
  h += `<div class="gs-hint" style="margin-top:8px;font-size:11px;color:var(--text-muted);">
     ⓘ Копии создаются автоматически при синхронизации. Хранятся только в этом браузере.
   </div>`;
  return h;
}

async function _loadBackups(body) {
  const section = body.querySelector('#gs-backups-section');
  if (!section) return;
  try {
    const backups = await LocalBackup.list();
    const head = section.querySelector('.gs-history-head');
    if (backups.length) {
      const tools = document.createElement('div');
      tools.className = 'gs-history-tools';
      tools.innerHTML = `<button type="button" class="gs-btn gs-btn-sm gs-btn-danger gs-tip" id="gs-btn-clear-backups"
                       data-tip="Удалить все локальные копии.">Очистить</button>`;
      head.appendChild(tools);
    }
    section.lastElementChild.outerHTML = _renderBackupsHTML(backups);
    section.querySelectorAll('.gs-btn-restore-backup').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = Number(btn.dataset.ts);
        const tsStr = new Date(ts).toLocaleString('ru');
        try { await LocalBackup.save(State.serialize()); } catch { /* ok */ }
        if (!confirm(`Восстановить копию от ${tsStr}?\nТекущее состояние будет сохранено автоматически.`)) return;
        btn.disabled = true; btn.textContent = '⏳';
        try {
          const data = await LocalBackup.restore(ts);
          if (!data) throw new Error('Копия не найдена');
          Storage.save(data);
          State.load(data);
          Toast.show('Локальная копия восстановлена ✓', 'success');
          closeDialog();
        } catch (err) {
          Toast.show('Ошибка восстановления: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = '↺';
        }
      });
    });
    section.querySelectorAll('.gs-btn-download-backup').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = Number(btn.dataset.ts);
        try {
          const data = await LocalBackup.restore(ts);
          if (!data) throw new Error('Копия не найдена');
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `paste-copy-backup-${new Date(ts).toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          Toast.show('Ошибка скачивания: ' + err.message, 'error');
        }
      });
    });
    const clearBtn = section.querySelector('#gs-btn-clear-backups');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Удалить все локальные копии?')) return;
        try {
          await LocalBackup.clear();
          Toast.show('Локальные копии удалены ✓', 'success');
          if (isModalOpen()) renderModal();
        } catch (e) {
          Toast.show('Ошибка удаления: ' + e.message, 'error');
        }
      });
    }
    section.querySelectorAll('.gs-btn-immortal[data-ts]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = Number(btn.dataset.ts);
        try {
          const isImmortal = await LocalBackup.toggleImmortal(ts);
          Toast.show(isImmortal ? '☠ Копия защищена от вытеснения' : '☠ Защита снята', isImmortal ? 'success' : '');
          if (isModalOpen()) renderModal();
        } catch (e) {
          Toast.show('Ошибка: ' + e.message, 'error');
        }
      });
    });
  } catch (e) {
    console.warn('LocalBackup.list() failed:', e);
    section.lastElementChild.outerHTML = `<div class="backup-empty">Локальный бэкап недоступен в этом браузере.</div>`;
  }
}
function renderModal() {
const body = document.getElementById('gist-modal-body');
if (!body) return;
const st  = getStats();
const cfg = st.settings;

const connClass = st.isConnected ? 'gs-status-ok' : 'gs-status-warn';
const connText  = st.isConnected ? '✓ Подключено к GitHub' :  '⚠ Не подключено';
const nextPush  = _nextPushStr();
const storageMode = st.storageInfo?.mode || 'localStorage';
  const storageShort = storageMode === 'indexedDB' ? 'IDB' : storageMode === 'localStorage' ? 'LS' : storageMode;
  const rawSizeStr = fmtBytes(st.rawSize);
  const rawLimitPct = Math.min(99, Math.round((st.rawSize / 10_000_000) * 100));
  
  let html = `
   <section class="gs-section gs-hero-section">
     <div class="gs-hero-main">
       <div class="gs-status-line">
         <span class="${connClass}">${connText}</span>
         ${st.isConnected && st.dirty ? '<span class="gs-dirty-badge">⬆ есть несохранённое</span>' : ''}
         ${nextPush ? `<span class="gs-next-push">⏱ ${esc(nextPush)}</span>` : ''}
       </div>
       <div class="gs-meta">Последний sync: <strong>${esc(st.lastSyncStr)}</strong>
         ${st.gistUrl ? `<span class="gs-dot">·</span><a href="${esc(st.gistUrl)}" target="_blank" rel="noopener" class="gs-link">Открыть Gist ↗</a>` : ''}
       </div>
     </div>
     ${st.isConnected ? `
       <div class="gs-hero-actions">
         <button class="gs-btn gs-btn-primary gs-tip" id="gs-btn-push" data-tip="Сразу отправить текущую версию в Gist. Можно добавить комментарий.">⬆ Push сейчас</button>
         <button class="gs-btn gs-tip" id="gs-btn-pull" data-tip="Загрузить последнюю версию из Gist. При локальных изменениях будет предупреждение.">⬇ Pull</button>
         <button class="gs-btn gs-btn-icon gs-btn-danger" id="gs-btn-disconnect"
                 aria-label="Отключить GitHub Gist" title="Отключить">✕</button>
       </div>` : ''}
     ${st.nearLimit ? ' <div class="gs-warn-box">⚠ Объём данных приближается к лимиту Gist (10 MB)</div>' : ''}
   </section>`;

if (st.isConnected && _manualPushOpen) {
  html += `
   <section class="gs-section gs-manual-push-panel" aria-label="Комментарий к ручному сохранению">
     <form id="gs-manual-push-form" class="gs-manual-push-form" autocomplete="off" action="javascript:void(0)" onsubmit="return false;">
       <label for="gs-manual-push-label" class="gs-manual-push-label">Комментарий</label>
       <input id="gs-manual-push-label" class="gs-manual-push-input" type="text" maxlength="80"
              value="Ручное сохранение" aria-label="Комментарий к ручному сохранению">
       <button type="submit" class="gs-btn gs-btn-primary gs-btn-sm gs-tip" id="gs-btn-manual-push-save"
               data-tip="Сохранить текущую версию в Gist с этим комментарием.">Сохранить</button>
       <button type="button" class="gs-btn gs-btn-sm gs-tip" id="gs-btn-manual-push-immortal"
               data-tip="Сохранить текущую версию и сразу защитить её от вытеснения лимитом истории.">☠</button>
       <button type="button" class="gs-btn gs-btn-sm gs-btn-icon" id="gs-btn-manual-push-cancel" aria-label="Закрыть комментарий">✕</button>
     </form>
   </section>`;
}

if (!st.isConnected && _connectingCode) {
  html += `
     <section class="gs-section gs-connect-pending">
       <p class="gs-hint">Введите код на странице GitHub:</p>
       <div class="gist-code-block">${esc(_connectingCode.user_code)}</div>
       <a href="${esc(_connectingCode.verificationUri)}" target="_blank" rel="noopener" class="gs-link gs-link-block">
        Открыть страницу авторизации ↗
       </a>
       <div class="gs-waiting">⏳ Ожидание авторизации...</div>
       <button type="button" class="gs-btn gs-btn-sm" id="gs-btn-connect-cancel" style="margin-top:8px">Отменить</button>
     </section>`;
} else if (!st.isConnected) {
  html += `
     <section class="gs-section gs-connect-section">
       <form id="gs-pat-form" class="gs-pat-form" autocomplete="on"
            action="javascript:void(0)" onsubmit="return false;">
         <label for="gs-pat-input" class="gs-hint">
           <strong>Personal Access Token</strong>
          ( <a href="https://github.com/settings/tokens/new?description=paste-copy&scopes=gist"
              target="_blank" rel="noopener" class="gs-link">создать ↗</a>,
          scope:  <code>gist</code>)
         </label>
         <div class="gs-field-row">
           <input type="password" id="gs-pat-input" name="github-token"
                 class="gs-input-pwd" placeholder="ghp_... или github_pat_..."
                 autocomplete="off" spellcheck="false"
                 autocapitalize="off" style="flex:1">
           <button type="submit" class="gs-btn gs-btn-primary gs-btn-sm" id="gs-btn-pat-connect">
            🔗 Подключить
           </button>
         </div>
       </form>

       <details class="gs-advanced" style="margin-top:12px">
         <summary class="gs-hint" style="cursor:pointer">
          OAuth Device Flow (для расширений / Electron)
         </summary>
         <p class="gs-hint" style="margin:6px 0 8px;line-height:1.5">
          В обычном браузере CORS блокирует запросы к  <code>github.com/login/*</code>.
          Используйте PAT — это единственный надёжный путь без прокси-сервера.
         </p>
         <button type="button" class="gs-btn gs-btn-sm" id="gs-btn-connect">
          🔑 Попробовать OAuth Device Flow
         </button>
       </details>
     </section>`;
}

html += `
   <details class="gs-section gs-settings-fold">
     <summary>
       <span class="gs-section-title">Настройки</span>
       <span class="gs-settings-summary">
         ${cfg.autoSave ? 'Auto' : 'Manual'} · ${cfg.debounceMin} мин · N=${cfg.batchMax} · история ${cfg.historyDepth}
       </span>
     </summary>
     <form id="gs-settings-form" class="gs-settings-grid" autocomplete="on" action="javascript:void(0)" onsubmit="return false;">
       <label class="gs-check-label gs-check-compact gs-tip" data-tip="Автоматически отправляет изменения в Gist после задержки.">
         <input type="checkbox" id="gs-set-autosave" ${cfg.autoSave ? 'checked' : ''}>
        Авто-пуш
       </label>
       <label class="gs-check-label gs-check-compact gs-tip" data-tip="Ctrl+S сохраняет локально и сразу делает Push в Gist.">
         <input type="checkbox" id="gs-set-ctrls" ${cfg.saveOnCtrlS ? 'checked' : ''}>
        Ctrl+S → Gist
       </label>
       <label class="gs-check-label gs-check-compact gs-tip" data-tip="Сжимает payload перед отправкой. Обычно лучше держать включённым.">
         <input type="checkbox" id="gs-set-compress" ${cfg.compress ? 'checked' : ''}>
        Сжатие
       </label>
       <label class="gs-check-label gs-check-compact gs-tip" data-tip="Шифрует данные AES-GCM перед отправкой. Для Pull на другом устройстве нужен тот же пароль.">
         <input type="checkbox" id="gs-set-encrypt" ${cfg.encrypt ? 'checked' : ''}>
        AES-GCM
       </label>
       <div class="gs-field-row gs-field-compact gs-tip" data-tip="Сколько минут ждать после изменений перед автопушем.">
         <label for="gs-set-debounce">Задержка</label>
         <input type="number" id="gs-set-debounce" min="1" max="1440" step="1"
               value="${cfg.debounceMin}" class="gs-input-num" aria-label="Задержка авто-пуша в минутах">
       </div>
       <div class="gs-field-row gs-field-compact gs-tip" data-tip="Если накопится N изменений подряд — Push выполнится раньше задержки.">
         <label for="gs-set-batchmax">Триггер N</label>
         <input type="number" id="gs-set-batchmax" min="1" max="100"
               value="${cfg.batchMax}" class="gs-input-num" aria-label="Пакетный триггер изменений">
       </div>
       <div class="gs-field-row gs-field-compact gs-tip" data-tip="Сколько обычных записей истории хранить. ☠-записи не вытесняются.">
         <label for="gs-set-hist">История</label>
         <input type="number" id="gs-set-hist" min="1" max="50"
               value="${cfg.historyDepth}" class="gs-input-num" aria-label="Глубина облачной истории">
       </div>
       <p class="gs-hint gs-batch-hint">
        Настройки сохраняются автоматически. Если накопится ≥ N изменений подряд — push минуя задержку (не чаще 1 раза в 30 с).
       </p>
       <div class="gs-field-row gs-encrypt-row" ${!cfg.encrypt ? 'style="display:none"' : ''}>
         <label class="gs-pwd-label" for="gs-set-pwd">Пароль</label>
         <input type="password" id="gs-set-pwd" name="gist-encrypt-password"
               placeholder="Пароль AES-GCM"
               value="${esc(Cipher.getPassword())}"
               class="gs-input-pwd gs-input-pwd-compact gs-tip" autocomplete="new-password"
               data-tip="Сохраняется автоматически. Не отправляется отдельно, но нужен для расшифровки.">
         <span class="gs-autosaved-note" aria-live="polite">автосохранение</span>
       </div>
     </form>
   </details>

   <section class="gs-section gs-stats-section" aria-label="Краткая статистика синхронизации">
     <div class="gs-stats-row">
       <span class="gs-tip" data-tip="Вкладки в текущем проекте." aria-label="Вкладки: ${st.tabsCount}"><em>▣</em><strong>${st.tabsCount}</strong></span>
       <span class="gs-tip" data-tip="Общее количество блоков во всех вкладках." aria-label="Блоки: ${st.blocksTotal}"><em>▦</em><strong>${st.blocksTotal}</strong></span>
       <span class="gs-tip" data-tip="Суммарный объём текста в проекте." aria-label="Символы: ${fmtNum(st.charTotal)}"><em>Σ</em><strong>${fmtNum(st.charTotal)}</strong></span>
       <span class="gs-tip" data-tip="Общее количество якорей во всех вкладках." aria-label="Якоря: ${st.anchorCount}"><em>⚓</em><strong>${st.anchorCount}</strong></span>
       <span class="gs-tip" data-tip="Записей облачной истории, включая ☠." aria-label="Сохранения: ${st.saveCount}"><em>☁</em><strong>${st.saveCount}</strong></span>
       <span class="gs-tip" data-tip="Бессмертные записи не вытесняются лимитом истории." aria-label="Бессмертные сохранения: ${st.immortalCount}"><em>☠</em><strong>${st.immortalCount}</strong></span>
       <span class="gs-tip gs-stat-storage" data-tip="Хранилище основного документа: ${esc(storageMode)}. Размер JSON: ${rawSizeStr} (~${rawLimitPct}% от лимита одного Gist-файла)." aria-label="Хранилище: ${esc(storageMode)}, размер: ${rawSizeStr}"><em>◫</em><strong>${esc(storageShort)}</strong></span>
     </div>
   </section>`;

if (_compareView) {
  const dTabs = _compareView.tabs - st.tabsCount;
  const dBlocks = _compareView.blocks - st.blocksTotal;
  const dChars = _compareView.chars - st.charTotal;
  const dAnchors = (_compareView.anchors || 0) - st.anchorCount;
  const sign = n => n > 0 ? `+${n}` : String(n);
  html += `
   <section class="gs-section gs-compare-panel" aria-live="polite">
     <div class="gs-compare-head">
       <h3 class="gs-section-title">Сравнение</h3>
       <button type="button" class="gs-btn gs-btn-sm gs-btn-icon" id="gs-btn-compare-close" aria-label="Закрыть сравнение">✕</button>
     </div>
     <div class="gs-compare-title">${esc(_compareView.time)} — ${esc(_compareView.label)}</div>
     <div class="gs-compare-grid">
       <span><em>Сейчас</em><strong>${st.tabsCount} вкл. / ${st.blocksTotal} бл. / ${fmtNum(st.charTotal)} симв. / ${st.anchorCount} ⚓</strong></span>
       <span><em>Выбрано</em><strong>${_compareView.tabs} вкл. / ${_compareView.blocks} бл. / ${fmtNum(_compareView.chars)} симв. / ${_compareView.anchors || 0} ⚓</strong></span>
       <span><em>Разница</em><strong>${sign(dTabs)} вкл. / ${sign(dBlocks)} бл. / ${sign(dChars)} симв. / ${sign(dAnchors)} ⚓</strong></span>
     </div>
   </section>`;
}

if (st.history.length  > 0) {
  const visibleHistory = st.historyFilter === 'immortal'
    ? st.history.filter(entry => entry?.immortal)
    : st.history;
  html += `
   <section class="gs-section gs-history-section">
     <div class="gs-history-head">
       <h3 class="gs-section-title">Облачная история</h3>
       <div class="gs-history-tools" aria-label="Фильтр и действия облачной истории">
         <button type="button" class="gs-btn gs-btn-sm gs-btn-filter gs-tip${st.historyFilter === 'all' ? ' active' : ''}" data-filter="all" data-tip="Показать всю облачную историю.">Все</button>
         <button type="button" class="gs-btn gs-btn-sm gs-btn-filter gs-tip${st.historyFilter === 'immortal' ? ' active' : ''}" data-filter="immortal" data-tip="Показать только бессмертные сохранения.">☠ Только</button>
         <span class="gs-history-menu-wrap">
           <button type="button" class="gs-btn gs-btn-sm gs-btn-icon gs-tip" id="gs-btn-history-menu"
                   aria-expanded="${_historyMenuOpen ? 'true' : 'false'}" aria-label="Действия истории"
                   data-tip="Дополнительные действия с историей. Аварийных локальных снимков: ${_emergencyList.length}.">⋯${_emergencyList.length ? `<b>${_emergencyList.length}</b>` : ''}</button>
           ${_historyMenuOpen ? `
             <span class="gs-history-menu" role="menu">
               <button type="button" class="gs-btn gs-btn-sm gs-tip" id="gs-btn-clear-normal" role="menuitem"
                       data-tip="Удалить обычные записи истории, не трогая ☠.">Очистить обычные</button>
               ${_emergencyList.length ? `
               <button type="button" class="gs-btn gs-btn-sm gs-tip" id="gs-btn-restore-emergency" role="menuitem"
                       data-tip="Вернуть последний локальный аварийный снимок из IndexedDB: ${esc(_emergencyList[0]?.reason || 'Аварийный снимок')}.">↩ Аварийный снимок</button>
               <button type="button" class="gs-btn gs-btn-sm gs-tip" id="gs-btn-clear-emergency" role="menuitem"
                       data-tip="Удалить локальные аварийные снимки. Облачная история не изменится.">Очистить аварийные</button>` : ''}
               <button type="button" class="gs-btn gs-btn-sm gs-tip" id="gs-btn-unpin-all" role="menuitem"
                       data-tip="Снять ☠ со всех записей. После этого они снова будут вытесняться лимитом.">Снять все ☠</button>
             </span>` : ''}
         </span>
       </div>
     </div>`;
  if (!visibleHistory.length) {
    html += ` <div class="gs-empty-history">Бессмертных сохранений пока нет.</div>`;
  } else {
    html += ` <ul class="gs-history-list">`;
    for (const entry of visibleHistory) {
      const timeStr = esc(new Date(entry.ts).toLocaleString('ru'));
      const immortal = !!entry.immortal;
      const ts = safeNum(entry.ts);
      const tabsCount = safeNum(entry.tabsCount);
      const blocksTotal = safeNum(entry.blocksTotal);
      const charTotal = safeNum(entry.charTotal);
      const anchorCount = safeNum(entry.anchorCount);
      const targetStats = `${tabsCount} вкл. / ${blocksTotal} бл. / ${fmtNum(charTotal)} симв. / ${anchorCount} ⚓`;
      const compactStats = `${tabsCount}/${blocksTotal}/${fmtNum(charTotal)}/${anchorCount}⚓`;
      const sizeStats = entry.rawSize ? `JSON ${fmtBytes(entry.rawSize)}${entry.gistSize ? ` · Gist ${fmtBytes(entry.gistSize)}` : ''}` : 'Размер старых записей не сохранён';
      html += `
       <li class="gist-history-row${immortal ? ' gs-history-immortal' : ''}">
          <button type="button" class="gs-btn gs-btn-sm gs-btn-immortal${immortal ? ' active' : ''}"
                  data-ts="${esc(ts)}" aria-pressed="${immortal ? 'true' : 'false'}"
                 aria-label="${immortal ? 'Снять бессмертность сохранения' : 'Сделать сохранение бессмертным'}"
                 title="${immortal ? 'Снять защиту от вытеснения' : 'Защитить сохранение от вытеснения'}">☠</button>
         <span class="gs-hist-main">
           <span class="gs-hist-meta" title="${timeStr} — ${esc(entry.label || 'Сохранение')}">${timeStr} — <em>${esc(entry.label || 'Сохранение')}</em></span>
           <span class="gs-hist-stats gs-tip" data-tip="${esc(targetStats)} · ${esc(sizeStats)}">${compactStats}</span>
         </span>
         <span class="gs-hist-actions">
             <button type="button" class="gs-btn gs-btn-sm gs-btn-compare gs-tip"
                    data-ts="${esc(ts)}" data-tabs="${tabsCount}"
                    data-blocks="${blocksTotal}" data-chars="${charTotal}"
                    data-anchors="${anchorCount}"
                    data-label="${esc(entry.label || 'Сохранение')}" data-time="${timeStr}"
                    data-tip="Показать разницу по вкладкам, блокам, символам и якорям."><span class="gs-btn-ico" aria-hidden="true">≋</span><span></span></button>
          ${entry.gistVersion
            ? ` <button type="button" class="gs-btn gs-btn-sm gs-btn-restore gs-tip" data-sha="${esc(entry.gistVersion)}" data-ts="${esc(ts)}" data-stats="${esc(targetStats)}" data-tip="Восстановить эту версию. Перед опасным откатом будет предложена защита."><span class="gs-btn-ico" aria-hidden="true">↩</span><span></span></button>`
            : ' <span class="gs-hist-nosha">—</span>'}
         </span>
       </li>`;
    }
    html += ` </ul>`;
  }
  html += ` </section>`;
}

// ── Локальные копии (IndexedDB) — заглушка, заполняется асинхронно ────
html += `
 <section class="gs-section gs-backups-section" id="gs-backups-section" aria-label="Локальные копии">
   <div class="gs-history-head">
     <h3 class="gs-section-title">Локальные копии</h3>
   </div>
   <div class="backup-empty">Загрузка…</div>
 </section>`;

body.innerHTML = html;
_bindModalEvents(body);
_loadBackups(body);
}
function _bindSmartTips(body) {
_tipsAbort?.abort();
_tipsAbort = new AbortController();
const { signal } = _tipsAbort;
let activeTip = null;
const removeTip = () => {
  activeTip?.remove();
  activeTip = null;
};
const showTip = el => {
  const text = el?.dataset?.tip;
  if (!text) return;
  removeTip();
  const tip = document.createElement('div');
  tip.className = 'gs-floating-tip';
  tip.textContent = text;
  document.body.appendChild(tip);
  const rect = el.getBoundingClientRect();
  const pad = 10;
  const tipRect = tip.getBoundingClientRect();
  const preferredTop = rect.top - tipRect.height - 9;
  const fallbackTop = rect.bottom + 9;
  const maxTop = Math.max(pad, window.innerHeight - tipRect.height - pad);
  const top = Math.min(maxTop, Math.max(pad, preferredTop >= pad ? preferredTop : fallbackTop));
  const maxLeft = Math.max(pad, window.innerWidth - tipRect.width - pad);
  const left = Math.min(
    maxLeft,
    Math.max(pad, rect.left + rect.width / 2 - tipRect.width / 2),
  );
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  requestAnimationFrame(() => tip.classList.add('show'));
  activeTip = tip;
};
body.querySelectorAll('.gs-tip[data-tip]').forEach(el => {
  el.addEventListener('mouseenter', () => showTip(el), { signal });
  el.addEventListener('mouseleave', removeTip, { signal });
  el.addEventListener('focusin', () => showTip(el), { signal });
  el.addEventListener('focusout', removeTip, { signal });
});
body.addEventListener('scroll', removeTip, { capture: true, signal });
}
function _bindModalEvents(body) {
_bindSmartTips(body);
body.querySelector('#gs-btn-push')?.addEventListener('click', () => {
  _manualPushOpen = true;
  if (isModalOpen()) renderModal();
  requestAnimationFrame(() => body.querySelector('#gs-manual-push-label')?.select());
});

const runManualPush = async ({ immortal = false } = {}) => {
  const input = body.querySelector('#gs-manual-push-label');
  const btn = immortal ? body.querySelector('#gs-btn-manual-push-immortal') : body.querySelector('#gs-btn-manual-push-save');
  const label = (input?.value || '').trim() || 'Ручное сохранение';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await push(label, { immortal });
    _lastPushAt = Date.now();
    _manualPushOpen = false;
    Toast.show(immortal ? '☠ Сохранено в Gist и защищено ✓' : '☁ Сохранено в Gist ✓', 'success');
    updateBadge();
    if (isModalOpen()) renderModal();
  } catch (err) {
    Toast.show(`☁ Ошибка Push: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = immortal ? '☠' : 'Сохранить'; }
  }
};

body.querySelector('#gs-manual-push-form')?.addEventListener('submit', e => {
  e.preventDefault();
  runManualPush();
});
body.querySelector('#gs-btn-manual-push-immortal')?.addEventListener('click', () => runManualPush({ immortal: true }));
body.querySelector('#gs-btn-manual-push-cancel')?.addEventListener('click', () => {
  _manualPushOpen = false;
  if (isModalOpen()) renderModal();
});

body.querySelector('#gs-btn-pull')?.addEventListener('click', async e => {
  const btn = e.currentTarget;
  if (_needsOverwriteProtection() && !confirm(
    `Есть локальные изменения: ${_formatStateStats(State.serialize())}.\n\n` +
    `Pull загрузит последнюю версию Gist и может перезаписать текущие данные.\n` +
    `Перед загрузкой будет создан локальный аварийный снимок в IndexedDB.`
  )) return;
  btn.disabled = true; btn.textContent = '⏳ Загрузка...';
  try {
    if (_needsOverwriteProtection()) await createEmergencySnapshot('Перед Pull из Gist');
    const data = await pull();
    Storage.save(data);
    State.load(data);
    markPulledSynced(data);
    Toast.show('☁ Данные загружены из Gist ✓', 'success');
    closeDialog();
  } catch (err) {
    const history = getCloudHistory();
    if (history.length > 0 && (err.message.includes('поврежд') || err.message.includes('обрезан'))) {
      const latestValid = history[0];
      const timeStr = new Date(latestValid.ts).toLocaleString('ru');
      if (confirm(
        `Текущая версия в Gist повреждена или обрезана.\n\n` +
        `Последнее успешное сохранение: ${timeStr}\n` +
        `Хотите восстановить из облачной истории?`
      )) {
        try {
          await restoreVersion(latestValid.gistVersion);
          Toast.show('☁ Версия восстановлена из истории ✓', 'success');
          closeDialog();
          return;
        } catch (restoreErr) {
          Toast.show(`☁ Ошибка восстановления: ${restoreErr.message}`, 'error');
        }
      }
    }
    Toast.show(`☁ Ошибка Pull: ${err.message}`, 'error');
    btn.disabled = false; btn.textContent = '⬇ Pull';
  }
});

body.querySelector('#gs-btn-disconnect')?.addEventListener('click', () => {
  if (!confirm('Отключить Gist-синхронизацию? Локальные данные и история будут очищены.')) return;
  disconnect();
  updateBadge();
  if (isModalOpen()) renderModal();
  Toast.show('☁ Gist отключён', '');
});

body.querySelector('#gs-pat-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const input = body.querySelector('#gs-pat-input');
  const btn   = body.querySelector('#gs-btn-pat-connect');
  const token = (input?.value || '').trim();
  if (!token) { Toast.show('Введите токен', 'error'); input?.focus(); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const { login } = await connectPAT(token);
    if (input) input.value = '';
    updateBadge();
    Toast.show(`☁ Подключено как ${login} ✓`, 'success');
    if (isModalOpen()) renderModal();
  } catch (err)  {
    Toast.show(`☁ ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔗 Подключить'; }
  }
});

body.querySelector('#gs-btn-connect')?.addEventListener('click', e => {
  e.currentTarget.disabled = true;
  connect({
    onCode(user_code, verificationUri) {
      _connectingCode = { user_code, verificationUri };
      if (isModalOpen()) renderModal();
    },
    onSuccess() {
      _connectingCode = null;
      updateBadge();
      if (isModalOpen()) renderModal();
      Toast.show('☁ GitHub подключён ✓', 'success');
     },
    onError(msg) {
      _connectingCode = null;
      if (isModalOpen()) renderModal();
      Toast.show(`☁ ${msg}`, 'error');
    },
  });
});

body.querySelector('#gs-btn-connect-cancel')?.addEventListener('click', () => {
  _connectAbort?.();
  _connectingCode = null;
  if (isModalOpen()) renderModal();
});

const settingsForm = body.querySelector('#gs-settings-form');
let settingsToastTimer = null;
const autoSaveSettings = ({ toast = false } = {}) => {
  const next = _saveSettingsFromForm(body, { silent: true });
  const summary = body.querySelector('.gs-settings-summary');
  if (summary) summary.textContent = `${next.autoSave ? 'Auto' : 'Manual'} · ${next.debounceMin} мин · N=${next.batchMax} · история ${next.historyDepth}`;
  if (settingsToastTimer) clearTimeout(settingsToastTimer);
  if (toast) settingsToastTimer = setTimeout(() => Toast.show('Настройки сохранены автоматически ✓', 'success'), 420);
};

settingsForm?.querySelectorAll('input[type="checkbox"]').forEach(input => {
  input.addEventListener('change', e => {
    if (e.currentTarget.id === 'gs-set-encrypt') {
      const row = body.querySelector('.gs-encrypt-row');
      const pwd = body.querySelector('#gs-set-pwd');
      if (row) row.style.display = e.currentTarget.checked ? 'grid' : 'none';
      if (!e.currentTarget.checked && pwd) pwd.value = '';
      if (e.currentTarget.checked && pwd?.value?.trim()) Cipher.setPassword(pwd.value.trim());
    }
    autoSaveSettings({ toast: true });
  });
});

settingsForm?.querySelectorAll('input[type="number"]').forEach(input => {
  input.addEventListener('change', () => autoSaveSettings({ toast: true }));
  input.addEventListener('blur', () => autoSaveSettings({ toast: false }));
});

const pwdInput = body.querySelector('#gs-set-pwd');
let pwdTimer = null;
pwdInput?.addEventListener('input', () => {
  clearTimeout(pwdTimer);
  pwdTimer = setTimeout(() => {
    const pwd = pwdInput.value.trim();
    Cipher.setPassword(pwd);
    saveSettings({ encrypt: !!pwd });
    Toast.show(pwd ? 'Пароль сохранён автоматически ✓' : 'Шифрование отключено', pwd ? 'success' : '');
    if (!pwd && isModalOpen()) renderModal();
  }, 650);
});
pwdInput?.addEventListener('blur', () => {
  clearTimeout(pwdTimer);
  const pwd = pwdInput.value.trim();
  Cipher.setPassword(pwd);
  saveSettings({ encrypt: !!pwd });
});

body.querySelectorAll('.gs-btn-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    _historyMenuOpen = false;
    setHistoryFilter(btn.dataset.filter);
    if (isModalOpen()) renderModal();
  });
});

body.querySelector('#gs-btn-history-menu')?.addEventListener('click', e => {
  e.stopPropagation();
  _historyMenuOpen = !_historyMenuOpen;
  if (isModalOpen()) renderModal();
});

body.querySelector('#gs-btn-clear-normal')?.addEventListener('click', () => {
  if (!confirm('Удалить обычные записи истории? Бессмертные сохранения останутся.')) return;
  const removed = clearNormalHistory();
  _historyMenuOpen = false;
  Toast.show(`Удалено обычных записей: ${removed}`, removed ? 'success' : '');
  if (isModalOpen()) renderModal();
});

body.querySelector('#gs-btn-restore-emergency')?.addEventListener('click', async () => {
  const latest = _emergencyList[0];
  if (!latest) return;
  const timeStr = new Date(latest.ts).toLocaleString('ru');
  if (!confirm(`Восстановить локальный аварийный снимок от ${timeStr}?\n${latest.stats || ''}`)) return;
  try {
    await createEmergencySnapshot('Перед восстановлением аварийного снимка');
    const data = await Storage.loadEmergencySnapshot?.(latest.id);
    if (!data) throw new Error('Снимок не найден или повреждён');
    Storage.save(data);
    State.load(data);
    localStorage.setItem(K_DIRTY, 'true');
    _historyMenuOpen = false;
    updateBadge();
    Toast.show('Локальный аварийный снимок восстановлен ✓', 'success');
    closeDialog();
  } catch (err) {
    Toast.show(`Ошибка восстановления снимка: ${err.message}`, 'error');
  }
});

body.querySelector('#gs-btn-clear-emergency')?.addEventListener('click', async () => {
  if (!confirm('Удалить все локальные аварийные снимки? Облачная история не изменится.')) return;
  const removed = await Storage.clearEmergencySnapshots?.() || 0;
  await _refreshEmergencySnapshots();
  _historyMenuOpen = false;
  Toast.show(`Удалено аварийных снимков: ${removed}`, removed ? 'success' : '');
  if (isModalOpen()) renderModal();
});

body.querySelector('#gs-btn-unpin-all')?.addEventListener('click', () => {
  if (!confirm('Снять бессмертность со всех сохранений?')) return;
  const changed = clearAllImmortalMarks();
  _historyMenuOpen = false;
  Toast.show(`Снято ☠: ${changed}`, changed ? 'success' : '');
  if (isModalOpen()) renderModal();
});

body.querySelectorAll('.gs-btn-immortal').forEach(btn => {
  btn.addEventListener('click', () => {
    const immortal = toggleHistoryImmortal(btn.dataset.ts);
    Toast.show(immortal ? '☠ Сохранение стало бессмертным' : '☠ Защита снята', immortal ? 'success' : '');
    if (isModalOpen()) renderModal();
  });
});

body.querySelector('#gs-btn-compare-close')?.addEventListener('click', () => {
  _compareView = null;
  if (isModalOpen()) renderModal();
});

body.querySelectorAll('.gs-btn-compare').forEach(btn => {
  btn.addEventListener('click', () => {
    _compareView = {
      time: btn.dataset.time || '',
      label: btn.dataset.label || 'Сохранение',
      tabs: Number(btn.dataset.tabs) || 0,
      blocks: Number(btn.dataset.blocks) || 0,
      chars: Number(btn.dataset.chars) || 0,
      anchors: Number(btn.dataset.anchors) || 0,
    };
    if (isModalOpen()) renderModal();
  });
});

body.querySelectorAll('.gs-btn-restore').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tsStr = new Date(Number(btn.dataset.ts)).toLocaleString('ru');
    let protectedOk = false;
    try {
      protectedOk = await protectCurrentBeforeOverwrite('восстановлением версии', btn.dataset.stats || '');
    } catch (err) {
      Toast.show(`☁ Защита не создана: ${err.message}`, 'error');
      return;
    }
    if (!protectedOk) return;
    if (!confirm(`Восстановить версию от ${tsStr}?\nТекущие данные будут перезаписаны.`)) return;
    btn.disabled = true; btn.textContent = '⏳';
    try {
      await createEmergencySnapshot('Перед восстановлением версии из истории');
      await restoreVersion(btn.dataset.sha);
      Toast.show('☁ Версия восстановлена ✓', 'success');
      closeDialog();
     } catch (err) {
      Toast.show(`☁ Ошибка восстановления: ${err.message}`, 'error');
      btn.disabled = false; btn.textContent = 'Восстановить';
    }
  });
});
}
// ═══ Init ═════════════════════════════════════════════════════════════════
function init() {
document.getElementById('btn-gist-sync')
?.addEventListener('click', e => { e.stopPropagation(); openDialog(); });
document.getElementById('gist-modal-close')
?.addEventListener('click', closeDialog);
document.getElementById('gist-sync-modal')
?.addEventListener('click', e => { if (e.target === e.currentTarget) closeDialog(); });
document.addEventListener('keydown', e => {
if (e.key === 'Escape' && isModalOpen()) closeDialog();
});
updateBadge();
}
return {
init,
openDialog,
push:          label => push(label),
	pull:          async () => {
		if (_needsOverwriteProtection()) await createEmergencySnapshot('Перед Pull из внешнего вызова');
		const data = await pull();
		Storage.save(data);
		State.load(data);
		markPulledSynced(data);
	},
isConnected,
getStatus:     getStats,
onSaveTrigger,
schedulePush,
connectPAT,
pushWordlist,
	pullWordlist,
	};
})();

window.GistSync = GistSync;
