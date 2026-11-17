// Design Master — tiny IndexedDB key/value store (autosave survives reloads, holds large images).
const DB = 'design-master', STORE = 'kv';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function save(key, value) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function load(key) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readonly'); const r = t.objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
