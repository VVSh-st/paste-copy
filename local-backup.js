// file_name: local-backup.js
'use strict';

const LocalBackup = (() => {
  const DB_NAME = 'paste-copy-backup';
  const STORE = 'snapshots';
  const MAX_BACKUPS = 30;
  let db = null;

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
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    let len = 0; for (const c of chunks) len += c.length;
    const out = new Uint8Array(len); let off = 0;
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

  async function _compressWithTimeout(str, ms = 10_000) {
    try {
      return await Promise.race([
        _compress(str),
        new Promise((_, rej) => setTimeout(() => rej(new Error('compress_timeout')), ms)),
      ]);
    } catch { return { data: str, compressed: false }; }
  }

  function init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'ts' });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function save(state) {
    if (!db) await init();
    const raw = JSON.stringify(state);
    const envelope = await _compressWithTimeout(raw);
    const entry = {
      ts: Date.now(),
      size: raw.length,
      tabsCount: state.tabs?.length ?? 0,
      data: envelope.data,
      compressed: envelope.compressed || false,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = async () => {
        await prune();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function list() {
    if (!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const items = req.result.sort((a, b) => b.ts - a.ts);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function restore(ts) {
    if (!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(ts);
      req.onsuccess = async () => {
        try {
          const entry = req.result;
          if (!entry?.data) { resolve(null); return; }
          const raw = await _decompress({ data: entry.data, compressed: !!entry.compressed });
          resolve(JSON.parse(raw));
        } catch { resolve(null); }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function prune() {
    const items = await list();
    if (items.length <= MAX_BACKUPS) return;
    const toDelete = items.filter(it => !it.immortal).slice(MAX_BACKUPS - items.filter(it => it.immortal).length);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    toDelete.forEach(item => store.delete(item.ts));
  }

  async function toggleImmortal(ts) {
    if (!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).get(ts);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) { resolve(false); return; }
        entry.immortal = !entry.immortal;
        tx.objectStore(STORE).put(entry);
        resolve(entry.immortal);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function clear() {
    if (!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { init, save, list, restore, prune, clear, toggleImmortal };
})();
