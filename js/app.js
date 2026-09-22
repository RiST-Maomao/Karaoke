// アプリ本体：画面遷移と状態管理
import { AudioEngine } from './audio/engine.js';
import { packForStorage, unpackStored, encodeWav, decodeFileToMono } from './audio/pcm.js';
import * as store from './storage.js';
import { h, toast } from './ui/dom.js';
import { renderSing, renderRecording, renderAnalyzing } from './views/sing.js';
import { renderResult } from './views/result.js';
import { renderHistory } from './views/history.js';
import { renderPractice } from './views/practice.js';
import { renderGuide } from './views/guide.js';

// ---------- 共有状態 ----------
export const app = {
  engine: new AudioEngine(),
  worker: null,
  view: null, // 現在の画面の後始末関数など
  liveListeners: new Set(),
  pendingReports: new Map(),
  songTitle: '',
  accompName: '',
  accompVolume: 0.7,
  reference: null, // 現在の曲のお手本 { title, fileName, total, track }
  refSynced: true, // 伴奏とお手本が同じ時間軸か
};

/** 伴奏とお手本を同じ時間軸で扱うか */
export function isSynced() {
  return !!(app.reference && app.engine.accompBuffer && app.refSynced);
}

function refPayload() {
  return app.reference ? { track: app.reference.track } : null;
}

/** 曲名に対応するお手本を読み込む */
export async function loadReferenceFor(title) {
  try {
    const ref = await store.getRef((title || '').trim());
    app.reference = ref || null;
  } catch {
    app.reference = null;
  }
  return app.reference;
}

/** お手本ボーカルの音声ファイルを解析して、曲名に紐づけて保存 */
export async function registerReference(file, title, onProgress) {
  await app.engine.ensureContext();
  const { pcm, sampleRate } = await decodeFileToMono(app.engine.ctx, file);
  const report = await requestReport({ type: 'analyzeBuffer', data: pcm, sampleRate }, onProgress);
  if (!report.enoughVoice) throw new Error('歌声が検出できませんでした');
  const tr = report.track;
  const ref = {
    title: title.trim(),
    fileName: file.name,
    date: Date.now(),
    total: report.total,
    duration: tr.t0 + tr.pitch.length * tr.hop,
    track: { hop: tr.hop, t0: tr.t0, pitch: tr.pitch, notes: tr.notes },
  };
  await store.saveRef(ref);
  app.reference = ref;
  return ref;
}

// ---------- ワーカー ----------
function makeWorker() {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'frames') {
      for (const fn of app.liveListeners) fn(m.frames);
    } else if (m.type === 'report' || m.type === 'error' || m.type === 'progress') {
      const p = app.pendingReports.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress && p.onProgress(m.value);
      else {
        app.pendingReports.delete(m.id);
        m.type === 'report' ? p.resolve(m.report) : p.reject(new Error(m.message));
      }
    }
  };
  w.onerror = (e) => {
    console.error(e);
    toast('解析エンジンの読み込みに失敗しました');
  };
  return w;
}
app.worker = makeWorker();

let reqId = 0;
export function requestReport(msg, onProgress) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    app.pendingReports.set(id, { resolve, reject, onProgress });
    if (msg.data) app.worker.postMessage({ ...msg, id }, [msg.data.buffer]);
    else app.worker.postMessage({ ...msg, id });
  });
}

/** マイクを開いてワーカーのライブ解析につなぐ */
export async function startLive() {
  const eng = app.engine;
  await eng.openMic();
  app.worker.postMessage({ type: 'start', sampleRate: eng.sampleRate });
  eng.onChunk = (data) => app.worker.postMessage({ type: 'chunk', data });
}

export function stopLive() {
  app.engine.onChunk = null;
  app.engine.closeMic();
}

// ---------- 録音 → 解析 → 保存 ----------
export async function finishRecording() {
  const eng = app.engine;
  const { pcm, sampleRate } = eng.stopRecording();
  eng.stopAccompaniment();
  const reportP = requestReport({ type: 'finish', ref: refPayload(), synced: isSynced(), latency: eng.roundTripLatency });
  stopLive();
  navigate('#/analyzing', { silent: true });
  try {
    const report = await reportP;
    await handleNewReport(report, pcm, sampleRate, { source: 'mic' });
  } catch (e) {
    console.error(e);
    toast('解析中にエラーが発生しました');
    navigate('#/');
  }
}

export async function analyzeFile(file) {
  await app.engine.ensureContext();
  navigate('#/analyzing', { silent: true });
  try {
    const { pcm, sampleRate } = await decodeFileToMono(app.engine.ctx, file);
    const copy = pcm.slice();
    const report = await requestReport({ type: 'analyzeBuffer', data: copy, sampleRate, ref: refPayload(), synced: false }, (v) => {
      const bar = document.querySelector('.progress > i');
      if (bar) bar.style.width = `${Math.round(v * 100)}%`;
    });
    await handleNewReport(report, pcm, sampleRate, { source: 'file', fileName: file.name });
  } catch (e) {
    console.error(e);
    toast('ファイルを読み込めませんでした（形式を確認してください）');
    navigate('#/');
  }
}

async function handleNewReport(report, pcm, sampleRate, extra) {
  if (!report.enoughVoice) {
    toast('歌声がほとんど検出できませんでした。マイクの位置と音量を確認してください', 4500);
  }
  const id = `s${Date.now()}`;
  const title = app.songTitle.trim() || (extra.fileName ? extra.fileName.replace(/\.[^.]+$/, '') : '無題');
  const session = {
    id, date: Date.now(), title, report, source: extra.source, accomp: app.accompName || null,
    refName: app.reference ? app.reference.fileName : null,
  };
  const audio = packForStorage(pcm, sampleRate);
  try {
    await store.saveSession(session, audio);
  } catch (e) {
    console.warn('保存失敗', e);
    toast('履歴への保存に失敗しました（容量不足の可能性）');
  }
  app.lastAudio = { id, pcm, sampleRate };
  navigate(`#/result/${id}`);
}

/** 保存済み録音の Float32 を取得（直前の録音はメモリから） */
export async function loadAudio(id) {
  if (app.lastAudio && app.lastAudio.id === id) return { pcm: app.lastAudio.pcm, sampleRate: app.lastAudio.sampleRate };
  const a = await store.getAudio(id);
  if (!a) return null;
  return { pcm: unpackStored(a), sampleRate: a.sampleRate };
}

export async function downloadAudio(id, title) {
  const a = await store.getAudio(id);
  if (!a) return toast('録音データが残っていません');
  const blob = encodeWav(a.data, a.sampleRate);
  const file = new File([blob], `${title || 'recording'}.wav`, { type: 'audio/wav' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch {}
  }
  const url = URL.createObjectURL(blob);
  const a2 = h('a', { href: url, download: file.name });
  document.body.append(a2);
  a2.click();
  a2.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- ルーティング ----------
const routes = [
  { re: /^#?\/?$/, tab: 'sing', title: 'ききごこち', render: renderSing },
  { re: /^#\/record$/, tab: 'sing', title: '録音中', render: renderRecording, back: false },
  { re: /^#\/analyzing$/, tab: 'sing', title: '解析中', render: renderAnalyzing, back: false },
  { re: /^#\/result\/(\w+)$/, tab: 'history', title: '結果', render: renderResult, back: true },
  { re: /^#\/history$/, tab: 'history', title: '履歴', render: renderHistory },
  { re: /^#\/practice$/, tab: 'practice', title: '練習', render: renderPractice },
  { re: /^#\/guide$/, tab: 'guide', title: '使い方', render: renderGuide },
];

let navState = {};
export function navigate(hash, state = {}) {
  navState = state;
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const hash = location.hash || '#/';
  const r = routes.find((x) => x.re.test(hash)) || routes[0];
  const params = hash.match(r.re).slice(1);
  // 前の画面の後始末
  if (app.view && app.view.cleanup) {
    try {
      app.view.cleanup();
    } catch (e) {
      console.warn(e);
    }
  }
  app.view = null;
  document.body.classList.toggle('recording', hash === '#/record' || hash === '#/analyzing');
  document.getElementById('title').textContent = r.title;
  document.getElementById('backBtn').hidden = !r.back;
  for (const a of document.querySelectorAll('.tabbar a')) a.classList.toggle('active', a.dataset.tab === r.tab);
  const main = document.getElementById('view');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  const state = navState;
  navState = {};
  try {
    app.view = (await r.render(main, params, state)) || null;
  } catch (e) {
    console.error(e);
    main.append(h('div.card', h('h2', 'エラーが発生しました'), h('p.small.muted', String(e.message || e))));
  }
}

window.addEventListener('hashchange', route);
document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else navigate('#/history');
});

// iOS：バックグラウンドから戻った時にオーディオを再開
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.engine.ctx && app.engine.ctx.state !== 'running') {
    app.engine.ctx.resume().catch(() => {});
  }
});

// ---------- 起動 ----------
store.requestPersistence();
store.getKV('prefs', {}).then((p) => {
  if (p && typeof p.accompVolume === 'number') app.accompVolume = p.accompVolume;
  if (p && typeof p.refSynced === 'boolean') app.refSynced = p.refSynced;
});
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
