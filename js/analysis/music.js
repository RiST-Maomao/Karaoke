// 音名・調まわりのユーティリティ

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_NAMES_JA = ['ハ', '嬰ハ', 'ニ', '変ホ', 'ホ', 'ヘ', '嬰ヘ', 'ト', '変イ', 'イ', '変ロ', 'ロ'];

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** 国際式 (C4 = 中央ド) */
export function midiName(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

/** カラオケ界隈の表記（mid2C = C4, hiC = C5） */
export function midiNameJa(m) {
  const r = Math.round(m);
  const oct = Math.floor(r / 12) - 1;
  const name = NOTE_NAMES[((r % 12) + 12) % 12];
  const prefix = { 0: 'lowlowlow', 1: 'lowlow', 2: 'low', 3: 'mid1', 4: 'mid2', 5: 'hi', 6: 'hihi', 7: 'hihihi' }[oct] ?? `oct${oct}`;
  return prefix + name;
}

// Krumhansl-Kessler の調性プロファイル
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * ピッチクラスヒストグラム（長さ 12）から調を推定。
 * 戻り値: { tonic, mode, name, inScale（ダイアトニック内の割合） }
 */
export function estimateKey(hist) {
  let best = { r: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = (p) => hist.map((_, i) => hist[(i + t) % 12]);
    const h = rot();
    const rM = corr(h, MAJOR);
    const rm = corr(h, MINOR);
    if (rM > best.r) best = { r: rM, tonic: t, mode: 'major' };
    if (rm > best.r) best = { r: rm, tonic: t, mode: 'minor' };
  }
  // ダイアトニック集合（短調は平行長調と同じ集合）
  const rel = best.mode === 'major' ? best.tonic : (best.tonic + 3) % 12;
  const set = new Set(MAJOR_SCALE.map((d) => (rel + d) % 12));
  let tot = 0, inS = 0;
  for (let i = 0; i < 12; i++) {
    tot += hist[i];
    if (set.has(i)) inS += hist[i];
  }
  const name = `${NOTE_NAMES[best.tonic]}${best.mode === 'major' ? '' : 'm'}（${KEY_NAMES_JA[best.tonic]}${best.mode === 'major' ? '長調' : '短調'}）`;
  return { tonic: best.tonic, mode: best.mode, name, r: best.r, inScale: tot > 0 ? inS / tot : 1, scaleSet: set };
}

/** 秒 → m:ss */
export function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
