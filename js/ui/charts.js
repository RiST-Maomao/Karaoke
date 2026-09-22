// レーダーチャートと推移グラフ

import { fitCanvas, cssVar } from './dom.js';

/** categories: [{short, score}], compare: 前回の同じ配列（任意） */
export function drawRadar(canvas, categories, compare = null) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  drawRadarOn(ctx, w / 2, h / 2 + 4, Math.min(w, h) / 2 - 34, categories, {
    text: cssVar('--text'),
    sub: cssVar('--text2'),
    line: cssVar('--line'),
    accent: cssVar('--accent'),
    muted: cssVar('--text3'),
  }, compare);
}

/** 任意のコンテキストにレーダーを描く（シェア画像でも使用） */
export function drawRadarOn(ctx, cx, cy, R, categories, colors, compare = null) {
  const n = categories.length;
  const fs = colors.fontScale || 1;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, v) => [cx + Math.cos(ang(i)) * R * (v / 100), cy + Math.sin(ang(i)) * R * (v / 100)];

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = fs;
  for (const lv of [25, 50, 75, 100]) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pt(i % n, lv);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, 100);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  const poly = (vals, fill, stroke, dash) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const v = vals[i % n] ?? 0;
      const [x, y] = pt(i % n, Math.max(0, v));
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.setLineDash(dash || []);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2 * fs;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (compare) {
    const byId = Object.fromEntries(compare.map((c) => [c.id, c.score]));
    poly(categories.map((c) => byId[c.id] ?? 0), null, colors.muted || colors.sub, [4 * fs, 4 * fs]);
  }
  poly(categories.map((c) => c.score ?? 0), hexA(colors.accent, 0.25), colors.accent);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const x = cx + Math.cos(ang(i)) * (R + 20 * fs);
    const y = cy + Math.sin(ang(i)) * (R + 18 * fs);
    ctx.fillStyle = colors.sub;
    ctx.font = `600 ${12 * fs}px -apple-system, sans-serif`;
    ctx.fillText(categories[i].short, x, y - 6 * fs);
    ctx.fillStyle = colors.text;
    ctx.font = `700 ${12 * fs}px -apple-system, sans-serif`;
    ctx.fillText(categories[i].score == null ? '-' : Math.round(categories[i].score), x, y + 8 * fs);
  }
  ctx.textBaseline = 'alphabetic';
}

/** points: [{x: 番号, y: 値, label}] */
export function drawLineChart(canvas, points, { min = null, max = null, color = null } = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (!pts.length) {
    ctx.fillStyle = cssVar('--text3');
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('データがまだありません', w / 2, h / 2);
    return;
  }
  const ys = pts.map((p) => p.y);
  let lo = min ?? Math.floor(Math.min(...ys) / 5) * 5 - 5;
  let hi = max ?? Math.ceil(Math.max(...ys) / 5) * 5 + 5;
  lo = Math.max(0, lo);
  hi = Math.min(100, Math.max(hi, lo + 10));
  const L = 30, Rm = 10, T = 10, B = 22;
  const X = (i) => L + (pts.length === 1 ? (w - L - Rm) / 2 : (i * (w - L - Rm)) / (pts.length - 1));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);

  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillStyle = cssVar('--text3');
  ctx.strokeStyle = cssVar('--line');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const step = hi - lo > 40 ? 20 : hi - lo > 20 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ctx.beginPath();
    ctx.moveTo(L, Y(v));
    ctx.lineTo(w - Rm, Y(v));
    ctx.stroke();
    ctx.fillText(v, L - 5, Y(v));
  }
  const c = color || cssVar('--accent');
  // 移動平均（直近 5 回）
  if (pts.length >= 4) {
    ctx.strokeStyle = cssVar('--text3');
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const win = pts.slice(Math.max(0, i - 4), i + 1);
      const avg = win.reduce((s, q) => s + q.y, 0) / win.length;
      i ? ctx.lineTo(X(i), Y(avg)) : ctx.moveTo(X(i), Y(avg));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.y)) : ctx.moveTo(X(i), Y(p.y))));
  ctx.stroke();
  ctx.fillStyle = c;
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(X(i), Y(p.y), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = cssVar('--text3');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const every = Math.ceil(pts.length / 6);
  pts.forEach((p, i) => {
    if (i % every === 0 || i === pts.length - 1) ctx.fillText(p.label || '', X(i), h - 6);
  });
}

function hexA(color, a) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
