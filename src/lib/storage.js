const DATABASE_NAME = 'force-canvas-graph';
const DATABASE_VERSION = 1;

export class GraphStore {
  constructor() {
    this.database = null;
    this.memory = new Map();
    this.available = false;
  }

  async open() {
    if (typeof indexedDB === 'undefined') {
      this.available = false;
      return;
    }

    try {
      this.database = await withTimeout(openDatabase(), 2500);
      this.available = true;
    } catch (error) {
      this.database = null;
      this.available = false;
      throw error;
    }
  }

  async put(storeName, key, value) {
    if (this.database) {
      await withTimeout(this.request(storeName, 'put', { key, value }), 2500);
      return;
    }

    this.memory.set(`${storeName}:${key}`, structuredCloneSafe(value));
  }

  async get(storeName, key) {
    if (this.database) {
      return withTimeout(this.request(storeName, 'get', key), 2500);
    }

    return structuredCloneSafe(this.memory.get(`${storeName}:${key}`));
  }

  async delete(storeName, key) {
    if (this.database) {
      await withTimeout(this.request(storeName, 'delete', key), 2500);
      return;
    }

    this.memory.delete(`${storeName}:${key}`);
  }

  request(storeName, method, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(storeName, 'readwrite');
      const request = transaction.objectStore(storeName)[method](value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务中止'));
    });
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      ['graphs', 'snapshots', 'metadata'].forEach(name => {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name);
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 不可用'));
    request.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
  });
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB 操作超时')), milliseconds);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function structuredCloneSafe(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}
