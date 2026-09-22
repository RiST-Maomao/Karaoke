// 小さな統計ユーティリティ

export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

export function wmean(vals, ws) {
  let s = 0, w = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i] * ws[i];
    w += ws[i];
  }
  return w > 0 ? s / w : NaN;
}

export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

export function percentile(a, p) {
  if (!a.length) return NaN;
  const b = Array.from(a).sort((x, y) => x - y);
  const idx = (b.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return b[lo] + (b[hi] - b[lo]) * (idx - lo);
}

export const median = (a) => percentile(a, 0.5);

/** 区分線形マッピング（端はクランプ）。pts は x 昇順 [[x, y], ...] */
export function pl(x, pts) {
  if (!Number.isFinite(x)) return NaN;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** 中心移動平均（端は窓を縮める） */
export function movingAverage(a, win) {
  const n = a.length;
  const out = new Float64Array(n);
  const h = Math.floor(win / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - h);
    const hi = Math.min(n, i + h + 1);
    out[i] = (cs[hi] - cs[lo]) / (hi - lo);
  }
  return out;
}

/** 線形回帰の傾き（x = インデックス） */
export function slope(a) {
  const n = a.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(a);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (a[i] - my);
    den += (i - mx) ** 2;
  }
  return num / den;
}

/** 線形トレンド除去後の標準偏差 */
export function detrendedStd(a) {
  const n = a.length;
  if (n < 3) return 0;
  const b = slope(a);
  const my = mean(a);
  const mx = (n - 1) / 2;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - (my + b * (i - mx))) ** 2;
  return Math.sqrt(s / (n - 2));
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
