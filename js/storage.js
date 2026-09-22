// IndexedDB による履歴と録音の保存（すべて端末内）

const DB_NAME = 'koe-sensei';
const DB_VER = 3;
const MAX_AUDIO = 40; // 録音はこの件数まで保持（古いものから削除、採点結果は残る）

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('refs')) db.createObjectStore('refs', { keyPath: 'title' });
      // v3: 一覧表示用の軽い要約（重い解析データを読まずに済むように）
      if (!db.objectStoreNames.contains('summaries')) {
        const sum = db.createObjectStore('summaries', { keyPath: 'id' });
        if (ev.oldVersion > 0 && db.objectStoreNames.contains('sessions')) {
          const cur = req.transaction.objectStore('sessions').openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return;
            sum.put(summarize(c.value));
            c.continue();
          };
        }
      }
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

/** 一覧用の要約 */
function summarize(session) {
  const { report, ...rest } = session;
  return {
    ...rest,
    total: report.total,
    insufficient: !!report.insufficient,
    categories: report.categories.map((c) => ({ id: c.id, short: c.short, score: c.score })),
  };
}

export async function saveSession(session, audio) {
  await tx('sessions', 'readwrite', (st) => st.put(session));
  await tx('summaries', 'readwrite', (st) => st.put(summarize(session)));
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
  await tx('summaries', 'readwrite', (st) => st.put(summarize(s)));
}

export function getSession(id) {
  return tx('sessions', 'readonly', (st) => reqP(st.get(id)));
}

export function getAudio(id) {
  return tx('audio', 'readonly', (st) => reqP(st.get(id)));
}

/** 一覧用（要約のみ、新しい順） */
export async function listSessions() {
  const all = await tx('summaries', 'readonly', (st) => reqP(st.getAll()));
  return all.sort((a, b) => b.date - a.date);
}

export async function deleteSession(id) {
  await tx('sessions', 'readwrite', (st) => st.delete(id));
  await tx('summaries', 'readwrite', (st) => st.delete(id));
  await tx('audio', 'readwrite', (st) => st.delete(id));
}

async function pruneAudio() {
  const keys = await tx('audio', 'readonly', (st) => reqP(st.getAllKeys()));
  if (keys.length <= MAX_AUDIO) return;
  const sessions = await tx('summaries', 'readonly', (st) => reqP(st.getAll()));
  const byDate = new Map(sessions.map((s) => [s.id, s.date]));
  const sorted = keys.sort((a, b) => (byDate.get(a) || 0) - (byDate.get(b) || 0));
  const drop = sorted.slice(0, keys.length - MAX_AUDIO);
  await tx('audio', 'readwrite', (st) => drop.forEach((k) => st.delete(k)));
}

// ---------- お手本（曲名ごと） ----------
export function saveRef(ref) {
  return tx('refs', 'readwrite', (st) => st.put(ref));
}

export function getRef(title) {
  if (!title) return Promise.resolve(null);
  return tx('refs', 'readonly', (st) => reqP(st.get(title)));
}

export function deleteRef(title) {
  return tx('refs', 'readwrite', (st) => st.delete(title));
}

export async function listRefTitles() {
  return tx('refs', 'readonly', (st) => reqP(st.getAllKeys()));
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
