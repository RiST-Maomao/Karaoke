// IndexedDB による履歴と録音の保存（すべて端末内）

const DB_NAME = 'koe-sensei';
const DB_VER = 1;
const MAX_AUDIO = 40; // 録音はこの件数まで保持（古いものから削除、採点結果は残る）

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const st = t.objectStore(store);
        let result;
        Promise.resolve(fn(st)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const reqP = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export async function saveSession(session, audio) {
  await tx('sessions', 'readwrite', (st) => st.put(session));
  if (audio) {
    await tx('audio', 'readwrite', (st) => st.put({ id: session.id, ...audio }));
    await pruneAudio();
  }
}

export async function updateSession(id, patch) {
  const s = await getSession(id);
  if (!s) return;
  Object.assign(s, patch);
  await tx('sessions', 'readwrite', (st) => st.put(s));
}

export function getSession(id) {
  return tx('sessions', 'readonly', (st) => reqP(st.get(id)));
}

export function getAudio(id) {
  return tx('audio', 'readonly', (st) => reqP(st.get(id)));
}

/** 一覧用（重いトラックデータは除いて返す） */
export async function listSessions() {
  const all = await tx('sessions', 'readonly', (st) => reqP(st.getAll()));
  return all
    .map(({ report, ...rest }) => ({
      ...rest,
      total: report.total,
      categories: report.categories.map((c) => ({ id: c.id, short: c.short, score: c.score })),
      metrics: report.metrics,
    }))
    .sort((a, b) => b.date - a.date);
}

export async function deleteSession(id) {
  await tx('sessions', 'readwrite', (st) => st.delete(id));
  await tx('audio', 'readwrite', (st) => st.delete(id));
}

async function pruneAudio() {
  const keys = await tx('audio', 'readonly', (st) => reqP(st.getAllKeys()));
  if (keys.length <= MAX_AUDIO) return;
  const sessions = await tx('sessions', 'readonly', (st) => reqP(st.getAll()));
  const byDate = new Map(sessions.map((s) => [s.id, s.date]));
  const sorted = keys.sort((a, b) => (byDate.get(a) || 0) - (byDate.get(b) || 0));
  const drop = sorted.slice(0, keys.length - MAX_AUDIO);
  await tx('audio', 'readwrite', (st) => drop.forEach((k) => st.delete(k)));
}

export async function getKV(k, def = null) {
  const r = await tx('kv', 'readonly', (st) => reqP(st.get(k)));
  return r ? r.v : def;
}

export function setKV(k, v) {
  return tx('kv', 'readwrite', (st) => st.put({ k, v }));
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {}
}
