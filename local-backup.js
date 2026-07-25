// file_name: local-backup.js
'use strict';

const LocalBackup = (() => {
  const DB_NAME = 'paste-copy-backup';
  const STORE = 'snapshots';
  const MAX_BACKUPS = 30;
  let db = null;

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
    const data = JSON.stringify(state);
    const entry = {
      ts: Date.now(),
      size: data.length,
      tabsCount: state.tabs?.length ?? 0,
      data,
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
      req.onsuccess = () => resolve(req.result?.data ? JSON.parse(req.result.data) : null);
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
