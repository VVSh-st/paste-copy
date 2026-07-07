// file_name: storage.js
'use strict';

const Storage = (() => {

  const KEY     = 'paste-copy-v3';
  const KEY_OLD = 'paste-copy-v2';
  const KEY_TPL = 'paste-copy-tpl';
  const LEGACY_SLUG = ['llm', 'prompt', 'builder'].join('-');
  const LEGACY_KEY     = `${LEGACY_SLUG}-v3`;
  const LEGACY_KEY_OLD = `${LEGACY_SLUG}-v2`;
  const LEGACY_KEY_TPL = `${LEGACY_SLUG}-tpl`;

  const KEY_LLM_CACHE   = 'paste-copy-cache';
  const KEY_LLM_HISTORY = 'paste-copy-history';
  const LEGACY_KEY_LLM_CACHE   = 'llm-pb-cache';
  const LEGACY_KEY_LLM_HISTORY = 'llm-pb-history';

  const IDB_DB    = 'paste-copy-db';
  const IDB_STORE = 'kv';
  const MODE_KEY  = KEY + ':mode';
  const SNAP_INDEX_KEY = 'emergency:index';
  const SNAP_LIMIT = 8;

  let _dbPromise = null;
  let _lastSavedRaw = null;

  function _warn(ctx, err) {
    console.warn(`[Storage:${ctx}]`, err?.message ?? err);
  }

  function _get(key) {
    try   { return localStorage.getItem(key); }
    catch (e) { _warn('get:' + key, e); return null; }
  }

  function _set(key, value) {
    try   { localStorage.setItem(key, value); return true; }
    catch (e) { _warn('set:' + key, e); return false; }
  }

  function _remove(key) {
    try   { localStorage.removeItem(key); }
    catch (e) { _warn('remove:' + key, e); }
  }

  // ── Compression ──────────────────────────────────────────────────────────
  const _compressSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

  function _bytesToB64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < u8.length; i += CHUNK)
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    return btoa(bin);
  }

  function _b64ToBytes(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

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

  async function _compress(str) {
    if (!_compressSupported) return { data: str, compressed: false };
    const encoded = new TextEncoder().encode(str);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    await writer.write(encoded);
    await writer.close();
    return { data: _bytesToB64(await _readStream(cs.readable)), compressed: true };
  }

  async function _decompress(envelope) {
    if (!envelope.compressed) return envelope.data;
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(_b64ToBytes(envelope.data));
    await writer.close();
    return new TextDecoder().decode(await _readStream(ds.readable));
  }

  function _isCompressed(raw) {
    if (!raw || raw[0] !== '{') return false;
    try { return JSON.parse(raw)?._c === true; }
    catch { return false; }
  }

  async function _decompressRaw(raw) {
    try {
      const envelope = JSON.parse(raw);
      return await _decompress(envelope);
    } catch (e) {
      _warn('load:decompress', e);
      return raw;
    }
  }

  function _openDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise(resolve => {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        _warn('indexedDB:open', req.error);
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    });

    return _dbPromise;
  }

  async function _idbGet(key) {
    const db = await _openDb();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => { _warn('indexedDB:get:' + key, req.error); resolve(null); };
    });
  }

  async function _idbSet(key, value) {
    const db = await _openDb();
    if (!db) return false;
    return new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => { _warn('indexedDB:set:' + key, tx.error); resolve(false); };
      tx.onabort = () => { _warn('indexedDB:set-abort:' + key, tx.error); resolve(false); };
      tx.objectStore(IDB_STORE).put(value, key);
    });
  }

  async function _idbRemove(key) {
    const db = await _openDb();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.objectStore(IDB_STORE).delete(key);
    });
  }

  function _isPointer(raw) {
    if (!raw || raw[0] !== '{') return false;
    try { return JSON.parse(raw)?._idb === true; }
    catch { return false; }
  }

  function _validState(parsed) {
    return parsed && Array.isArray(parsed.tabs) ? parsed : null;
  }

  async function ready() {
    try {
      await _openDb();
      navigator.storage?.persist?.().catch(() => {});
    } catch (e) {
      _warn('ready', e);
    }
  }

  // =Core state=

  function save(data) {
    let raw;
    try { raw = JSON.stringify(data); }
    catch (e) { _warn('save:stringify', e); return false; }

    if (raw === _lastSavedRaw) { console.log('[STORAGE] dedup skip, len:', raw.length); return true; }
    _lastSavedRaw = raw;

    console.log('[STORAGE] save attempt, raw.length:', raw.length);
    if (raw.length <= 3_500_000 && _set(KEY, raw)) {
      console.log('[STORAGE] localStorage OK');
      _set(MODE_KEY, 'localStorage');
      _idbSet(KEY, raw).catch(e => _warn('save:idb-mirror', e));
      return true;
    }

    console.log('[STORAGE] localStorage FAILED, trying IDB');
    _idbSet(KEY, raw).then(ok => {
      console.log('[STORAGE] IDB result:', ok);
      if (!ok) return;
      _remove(KEY);
      _set(KEY, JSON.stringify({ _idb: true, key: KEY, ts: Date.now() }));
      _set(MODE_KEY, 'indexedDB');
    }).catch(e => _warn('save:indexedDB', e));

    return false;
  }

  async function load() {
    try {
      await ready();

      let raw = _get(KEY);
      let migrated = false;

      // Handle IDB pointer
      if (_isPointer(raw)) raw = await _idbGet(KEY);

      // Handle compressed envelope
      if (raw && _isCompressed(raw)) {
        raw = await _decompressRaw(raw);
      }

      // Fallback: try IDB directly
      if (!raw) raw = await _idbGet(KEY);

      // Migration from old keys
      if (!raw) {
        raw = _get(KEY_OLD) || _get(LEGACY_KEY) || _get(LEGACY_KEY_OLD);
        if (raw) migrated = true;
      }

      if (!raw) return null;

      const parsed = _validState(JSON.parse(raw));
      if (!parsed) return null;

      if (migrated) {
        save(parsed);
        _remove(KEY_OLD);
        _remove(LEGACY_KEY);
        _remove(LEGACY_KEY_OLD);
      }

      return parsed;
    } catch (e) {
      _warn('load', e);
      return null;
    }
  }

  function getStorageInfo() {
    const mode = _get(MODE_KEY) || (_isPointer(_get(KEY)) ? 'indexedDB' : 'localStorage');
    const localSize = (_get(KEY) || '').length;
    return { mode, localSize, hasIndexedDB: 'indexedDB' in window };
  }

  // =Emergency snapshots=

  async function _readSnapshotIndex() {
    const index = await _idbGet(SNAP_INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  async function saveEmergencySnapshot(data, meta = {}) {
    try {
      const raw = JSON.stringify(data);
      const ts = Date.now();
      const id = `snap:${ts}:${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        id,
        ts,
        reason: String(meta.reason || 'Аварийный снимок'),
        stats: meta.stats || null,
        size: raw.length,
      };

      const ok = await _idbSet(id, { ...entry, raw });
      if (!ok) return null;

      const index = [entry, ...(await _readSnapshotIndex()).filter(item => item?.id !== id)];
      const kept = index.slice(0, SNAP_LIMIT);
      const removed = index.slice(SNAP_LIMIT);
      await _idbSet(SNAP_INDEX_KEY, kept);
      await Promise.all(removed.map(item => item?.id ? _idbRemove(item.id) : Promise.resolve()));
      return entry;
    } catch (e) {
      _warn('saveEmergencySnapshot', e);
      return null;
    }
  }

  async function listEmergencySnapshots() {
    try { return await _readSnapshotIndex(); }
    catch (e) { _warn('listEmergencySnapshots', e); return []; }
  }

  async function loadEmergencySnapshot(id) {
    try {
      if (!id) return null;
      const record = await _idbGet(id);
      if (!record?.raw) return null;
      return _validState(JSON.parse(record.raw));
    } catch (e) {
      _warn('loadEmergencySnapshot', e);
      return null;
    }
  }

  async function clearEmergencySnapshots() {
    try {
      const index = await _readSnapshotIndex();
      await Promise.all(index.map(item => item?.id ? _idbRemove(item.id) : Promise.resolve()));
      await _idbSet(SNAP_INDEX_KEY, []);
      return index.length;
    } catch (e) {
      _warn('clearEmergencySnapshots', e);
      return 0;
    }
  }

  // =Templates=

  function loadTemplates() {
    try {
      let raw = _get(KEY_TPL);
      const migrated = !raw && _get(LEGACY_KEY_TPL);
      if (!raw && migrated) raw = migrated;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      if (migrated) {
        _set(KEY_TPL, JSON.stringify(parsed));
        _remove(LEGACY_KEY_TPL);
      }
      return parsed;
    } catch (e) {
      _warn('loadTemplates', e);
      return null;
    }
  }

  function saveTemplates(data) {
    _set(KEY_TPL, JSON.stringify(data));
  }

  // =LLM Cache=

  function saveLLMCache(data) {
    try {
      _set(KEY_LLM_CACHE, JSON.stringify(data));
    } catch (e) {
      _warn('saveLLMCache', e);
    }
  }

  function loadLLMCache() {
    try {
      let raw = _get(KEY_LLM_CACHE);
      const migrated = !raw && _get(LEGACY_KEY_LLM_CACHE);
      if (!raw && migrated) raw = migrated;
      if (!raw) return { entries: {}, order: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.entries !== 'object' || !Array.isArray(parsed.order)) {
        return { entries: {}, order: [] };
      }
      if (migrated) {
        _set(KEY_LLM_CACHE, JSON.stringify(parsed));
        _remove(LEGACY_KEY_LLM_CACHE);
      }
      return parsed;
    } catch (e) {
      _warn('loadLLMCache', e);
      return { entries: {}, order: [] };
    }
  }

  function clearLLMCache() {
    _remove(KEY_LLM_CACHE);
    _remove(LEGACY_KEY_LLM_CACHE);
  }

  // =LLM Request History=

  function saveLLMHistory(data) {
    try {
      _set(KEY_LLM_HISTORY, JSON.stringify(data));
    } catch (e) {
      _warn('saveLLMHistory', e);
    }
  }

  function loadLLMHistory() {
    try {
      let raw = _get(KEY_LLM_HISTORY);
      const migrated = !raw && _get(LEGACY_KEY_LLM_HISTORY);
      if (!raw && migrated) raw = migrated;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      if (migrated) {
        _set(KEY_LLM_HISTORY, JSON.stringify(parsed));
        _remove(LEGACY_KEY_LLM_HISTORY);
      }
      return parsed;
    } catch (e) {
      _warn('loadLLMHistory', e);
      return [];
    }
  }

  // =API key store=

  function saveLLMKey(profileId, apiKey) {
    if (!profileId) return;
    if (apiKey) {
      _set('llm-key-' + profileId, apiKey);
    } else {
      _remove('llm-key-' + profileId);
    }
  }

  function loadLLMKey(profileId) {
    if (!profileId) return '';
    return _get('llm-key-' + profileId) ?? '';
  }

  function removeLLMKey(profileId) {
    if (!profileId) return;
    _remove('llm-key-' + profileId);
  }

  return {
    save, load, ready, getStorageInfo,
    saveEmergencySnapshot, listEmergencySnapshots, loadEmergencySnapshot, clearEmergencySnapshots,
    loadTemplates, saveTemplates,
    saveLLMCache, loadLLMCache, clearLLMCache,
    saveLLMHistory, loadLLMHistory,
    saveLLMKey, loadLLMKey, removeLLMKey,
    _set, _get,
  };
})();

window.Storage = Storage;
