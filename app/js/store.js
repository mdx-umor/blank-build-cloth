// Design Master — IndexedDB storage: autosave (kv) and "Your files" (saved designs with thumbnails).
const DB = 'design-master';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
  });
};
export const save = (key, value) => tx('kv', 'readwrite', s => s.put(value, key));
export const load = (key) => tx('kv', 'readonly', s => s.get(key));

/* ---------- your files ---------- */
export const putFile = (file) => tx('files', 'readwrite', s => s.put(file));
export const getFile = (id) => tx('files', 'readonly', s => s.get(id));
export const deleteFile = (id) => tx('files', 'readwrite', s => s.delete(id));
export async function listFiles() {
  const all = await tx('files', 'readonly', s => s.getAll());
  // the list only needs light fields
  return (all || []).map(f => ({ id: f.id, name: f.name, garment: f.garment, updated: f.updated, thumb: f.thumb })).sort((a, b) => b.updated - a.updated);
}
