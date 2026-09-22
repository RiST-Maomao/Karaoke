// お手本（プロのボーカル音源など）との比較
// 2 つの音程トラックを DTW で対応づけ、メロディの正しさと（同期時は）リズムのズレを測る。
// キー違い（男性が女性曲を 1 オクターブ下で歌う等）は移調量を推定して吸収する。

import { median, percentile, pl, std, mean } from './stats.js';

const BIN = 0.05; // 50ms

/** 音程トラックを 50ms ビンに（有声率 40% 未満は NaN） */
export function binTrack(track) {
  const per = Math.max(1, Math.round(BIN / track.hop));
  const n = Math.floor(track.pitch.length / per);
  const out = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    const v = [];
    for (let i = b * per; i < (b + 1) * per; i++) {
      const p = track.pitch[i];
      if (!Number.isNaN(p)) v.push(p);
    }
    out[b] = v.length >= per * 0.4 ? median(v) : NaN;
  }
  return { bins: out, t0: track.t0 + (per * track.hop) / 2 };
}

function voicedValues(a) {
  const v = [];
  for (const x of a) if (!Number.isNaN(x)) v.push(x);
  return v;
}

/** DTW（帯域制約つき）。cost(i,j) を最小化する経路を返す */
function dtw(U, R, shift, band, slope) {
  const n = U.length, m = R.length;
  const INF = 1e18;
  const W = 2 * band + 1;
  // D は [i][j - lo(i)] の帯域行列
  const lo = (i) => Math.max(0, Math.round(i * slope) - band);
  const D = new Float32Array(n * W).fill(INF);
  const P = new Int8Array(n * W); // 0: 対角, 1: 上(i-1), 2: 左(j-1)
  const cost = (i, j) => {
    const u = U[i], r = R[j];
    const uv = !Number.isNaN(u), rv = !Number.isNaN(r);
    if (!uv && !rv) return 0;
    if (uv !== rv) return 0.6;
    return Math.min(Math.abs(u - r - shift), 3) / 3;
  };
  const idx = (i, j) => {
    const k = j - lo(i);
    return k >= 0 && k < W ? i * W + k : -1;
  };
  for (let i = 0; i < n; i++) {
    const l = lo(i);
    for (let k = 0; k < W; k++) {
      const j = l + k;
      if (j >= m) break;
      const c = cost(i, j);
      if (i === 0 && j === 0) {
        D[i * W + k] = c;
        continue;
      }
      let best = INF, dir = 0;
      const a = i > 0 && j > 0 ? idx(i - 1, j - 1) : -1;
      if (a >= 0 && D[a] < best) (best = D[a]), (dir = 0);
      const b = i > 0 ? idx(i - 1, j) : -1;
      if (b >= 0 && D[b] + 0.1 < best) (best = D[b] + 0.1), (dir = 1);
      const d = j > 0 ? idx(i, j - 1) : -1;
      if (d >= 0 && D[d] + 0.1 < best) (best = D[d] + 0.1), (dir = 2);
      if (best < INF) {
        D[i * W + k] = best + c;
        P[i * W + k] = dir;
      }
    }
  }
  // 終点：最後の行で最小
  let endJ = -1, endCost = INF;
  for (let k = 0; k < W; k++) {
    const j = lo(n - 1) + k;
    if (j >= m) break;
    if (D[(n - 1) * W + k] < endCost) (endCost = D[(n - 1) * W + k]), (endJ = j);
  }
  if (endJ < 0) return null;
  const path = new Int32Array(n).fill(-1); // user i → ref j
  let i = n - 1, j = endJ;
  while (i >= 0 && j >= 0) {
    if (path[i] < 0) path[i] = j;
    const k = idx(i, j);
    if (k < 0) break;
    const dir = P[k];
    if (i === 0 && j === 0) break;
    if (dir === 0) (i--, j--);
    else if (dir === 1) i--;
    else j--;
  }
  return { path, cost: endCost / n };
}

/**
 * user, ref: { hop, t0, pitch } と user の音符（track.notes）
 * synced: 伴奏（原曲）と同じ時間軸で歌ったかどうか
 */
export function compareToReference(userTrack, refTrack, { synced = false, latency = 0 } = {}) {
  const u = binTrack(userTrack);
  const r = binTrack(refTrack);
  const U = u.bins, R = r.bins;
  const uv = voicedValues(U), rv = voicedValues(R);
  if (uv.length < 40 || rv.length < 40) return { available: false, reason: 'short' };

  // 移調量の候補：中央値の差の近傍と ±1 オクターブ
  const d0 = Math.round(median(uv) - median(rv));
  const cands = new Set();
  for (const base of [d0, d0 - 12, d0 + 12, 0, -12, 12]) for (const k of [-1, 0, 1]) if (Math.abs(base + k) <= 14) cands.add(base + k);

  const slope = synced ? 1 : (R.length - 1) / Math.max(1, U.length - 1);
  const band = synced ? 20 : Math.max(60, Math.round(Math.max(U.length, R.length) * 0.15));
  // 候補の粗選別：同期時は時間そのまま、非同期時は分布の一致度で
  const quick = (s) => {
    if (synced) {
      let c = 0, k = 0;
      for (let i = 0; i < Math.min(U.length, R.length); i++) {
        if (Number.isNaN(U[i]) || Number.isNaN(R[i])) continue;
        c += Math.min(Math.abs(U[i] - R[i] - s), 3);
        k++;
      }
      return k ? c / k : 9;
    }
    // ピッチクラスではなく実音の分布差（四分位）
    return Math.abs(percentile(uv, 0.25) - percentile(rv, 0.25) - s) + Math.abs(percentile(uv, 0.75) - percentile(rv, 0.75) - s);
  };
  const ranked = [...cands].sort((a, b) => quick(a) - quick(b)).slice(0, 3);
  let best = null;
  for (const s of ranked) {
    const res = dtw(U, R, s, band, slope);
    if (res && (!best || res.cost < best.cost)) best = { ...res, shift: s };
  }
  if (!best) return { available: false, reason: 'align' };
  const { path, shift } = best;

  // ---- メロディ一致率 ----
  let match = 0, total = 0;
  const diffs = new Float64Array(U.length).fill(NaN);
  for (let i = 0; i < U.length; i++) {
    const j = path[i];
    if (j < 0 || Number.isNaN(U[i]) || Number.isNaN(R[j])) continue;
    let d = U[i] - R[j] - shift;
    d -= 12 * Math.round(d / 12); // 声区の切り替え等によるオクターブ違いは同じ音とみなす
    diffs[i] = d;
    total++;
    if (Math.abs(d) < 0.5) match++;
  }
  const melodyMatch = total ? match / total : NaN;

  // ---- 音符ごとの判定（メロディ違い・タイミング） ----
  const binOf = (t) => Math.round((t - u.t0) / BIN);
  const wrong = [];
  const lags = [];
  for (const nt of userTrack.notes) {
    if (nt.dur < 0.15) continue;
    const b0 = Math.max(0, binOf(nt.t)), b1 = Math.min(U.length - 1, binOf(nt.tEnd));
    const ds = [];
    const offs = [];
    for (let b = b0; b <= b1; b++) {
      if (!Number.isNaN(diffs[b])) ds.push(diffs[b]);
      if (path[b] >= 0) offs.push(path[b] - b);
    }
    if (ds.length >= 3) {
      const md = median(ds);
      if (Math.abs(md) >= 0.75) wrong.push({ t: nt.t, tEnd: nt.tEnd, semis: md });
    }
    // 音の出だしのタイミング（お手本の対応点との差）
    if (synced && path[b0] >= 0) {
      // お手本側で同じ高さの音が始まる位置を、対応点の近く（±0.4 秒）で探す
      const j0 = path[b0];
      let bestJ = -1, bestD = 9;
      for (let j = Math.max(1, j0 - 8); j <= Math.min(R.length - 1, j0 + 8); j++) {
        if (Number.isNaN(R[j])) continue;
        const onset = Number.isNaN(R[j - 1]) || Math.abs(R[j] - R[j - 1]) > 0.7;
        if (!onset) continue;
        const d = Math.abs(nt.center - shift - R[j]);
        if (d < 0.6 && Math.abs(j - j0) < bestD) (bestD = Math.abs(j - j0)), (bestJ = j);
      }
      if (bestJ >= 0) {
        const refT = r.t0 + bestJ * BIN;
        lags.push({ t: nt.t, lag: nt.t - refT - latency }); // 機器の遅れぶんを差し引く
      }
    }
  }

  // カバー率：お手本が歌っている箇所のうち、あなたも声を出していた割合
  let refVoiced = 0, both = 0;
  const inv = new Int32Array(R.length).fill(-1);
  for (let i = 0; i < U.length; i++) if (path[i] >= 0) inv[path[i]] = i;
  for (let j = 0; j < R.length; j++) {
    if (Number.isNaN(R[j])) continue;
    refVoiced++;
    const i = inv[j];
    if (i >= 0 && !Number.isNaN(U[i])) both++;
  }
  const coverage = refVoiced ? both / refVoiced : NaN;

  let timing = null;
  if (synced && lags.length >= 8) {
    const L = lags.map((x) => x.lag);
    const med = median(L);
    const spread = std(L.map((x) => x - med));
    timing = {
      medianLag: med, // + ならお手本より遅い（もたる）
      spread,
      lateRatio: L.filter((x) => x > 0.12).length / L.length,
      earlyRatio: L.filter((x) => x < -0.12).length / L.length,
      samples: lags.length,
      worst: lags.filter((x) => Math.abs(x.lag - med) > 0.15).sort((a, b) => Math.abs(b.lag - med) - Math.abs(a.lag - med)).slice(0, 6),
    };
  }

  const melodyScore = pl(melodyMatch, [[0.45, 35], [0.6, 55], [0.72, 72], [0.82, 86], [0.9, 96], [0.94, 100]]);
  const rhythmScore = timing
    ? pl(Math.abs(timing.medianLag), [[0.04, 100], [0.08, 94], [0.13, 80], [0.2, 62], [0.3, 45]]) * 0.4 +
      pl(timing.spread, [[0.04, 100], [0.07, 92], [0.11, 78], [0.16, 62], [0.25, 42]]) * 0.6
    : NaN;
  const coverageFactor = pl(coverage, [[0.5, 0.85], [0.8, 0.97], [0.9, 1]]);
  const score = Number.isFinite(rhythmScore) ? (melodyScore * 0.65 + rhythmScore * 0.35) * coverageFactor : melodyScore * coverageFactor;

  return {
    available: true,
    synced,
    shift,
    melodyMatch,
    coverage,
    wrong,
    wrongRatio: userTrack.notes.length ? wrong.length / userTrack.notes.filter((x) => x.dur >= 0.15).length : 0,
    timing,
    melodyScore,
    rhythmScore,
    score,
    alignCost: best.cost,
    // タイムライン用：お手本の音程を、あなたの時間軸に写したもの（移調後）
    guide: Array.from(U, (_, i) => (path[i] >= 0 && !Number.isNaN(R[path[i]]) ? R[path[i]] + shift : NaN)),
    guideT0: u.t0,
    guideBin: BIN,
  };
}

export function shiftLabel(shift) {
  if (!shift) return '原曲キー';
  const oct = Math.round(shift / 12);
  const rest = shift - oct * 12;
  const parts = [];
  if (oct) parts.push(`${Math.abs(oct)} オクターブ${oct < 0 ? '下' : '上'}`);
  if (rest) parts.push(`${rest > 0 ? '+' : ''}${rest} キー`);
  return parts.join(' ');
}

export { mean };
