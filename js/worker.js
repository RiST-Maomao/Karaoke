// 解析ワーカー：録音中のストリーミング解析と、ファイル解析を担当
import { FrameAnalyzer } from './dsp/frameAnalyzer.js';
import { buildReport } from './analysis/report.js';

let fa = null;
let pending = [];
let lastPost = 0;

function flushLive(force = false) {
  const now = performance.now();
  if (!pending.length || (!force && now - lastPost < 30)) return;
  postMessage({ type: 'frames', frames: pending });
  pending = [];
  lastPost = now;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'start':
        fa = new FrameAnalyzer(msg.sampleRate);
        pending = [];
        break;
      case 'chunk': {
        if (!fa) return;
        const frames = fa.push(msg.data);
        for (const f of frames) pending.push({ t: f.t, f0: f.f0, c: f.clarity, db: f.db });
        flushLive();
        break;
      }
      case 'finish': {
        flushLive(true);
        if (!fa) return;
        const report = buildReport(fa.result(), msg.ref, msg.synced, msg.latency || 0);
        postMessage({ type: 'report', id: msg.id, report });
        fa = null;
        break;
      }
      case 'analyzeBuffer': {
        const a = new FrameAnalyzer(msg.sampleRate);
        const data = msg.data;
        const step = msg.sampleRate * 2;
        for (let i = 0; i < data.length; i += step) {
          a.push(data.subarray(i, Math.min(data.length, i + step)));
          postMessage({ type: 'progress', id: msg.id, value: Math.min(1, (i + step) / data.length) });
        }
        const report = buildReport(a.result(), msg.ref, msg.synced);
        postMessage({ type: 'report', id: msg.id, report });
        break;
      }
    }
  } catch (e) {
    postMessage({ type: 'error', id: msg.id, message: String(e && e.stack ? e.stack : e) });
  }
};
