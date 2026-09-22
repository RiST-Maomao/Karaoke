// 録音中のリアルタイム音程表示（ピアノロール風）

import { fitCanvas, cssVar, devColor } from './dom.js';
import { hzToMidi, NOTE_NAMES } from '../analysis/music.js';

const SPAN = 7; // 表示秒数

export class PitchRoll {
  constructor(canvas) {
    this.canvas = canvas;
    this.frames = []; // {t, m, db}
    this.center = 60;
    this.running = false;
    this.latest = null;
  }

  push(frames) {
    for (const f of frames) {
      const voiced = f.f0 > 0 && f.c >= 0.6 && f.db > -55;
      const m = voiced ? hzToMidi(f.f0) : NaN;
      this.frames.push({ t: f.t, m, db: f.db });
      this.latest = { t: f.t, m, db: f.db };
    }
    const cut = this.latest ? this.latest.t - SPAN - 1 : 0;
    let k = 0;
    while (k < this.frames.length && this.frames[k].t < cut) k++;
    if (k > 0) this.frames.splice(0, k);
  }

  reset() {
    this.frames = [];
    this.latest = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const bg = cssVar('--card');
    const line = cssVar('--line');
    const text3 = cssVar('--text3');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 直近の有声フレームで表示中心を追従（ゆっくり）
    const recent = this.frames.filter((f) => !Number.isNaN(f.m)).slice(-120);
    if (recent.length) {
      const ms = recent.map((f) => f.m).sort((a, b) => a - b);
      const med = ms[ms.length >> 1];
      this.center += (med - this.center) * 0.05;
    }
    const range = 16; // 表示半音数
    const lo = this.center - range / 2;
    const y = (m) => h - ((m - lo) / range) * h;

    // 半音グリッド
    ctx.font = '10px -apple-system, sans-serif';
    for (let m = Math.ceil(lo); m <= lo + range; m++) {
      const pc = ((m % 12) + 12) % 12;
      const black = [1, 3, 6, 8, 10].includes(pc);
      if (black) {
        ctx.fillStyle = 'rgba(128,128,128,0.06)';
        ctx.fillRect(0, y(m + 0.5), w, h / range);
      }
      ctx.strokeStyle = line;
      ctx.globalAlpha = pc === 0 ? 0.9 : 0.35;
      ctx.beginPath();
      ctx.moveTo(0, y(m));
      ctx.lineTo(w, y(m));
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (!black) {
        ctx.fillStyle = text3;
        ctx.fillText(NOTE_NAMES[pc] + (pc === 0 ? Math.floor(m / 12) - 1 : ''), 4, y(m) - 2);
      }
    }

    if (!this.latest) return;
    const tNow = this.latest.t;
    const x = (t) => w - 30 - ((tNow - t) / SPAN) * (w - 40);

    // 音量（下部の帯）
    ctx.fillStyle = cssVar('--accent');
    ctx.globalAlpha = 0.18;
    for (const f of this.frames) {
      const v = Math.max(0, (f.db + 60) / 60);
      ctx.fillRect(x(f.t), h - v * 28, 2, v * 28);
    }
    ctx.globalAlpha = 1;

    // 音程の軌跡
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    let prev = null;
    for (const f of this.frames) {
      if (Number.isNaN(f.m)) {
        prev = null;
        continue;
      }
      const dev = Math.abs(f.m - Math.round(f.m)) * 100;
      if (prev) {
        ctx.strokeStyle = devColor(dev);
        ctx.beginPath();
        ctx.moveTo(x(prev.t), y(prev.m));
        ctx.lineTo(x(f.t), y(f.m));
        ctx.stroke();
      }
      prev = f;
    }
    // 現在位置
    if (!Number.isNaN(this.latest.m)) {
      ctx.fillStyle = cssVar('--text');
      ctx.beginPath();
      ctx.arc(x(tNow), y(this.latest.m), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
