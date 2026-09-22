// 結果画面のタイムライン：音程カーブ・音符ごとのズレ・指摘箇所・再生位置

import { h, fitCanvas, cssVar, devColor } from './dom.js';
import { NOTE_NAMES } from '../analysis/music.js';
import { fmtTime } from '../analysis/music.js';

const EVENT_COLORS = {
  pitch: '--bad',
  wobble: '--warn',
  scoop: '--accent',
  glide: '--accent',
  fall: '--blue',
  spike: '--warn',
  strain: '--bad',
  vibrato: '--blue',
  good: '--good',
  melody: '--bad',
  timing: '--blue',
};

export class Timeline {
  constructor(report, { onSeek } = {}) {
    this.r = report;
    this.onSeek = onSeek;
    this.pps = 40; // px / 秒
    this.playhead = null;
    this.highlight = null;
    const tr = report.track;
    this.duration = tr.t0 + tr.pitch.length * tr.hop;
    const centers = tr.notes.map((n) => n.center).sort((a, b) => a - b);
    const lo = centers.length ? centers[Math.floor(centers.length * 0.02)] : 55;
    const hi = centers.length ? centers[Math.floor(centers.length * 0.98)] : 72;
    this.lo = Math.floor(lo) - 2;
    this.hi = Math.ceil(hi) + 2;
    if (this.hi - this.lo < 12) {
      const c = (this.hi + this.lo) / 2;
      this.lo = Math.floor(c - 6);
      this.hi = Math.ceil(c + 6);
    }

    this.canvas = h('canvas.tl-canvas');
    this.spacer = h('div.spacer');
    this.scroll = h('div.tl-scroll', this.spacer, this.canvas);
    this.scroll.addEventListener('scroll', () => this.draw(), { passive: true });
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const t = (this.scroll.scrollLeft + (e.clientX - rect.left)) / this.pps;
      this.onSeek && this.onSeek(Math.max(0, Math.min(this.duration, t)));
    });
    const zoom = (f) => () => {
      const mid = (this.scroll.scrollLeft + this.scroll.clientWidth / 2) / this.pps;
      this.pps = Math.max(8, Math.min(200, this.pps * f));
      this.layout();
      this.scroll.scrollLeft = mid * this.pps - this.scroll.clientWidth / 2;
      this.draw();
    };
    this.el = h(
      'div.tl-wrap',
      this.scroll,
      h(
        'div.tl-tools',
        h('button.btn.small', { onclick: zoom(0.6), 'aria-label': '縮小' }, '－'),
        h('button.btn.small', { onclick: zoom(1.6), 'aria-label': '拡大' }, '＋'),
        h('span.tiny.grow', 'タップでその位置から再生 ・ 横にスクロール')
      ),
      h(
        'div.legend',
        legend('--good', 'ぴったり(±15c)'),
        legend('--warn', 'やや外れ'),
        legend('--bad', '外れ(±28c超)'),
        legend('--accent', 'しゃくり等'),
        legend('--blue', '語尾・ビブラート・リズム'),
        report.track.guide ? h('span', h('i', { style: { background: cssVar('--blue'), opacity: 0.4 } }), 'お手本の音程') : null
      )
    );
    requestAnimationFrame(() => {
      this.layout();
      this.draw();
    });
    this._onResize = () => {
      this.layout();
      this.draw();
    };
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }

  layout() {
    const w = Math.max(this.scroll.clientWidth, Math.ceil(this.duration * this.pps) + 40);
    this.spacer.style.width = `${w}px`;
  }

  /** t 秒が見えるようにスクロール */
  reveal(t) {
    const x = t * this.pps;
    const sl = this.scroll.scrollLeft;
    const cw = this.scroll.clientWidth;
    if (x < sl + 20 || x > sl + cw - 40) this.scroll.scrollLeft = x - cw * 0.3;
  }

  setPlayhead(t) {
    this.playhead = t;
    if (t != null) this.reveal(t);
    this.draw();
  }

  setHighlight(range) {
    this.highlight = range;
    if (range) this.reveal(range[0]);
    this.draw();
  }

  draw() {
    if (!this.canvas.isConnected) return;
    const { ctx, w, h: H } = fitCanvas(this.canvas);
    const tr = this.r.track;
    const sl = this.scroll.scrollLeft;
    const t0v = sl / this.pps;
    const t1v = (sl + w) / this.pps;
    const top = 22;
    const bottom = H - 18;
    const y = (m) => bottom - ((m - this.lo) / (this.hi - this.lo)) * (bottom - top);
    const x = (t) => t * this.pps - sl;

    ctx.clearRect(0, 0, w, H);
    // グリッド
    ctx.font = '10px -apple-system, sans-serif';
    for (let m = this.lo; m <= this.hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      if ([1, 3, 6, 8, 10].includes(pc)) {
        ctx.fillStyle = 'rgba(128,128,128,0.06)';
        ctx.fillRect(0, y(m + 0.5), w, y(m - 0.5) - y(m + 0.5));
      }
      ctx.strokeStyle = cssVar('--line');
      ctx.globalAlpha = pc === 0 ? 0.8 : 0.3;
      ctx.beginPath();
      ctx.moveTo(0, y(m));
      ctx.lineTo(w, y(m));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // フレーズ
    ctx.fillStyle = cssVar('--text');
    ctx.globalAlpha = 0.04;
    for (const p of tr.phrases) {
      if (p.tEnd < t0v || p.t > t1v) continue;
      ctx.fillRect(x(p.t), top, (p.tEnd - p.t) * this.pps, bottom - top);
    }
    ctx.globalAlpha = 1;
    // ハイライト
    if (this.highlight) {
      ctx.fillStyle = cssVar('--accent');
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x(this.highlight[0]), 0, (this.highlight[1] - this.highlight[0]) * this.pps, H);
      ctx.globalAlpha = 1;
    }
    // 音符バー
    for (const n of tr.notes) {
      if (n.tEnd < t0v || n.t > t1v) continue;
      ctx.fillStyle = n.dev == null ? cssVar('--text3') : devColor(Math.abs(n.dev));
      ctx.globalAlpha = 0.35;
      const yy = y(n.center);
      roundRect(ctx, x(n.t), yy - 4, Math.max(3, (n.tEnd - n.t) * this.pps), 8, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // お手本（ガイド）
    if (tr.guide) {
      const g = tr.guide;
      ctx.strokeStyle = cssVar('--blue');
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      let gpen = false;
      const g0 = Math.max(0, Math.floor((t0v - g.t0) / g.bin) - 1);
      const g1 = Math.min(g.pitch.length - 1, Math.ceil((t1v - g.t0) / g.bin) + 1);
      for (let i = g0; i <= g1; i++) {
        const m = g.pitch[i];
        if (Number.isNaN(m)) {
          gpen = false;
          continue;
        }
        const px = x(g.t0 + i * g.bin);
        if (!gpen) ctx.moveTo(px, y(m));
        else ctx.lineTo(px, y(m));
        gpen = true;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
    // 生のピッチカーブ
    ctx.strokeStyle = cssVar('--text');
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let pen = false;
    const i0 = Math.max(0, Math.floor((t0v - tr.t0) / tr.hop) - 1);
    const i1 = Math.min(tr.pitch.length - 1, Math.ceil((t1v - tr.t0) / tr.hop) + 1);
    for (let i = i0; i <= i1; i++) {
      const m = tr.pitch[i];
      if (Number.isNaN(m)) {
        pen = false;
        continue;
      }
      const px = x(tr.t0 + i * tr.hop);
      const py = y(m);
      if (!pen) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      pen = true;
    }
    ctx.stroke();
    // 音名ラベル（左端に固定）
    ctx.fillStyle = cssVar('--text3');
    for (let m = this.lo; m <= this.hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      if ([0, 4, 7].includes(pc)) ctx.fillText(NOTE_NAMES[pc] + (Math.floor(m / 12) - 1), 4, y(m) - 2);
    }
    // イベント
    for (const e of this.r.events) {
      if (e.tEnd < t0v || e.t > t1v) continue;
      ctx.fillStyle = cssVar(EVENT_COLORS[e.type] || '--text2');
      const ex = x(e.t);
      ctx.beginPath();
      ctx.moveTo(ex, 16);
      ctx.lineTo(ex - 5, 6);
      ctx.lineTo(ex + 5, 6);
      ctx.closePath();
      ctx.fill();
    }
    // 時間軸
    ctx.fillStyle = cssVar('--text3');
    const step = this.pps > 60 ? 5 : this.pps > 20 ? 10 : 30;
    for (let t = Math.ceil(t0v / step) * step; t <= t1v; t += step) {
      ctx.fillText(fmtTime(t), x(t) + 2, H - 4);
      ctx.fillRect(x(t), H - 16, 1, 5);
    }
    // 再生位置
    if (this.playhead != null) {
      ctx.fillStyle = cssVar('--accent');
      ctx.fillRect(x(this.playhead) - 1, 0, 2, H);
    }
  }
}

function legend(color, label) {
  return h('span', h('i', { style: { background: cssVar(color) } }), label);
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
