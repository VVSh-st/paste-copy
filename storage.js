// file_name: storage.js
'use strict';

const Storage = (() => {

  const KEY     = 'llm-prompt-builder-v3';
  const KEY_OLD = 'llm-prompt-builder-v2';
  const KEY_TPL = 'llm-prompt-builder-tpl';

  const KEY_LLM_CACHE   = 'llm-pb-cache';
  const KEY_LLM_HISTORY = 'llm-pb-history';

  const IDB_DB    = 'llm-prompt-builder-db';
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

    if (raw === _lastSavedRaw) return true;
    _lastSavedRaw = raw;

    if (raw.length <= 3_500_000 && _set(KEY, raw)) {
      _set(MODE_KEY, 'localStorage');
      _idbSet(KEY, raw).catch(e => _warn('save:idb-mirror', e));
      return true;
    }

    // Если документ крупный или localStorage упёрся в лимит, переносим основу в IndexedDB.
    _idbSet(KEY, raw).then(ok => {
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

      if (_isPointer(raw)) raw = await _idbGet(KEY);

      // Если localStorage пуст, пробуем большую копию из IndexedDB.
      if (!raw) raw = await _idbGet(KEY);

      // Если нет — пробуем старый ключ (миграция v2 → v3).
      if (!raw) {
        raw = _get(KEY_OLD);
        if (raw) migrated = true;
      }

      if (!raw) return null;

      const parsed = _validState(JSON.parse(raw));
      if (!parsed) return null;

      if (migrated) {
        save(parsed);
        _remove(KEY_OLD);
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
      const raw = _get(KEY_TPL);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
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
      const raw = _get(KEY_LLM_CACHE);
      if (!raw) return { entries: {}, order: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.entries !== 'object' || !Array.isArray(parsed.order)) {
        return { entries: {}, order: [] };
      }
      return parsed;
    } catch (e) {
      _warn('loadLLMCache', e);
      return { entries: {}, order: [] };
    }
  }

  function clearLLMCache() {
    _remove(KEY_LLM_CACHE);
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
      const raw = _get(KEY_LLM_HISTORY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
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
