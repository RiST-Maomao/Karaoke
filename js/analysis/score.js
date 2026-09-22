// 計測値 → カテゴリ別スコア → 総合点
// しきい値はすべてここに集約（実際の歌声データで調整しやすいように）。
// 方針：「誰が聞いても上手い」プロの歌唱が 95〜100 に入り、
//       機械的な正確さより“耳障りな要素がないこと”と“自然な表現”を重視する。

import { pl, clamp } from './stats.js';

export const CATEGORIES = [
  { id: 'pitch', name: '音程の正確さ', short: '音程', weight: 28 },
  { id: 'stability', name: '声の安定感', short: '安定', weight: 14 },
  { id: 'tone', name: '声の響き・質', short: '声質', weight: 14 },
  { id: 'onset', name: '音の入り・つなぎ', short: '入り', weight: 11 },
  { id: 'dynamics', name: '抑揚・音量コントロール', short: '抑揚', weight: 11 },
  { id: 'phrase', name: 'フレーズの終わり方', short: '語尾', weight: 8 },
  { id: 'vibrato', name: 'ビブラート・余韻', short: 'ビブ', weight: 8 },
  { id: 'high', name: '高音の余裕', short: '高音', weight: 6 },
  // お手本があるときだけ評価
  { id: 'melody', name: 'メロディ・リズム（お手本比較）', short: 'お手本', weight: 24 },
];

export const CALIB = {
  // 音符ごとの半音グリッドからの平均ズレ（cents）。実録音のプロで 8〜15 程度、でたらめな音程だと 25 前後
  meanAbsDev: [[8, 100], [11, 97], [14, 90], [17, 80], [20, 69], [23, 59], [27, 47], [32, 36]],
  hitRate: [[0.4, 40], [0.55, 60], [0.7, 80], [0.82, 94], [0.9, 100]],
  inScale: [[0.6, 35], [0.72, 55], [0.82, 75], [0.9, 92], [0.95, 100]],
  drift: [[25, 100], [50, 92], [80, 78], [120, 60]], // 曲全体の音程のずれ込み（cents）
  // ロングトーンの不安定さ（cents, ビブラート除去後）
  instability: [[4, 100], [7, 94], [10, 82], [13, 70], [17, 56], [22, 42], [30, 30]],
  hfJitter: [[3, 100], [5, 94], [7, 82], [10, 62], [14, 42]],
  loudWobble: [[0.6, 100], [1.0, 94], [1.6, 80], [2.4, 62], [3.5, 45]],
  // 声質：HNR（dB）
  hnr: [[3, 38], [5, 52], [7, 66], [9, 80], [11, 91], [13, 97], [15, 100]],
  // 響き（2–4kHz 帯と 0–2kHz 帯の差 dB）の許容帯。マイク依存が大きいので緩め
  ring: [[-34, 55], [-28, 72], [-22, 92], [-19, 100], [-6, 100], [-2, 88], [3, 70]],
  hf: [[-40, 100], [-28, 100], [-22, 88], [-16, 70]],
  // 入り：しゃくりの割合
  scoopRatio: [[0.05, 100], [0.15, 90], [0.3, 72], [0.5, 52], [0.7, 38]],
  onsetMed: [[0.04, 100], [0.07, 95], [0.1, 84], [0.15, 66], [0.22, 48]],
  slowGlideRatio: [[0.05, 100], [0.15, 88], [0.3, 68], [0.5, 50]],
  overshootRatio: [[0.05, 100], [0.15, 90], [0.3, 72], [0.5, 55]],
  // 抑揚：フレーズ間の音量差（dB 標準偏差）。小さすぎ＝一本調子、大きすぎ＝ムラ
  phraseLevelStd: [[0.5, 60], [1.0, 72], [1.8, 90], [2.5, 100], [5, 100], [7, 88], [10, 68]],
  phraseRangeMed: [[2, 62], [3.5, 80], [5, 95], [6, 100], [12, 100], [16, 85], [22, 65]],
  spikeRate: [[0.5, 100], [2, 92], [4, 78], [7, 60], [12, 42]], // 1 分あたり
  // 語尾
  fallRatio: [[0.08, 100], [0.18, 90], [0.3, 76], [0.45, 60], [0.65, 42]],
  // 高音
  hnrDrop: [[1, 100], [3, 90], [5, 76], [8, 58]],
  highFlat: [[-35, 50], [-22, 70], [-12, 88], [-5, 100]],
  loudJump: [[4, 100], [7, 90], [10, 75], [14, 58]],
};

function avgDefined(parts) {
  let s = 0, w = 0;
  for (const [v, wt] of parts) {
    if (Number.isFinite(v)) {
      s += v * wt;
      w += wt;
    }
  }
  return w > 0 ? s / w : NaN;
}

export function scoreMetrics(m) {
  const C = CALIB;
  const sub = {};
  // 歌声がほとんど無いときは採点しない
  if (m.voicedSec < 4 || m.counts.tuned < 5) {
    return {
      total: 0,
      insufficient: true,
      reliability: 0,
      categories: CATEGORIES.filter((c) => c.id !== 'melody').map((c) => ({ ...c, score: null })),
    };
  }

  // 音程
  sub.pitch = avgDefined([
    [pl(m.pitch.meanAbsDev, C.meanAbsDev), 0.55],
    [pl(m.pitch.hitRate, C.hitRate), 0.15],
    [pl(m.key.inScale, C.inScale), 0.2],
    [pl(m.pitch.drift?.range, C.drift), 0.1],
  ]);

  // 安定感
  sub.stability = avgDefined([
    [pl(m.stability.pitchInstability, C.instability), 0.6],
    [pl(m.stability.hfJitter, C.hfJitter), 0.2],
    [pl(m.stability.loudWobble, C.loudWobble), 0.2],
  ]);

  // 声質
  sub.tone = avgDefined([
    [pl(m.tone.hnr, C.hnr), 0.65],
    [pl(m.tone.ring, C.ring), 0.25],
    [pl(m.tone.hf, C.hf), 0.1],
  ]);

  // 入り・つなぎ
  sub.onset = avgDefined([
    [pl(m.onset.scoopRatio, C.scoopRatio), 0.4],
    [pl(m.onset.median, C.onsetMed), 0.25],
    [m.onset.bigTrans >= 4 ? pl(m.onset.slowGlideRatio, C.slowGlideRatio) : NaN, 0.2],
    [m.onset.bigTrans >= 4 ? pl(m.onset.overshootRatio, C.overshootRatio) : NaN, 0.15],
  ]);

  // 抑揚
  sub.dynamics = avgDefined([
    [pl(m.dynamics.phraseLevelStd, C.phraseLevelStd), 0.3],
    [pl(m.dynamics.phraseRangeMed, C.phraseRangeMed), 0.35],
    [pl(m.dynamics.spikeRate, C.spikeRate), 0.35],
  ]);

  // 語尾
  sub.phrase = m.endings.count >= 3 ? pl(m.endings.fallRatio, C.fallRatio) : NaN;

  // ビブラート：無いこと自体は減点しすぎない（ストレートも表現）。質が悪いと減点
  sub.vibrato = scoreVibrato(m.vibrato);

  // 高音
  if (m.high.available) {
    sub.high = avgDefined([
      [pl(m.high.hnrDrop, C.hnrDrop), 0.35],
      [pl(m.high.signedDevHigh, C.highFlat), 0.35],
      [pl(m.high.loudJump, C.loudJump), 0.3],
    ]);
  } else sub.high = NaN;

  // お手本比較
  sub.melody = m.reference && m.reference.available ? m.reference.score : NaN;

  // 総合：重み付きのべき平均（p = -2）。
  // 苦手な項目が 1 つでもあると聞き心地は大きく損なわれるので、低い項目ほど強く効く。
  let ws = 0, acc = 0;
  for (const c of CATEGORIES) {
    const v = sub[c.id];
    if (!Number.isFinite(v)) continue;
    ws += c.weight;
    acc += c.weight * Math.pow(Math.max(v, 5), -2);
  }
  let total = ws > 0 ? Math.pow(acc / ws, -1 / 2) : 0;

  // 信頼度：歌唱量が少ないと評価が不安定
  const reliability = clamp(Math.min(m.voicedSec / 25, m.counts.tuned / 25), 0, 1);
  total = clamp(total, 0, 100);

  const categories = CATEGORIES.filter((c) => c.id !== 'melody' || Number.isFinite(sub.melody)).map((c) => ({
    ...c,
    score: Number.isFinite(sub[c.id]) ? Math.round(sub[c.id] * 10) / 10 : null,
  }));
  return { total: Math.round(total * 1000) / 1000, categories, reliability, insufficient: false };
}

function scoreVibrato(v) {
  if (v.candidates < 2) return NaN;
  if (v.count === 0) return 78; // ビブラートなし：中立
  const rate = pl(v.rate, [[3.5, 30], [4.0, 50], [4.5, 75], [5.0, 94], [5.4, 100], [6.6, 100], [7.2, 88], [8, 62], [9, 42]]);
  const ext = pl(v.extent, [[8, 60], [15, 80], [22, 96], [28, 100], [70, 100], [90, 85], [120, 60], [160, 40]]);
  const reg = pl(v.regularity, [[0.35, 70], [0.5, 82], [0.65, 95], [0.75, 100]]);
  // 速さ・深さのどちらかが外れると一気に不自然に聞こえるので掛け算
  const quality = ((rate * ext) / 100) * (0.75 + (0.25 * reg) / 100);
  // 使う割合：ロングトーンの 25〜80% くらいが自然
  const usage = pl(v.ratio, [[0, 78], [0.15, 88], [0.3, 100], [0.85, 100], [1, 95]]);
  return quality * 0.75 + usage * 0.25;
}

/** 点数帯のラベル */
export function scoreLabel(total) {
  if (total >= 97) return { rank: 'SS', text: 'プロ級の聞き心地' };
  if (total >= 93) return { rank: 'S', text: '聴き惚れるレベル' };
  if (total >= 88) return { rank: 'A+', text: 'かなり上手い' };
  if (total >= 83) return { rank: 'A', text: '上手い！' };
  if (total >= 77) return { rank: 'B+', text: '安心して聴ける' };
  if (total >= 70) return { rank: 'B', text: '良い土台がある' };
  if (total >= 60) return { rank: 'C', text: '伸びしろたっぷり' };
  return { rank: 'D', text: 'ここから伸ばそう' };
}
