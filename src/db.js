/* IndexedDB persistence with graceful degradation to in-memory/no-op. */

const DB_NAME = 'force-graph';
const STORE = 'layouts';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB unsupported'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export function createStore() {
  let dbPromise = openDB().catch((err) => {
    console.warn('[db] falling back to no-op store:', err.message);
    return null;
  });

  async function withStore(mode, fn) {
    const db = await dbPromise;
    if (!db) return undefined; // degraded: persistence unavailable
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
  }

  return {
    async saveLayout(key, x, y) {
      try {
        await withStore('readwrite', (s) => s.put({ x: Array.from(x), y: Array.from(y), savedAt: Date.now() }, key));
        return true;
      } catch (err) {
        console.warn('[db] saveLayout failed:', err.message);
        return false;
      }
    },
    async loadLayout(key) {
      try {
        const row = await withStore('readonly', (s) => s.get(key));
        if (row && Array.isArray(row.x) && Array.isArray(row.y)) {
          return { x: Float64Array.from(row.x), y: Float64Array.from(row.y) };
        }
        return null;
      } catch (err) {
        console.warn('[db] loadLayout failed:', err.message);
        return null;
      }
    },
    async clear(key) {
      try { await withStore('readwrite', (s) => s.delete(key)); } catch (_) { /* degraded */ }
    },
  };
}
