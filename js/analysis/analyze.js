// フレーム特徴量 → 音符・フレーズ構造 → 各種計測値
// 伴奏・お手本なしで「聞き心地」に関わる要素を測る。
//   - 音程: 歌い手自身の基準（局所的な調律オフセット）に対する半音グリッドからのズレ
//   - 調性: 推定キーのスケール内に収まっているか
//   - 安定: ロングトーンの揺れ・ドリフト
//   - 入り: しゃくり・ずり上げの長さ
//   - 語尾: 音程の落ち・処理
//   - ビブラート: 速さ・深さ・規則性
//   - 声質: 明瞭度(HNR)・響き
//   - 抑揚: フレーズ間/内の音量変化、急な音量の飛び
//   - 高音: 高音域での音程・声質・力み

import { mean, wmean, std, median, percentile, movingAverage, slope, detrendedStd, pearson, clamp } from './stats.js';
import { hzToMidi, estimateKey } from './music.js';

const MIN_NOTE_FRAMES = 8; // 80ms
const BRIDGE_GAP = 6; // 60ms 以下の途切れは同じ発声とみなす
const PHRASE_GAP = 0.3; // 秒

export function analyzeFrames(fr) {
  const n = fr.n;
  const hop = fr.hop;
  const t0 = fr.t0 ?? 0;
  const tAt = (i) => t0 + i * hop;

  // ---------- 1. 有声判定 ----------
  const dbAll = Array.from(fr.db);
  const noiseFloor = percentile(dbAll, 0.1);
  const strong = [];
  for (let i = 0; i < n; i++) if (fr.f0[i] > 0 && fr.clarity[i] > 0.7) strong.push(fr.db[i]);
  const singLevel = strong.length ? percentile(strong, 0.9) : percentile(dbAll, 0.95);
  const dbThr = Math.max(noiseFloor + 8, singLevel - 35);

  const P = new Float64Array(n).fill(NaN); // MIDI ノート（小数）
  for (let i = 0; i < n; i++) {
    if (fr.f0[i] > 0 && fr.clarity[i] >= 0.5 && fr.db[i] >= dbThr) P[i] = hzToMidi(fr.f0[i]);
  }
  removeShortRuns(P, 5);
  fixOctaveErrors(P);
  removeOutliers(P);
  removeShortRuns(P, 5);
  median3(P);

  // ---------- 2. 発声区間（ラン）とフレーズ ----------
  // 歌声より十分小さい発声区間（イヤホンからの音漏れ・周囲の声など）は除外
  const runs = findRuns(P, BRIDGE_GAP).filter((r) => {
    const d = [];
    for (let i = r.s; i <= r.e; i++) if (!Number.isNaN(P[i])) d.push(fr.db[i]);
    const keep = median(d) >= singLevel - 26;
    if (!keep) for (let i = r.s; i <= r.e; i++) P[i] = NaN;
    return keep;
  }); // [{s, e}]  e は含む
  const bridged = Float64Array.from(P);
  for (const r of runs) interpolateGaps(bridged, r.s, r.e);

  const phrases = [];
  for (const r of runs) {
    const last = phrases[phrases.length - 1];
    if (last && (r.s - last.e) * hop < PHRASE_GAP) {
      last.e = r.e;
      last.runs.push(r);
    } else phrases.push({ s: r.s, e: r.e, runs: [r] });
  }
  const phrasesKept = phrases.filter((p) => (p.e - p.s) * hop >= 0.25);

  let voicedFrames = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(P[i])) voicedFrames++;
  const voicedSec = voicedFrames * hop;

  // ---------- 3. 音符分割 ----------
  const notes = [];
  for (const r of runs) {
    const seg = bridged.subarray(r.s, r.e + 1);
    for (const core of segmentNotes(seg)) {
      const s = r.s + core.s;
      const e = r.s + core.e;
      notes.push({ cs: s, ce: e, run: r, osc: !!core.osc });
    }
  }
  for (const nt of notes) refineNote(nt, bridged);
  mergeNotes(notes, bridged);
  for (let k = 0; k < notes.length; k++) {
    const nt = notes[k];
    nt.idx = k;
    nt.t = tAt(nt.s);
    nt.dur = (nt.e - nt.s + 1) * hop;
    nt.tEnd = tAt(nt.e);
    nt.db = mean(Array.from(fr.db.subarray(nt.s, nt.e + 1)));
    // 明瞭度は音程変化（ビブラート等）で目減りするので、音程が止まっている瞬間を優先して上位側で評価
    const cl = [];
    for (let i = nt.s + 1; i < nt.e; i++) {
      if (Math.abs(bridged[i + 1] - bridged[i - 1]) < 0.1) cl.push(fr.clarity[i]);
    }
    nt.clarity = percentile(cl.length >= 5 ? cl : Array.from(fr.clarity.subarray(nt.s, nt.e + 1)), 0.75);
  }

  // ---------- 4. 局所的な調律基準と音程ズレ ----------
  const tuned = notes.filter((nt) => nt.dur >= 0.12);
  for (const nt of tuned) {
    // ±12 秒以内の音符の小数部の円周平均
    let sx = 0, sy = 0;
    for (const o of tuned) {
      const dt = Math.abs(o.t - nt.t);
      if (dt > 12) continue;
      const w = Math.min(o.dur, 1) * (1 - dt / 14);
      const ang = 2 * Math.PI * o.center;
      sx += w * Math.cos(ang);
      sy += w * Math.sin(ang);
    }
    nt.offset = Math.atan2(sy, sx) / (2 * Math.PI); // -0.5..0.5 半音
    const rel = nt.center - nt.offset;
    nt.pitchClassNote = Math.round(rel);
    nt.dev = (rel - Math.round(rel)) * 100; // cents
  }
  // 全体のドリフト（オフセットの推移を unwrap）
  const drift = computeDrift(tuned);

  // 音程ズレの集計（長い音ほど重く、ただし 1 秒で頭打ち）
  const devW = tuned.map((nt) => Math.min(nt.dur, 1));
  const absDev = tuned.map((nt) => Math.abs(nt.dev));
  const meanAbsDev = wmean(absDev, devW);
  const hitRate = tuned.length ? tuned.filter((nt) => Math.abs(nt.dev) < 20).length / tuned.length : NaN;

  // ---------- 5. 調性（30 秒窓・転調対応） ----------
  const keyInfo = computeKeyFit(tuned);

  // ---------- 6. 各音符の詳細（ビブラート・安定） ----------
  for (const nt of notes) analyzeNoteDetail(nt, P, bridged, fr, hop);

  const longNotes = notes.filter((nt) => nt.dur >= 0.35);
  const stabVals = longNotes.map((nt) => nt.instability);
  const stabW = longNotes.map((nt) => Math.min(nt.dur, 2));
  const pitchInstability = stabVals.length ? wmean(stabVals, stabW) : NaN;
  const hfJitter = longNotes.length ? median(longNotes.map((nt) => nt.hfJitter)) : NaN;
  const loudWobble = longNotes.length ? median(longNotes.map((nt) => nt.dbWobble)) : NaN;
  const intraNoteDrift = longNotes.length ? median(longNotes.map((nt) => Math.abs(nt.driftCents))) : NaN;
  const intraNoteDriftSigned = longNotes.length ? median(longNotes.map((nt) => nt.driftCents)) : NaN;

  // ビブラート
  const vibCandidates = notes.filter((nt) => nt.dur >= 0.6);
  const vibNotes = vibCandidates.filter((nt) => nt.vib);
  const vibrato = {
    candidates: vibCandidates.length,
    count: vibNotes.length,
    ratio: vibCandidates.length ? vibNotes.length / vibCandidates.length : 0,
    rate: vibNotes.length ? median(vibNotes.map((nt) => nt.vib.rate)) : NaN,
    extent: vibNotes.length ? median(vibNotes.map((nt) => nt.vib.extent)) : NaN,
    regularity: vibNotes.length ? median(vibNotes.map((nt) => nt.vib.regularity)) : NaN,
    rateStd: vibNotes.length > 2 ? std(vibNotes.map((nt) => nt.vib.rate)) : 0,
  };

  // ---------- 7. 入り（しゃくり）とつなぎ ----------
  const onsets = [];
  const transitions = [];
  for (let k = 0; k < notes.length; k++) {
    const nt = notes[k];
    const prev = notes[k - 1];
    const connected = prev && prev.run === nt.run;
    if (!connected) {
      // 発声開始から音程が定まるまで
      const vOn = nt.run.s;
      if (nt.s - vOn > 40) continue; // 別の音から来ている扱いにしづらい長い前置きは除外
      const approach = (nt.s - vOn) * hop;
      let minP = Infinity;
      for (let i = vOn; i < nt.s; i++) if (!Number.isNaN(bridged[i])) minP = Math.min(minP, bridged[i]);
      const depth = Number.isFinite(minP) ? (nt.center - minP) * 100 : 0;
      onsets.push({ t: tAt(vOn), approach, depth, note: nt });
      nt.onsetApproach = approach;
      nt.onsetDepth = depth;
    } else {
      const interval = (nt.center - prev.center) * 100;
      const gap = (nt.s - prev.e) * hop;
      // 行き過ぎ（オーバーシュート）：到達後 120ms 以内に目標を越えた量
      let over = 0;
      const dir = Math.sign(interval);
      for (let i = nt.s; i < Math.min(nt.e, nt.s + 12); i++) over = Math.max(over, dir * (bridged[i] - nt.center) * 100);
      transitions.push({ t: tAt(prev.e), gap, interval, over, note: nt });
      nt.transGap = gap;
    }
  }
  const onsetMed = onsets.length ? median(onsets.map((o) => o.approach)) : NaN;
  const scoopEvents = onsets.filter((o) => o.approach >= 0.12 && o.depth >= 70);
  const scoopRatio = onsets.length ? scoopEvents.length / onsets.length : 0;
  const bigTrans = transitions.filter((tr) => Math.abs(tr.interval) >= 150);
  const slowGlides = bigTrans.filter((tr) => tr.gap > 0.2);
  const transMed = bigTrans.length ? median(bigTrans.map((tr) => tr.gap)) : NaN;
  const slowGlideRatio = bigTrans.length ? slowGlides.length / bigTrans.length : 0;
  const overshoots = transitions.filter((tr) => tr.over > 60 && Math.abs(tr.interval) >= 150);
  const overshootRatio = bigTrans.length ? overshoots.length / bigTrans.length : 0;

  // ---------- 8. 語尾 ----------
  const endings = [];
  for (const ph of phrasesKept) {
    const last = [...notes].reverse().find((nt) => nt.e <= ph.e && nt.s >= ph.s);
    if (!last || last.dur < 0.2) continue;
    // 最終音の後ろ（語尾）の区間
    const tailS = last.e + 1;
    const tailE = ph.e;
    let fall = 0;
    let tailFrames = 0;
    const lvl = last.db;
    for (let i = tailS; i <= tailE; i++) {
      if (Number.isNaN(P[i]) || fr.db[i] < lvl - 18) continue;
      tailFrames++;
      fall = Math.max(fall, (last.center - P[i]) * 100);
    }
    // 最終音自体の後半の下がり
    const lateSag = last.driftCents < 0 ? -last.driftCents : 0;
    const isFall = (fall >= 100 && tailFrames >= 6) || lateSag >= 60;
    // 終わり方：音量の減衰スロープ
    let cut = 0;
    const endI = ph.e;
    const before = fr.db[Math.max(ph.s, endI - 3)];
    const after = fr.db[Math.min(n - 1, endI + 3)];
    cut = before - after;
    endings.push({ t: tAt(last.s), tEnd: tAt(ph.e), fall, lateSag, isFall, abrupt: cut > 25, note: last });
  }
  const fallRatio = endings.length ? endings.filter((e) => e.isFall).length / endings.length : 0;

  // ---------- 9. 音量・抑揚 ----------
  const smDb = movingAverage(Array.from(fr.db), 15);
  const phraseLevels = [];
  const phraseRanges = [];
  for (const ph of phrasesKept) {
    const vals = [];
    for (let i = ph.s; i <= ph.e; i++) if (!Number.isNaN(P[i])) vals.push(smDb[i]);
    if (vals.length < 30) continue;
    phraseLevels.push(median(vals));
    phraseRanges.push(percentile(vals, 0.9) - percentile(vals, 0.1));
  }
  const phraseLevelStd = phraseLevels.length >= 3 ? std(phraseLevels) : NaN;
  const songLevelRange = phraseLevels.length >= 3 ? percentile(phraseLevels, 0.9) - percentile(phraseLevels, 0.1) : NaN;
  const phraseRangeMed = phraseRanges.length ? median(phraseRanges) : NaN;
  // 音符内の急な音量の飛び：急に当たる（+）／一瞬抜けて戻る（−）
  const spikes = [];
  for (const nt of notes) {
    if (nt.dur < 0.3) continue;
    for (let i = nt.s + 8; i <= nt.e - 6; i++) {
      const up = fr.db[i + 3] - fr.db[i];
      let dip = 0;
      if (fr.db[i] - fr.db[i + 3] >= 8) {
        // 150ms 以内に戻るか
        for (let k = i + 4; k <= Math.min(nt.e, i + 15); k++) if (fr.db[k] >= fr.db[i] - 3) { dip = fr.db[i] - fr.db[i + 3]; break; }
      }
      if (up >= 7 || dip) {
        spikes.push({ t: tAt(i), d: up >= 7 ? up : -dip, note: nt });
        i += 10;
      }
    }
  }
  const singMinutes = Math.max(voicedSec / 60, 0.25);
  const spikeRate = spikes.length / singMinutes;
  // 音高と音量の結びつき（高音で力む＝張り上げの指標）
  const pitchLoud = notes.length >= 8 ? pearson(notes.map((x) => x.center), notes.map((x) => x.db)) : 0;
  const plSlope = notes.length >= 8 ? regressionSlope(notes.map((x) => x.center), notes.map((x) => x.db)) : 0;

  // ---------- 10. 声質 ----------
  const clarVals = [], ringVals = [], alphaVals = [], hfVals = [], centVals = [];
  for (const nt of notes) {
    if (nt.dur < 0.15) continue;
    for (let i = nt.s; i <= nt.e; i++) {
      clarVals.push(fr.clarity[i]);
      ringVals.push(fr.ring[i]);
      alphaVals.push(fr.alpha[i]);
      hfVals.push(fr.hf[i]);
      centVals.push(fr.centroid[i]);
    }
  }
  const clarNotes = notes.filter((nt) => nt.dur >= 0.15);
  const clarity = clarNotes.length ? wmedian(clarNotes.map((nt) => nt.clarity), clarNotes.map((nt) => Math.min(nt.dur, 1.5))) : NaN;
  const hnr = Number.isFinite(clarity) ? 10 * Math.log10(clamp(clarity, 0.01, 0.999) / (1 - clamp(clarity, 0.01, 0.999))) : NaN;
  const ring = ringVals.length ? median(ringVals) : NaN;
  const alpha = alphaVals.length ? median(alphaVals) : NaN;
  const hf = hfVals.length ? median(hfVals) : NaN;
  const centroid = centVals.length ? median(centVals) : NaN;

  // ---------- 11. 音域と高音 ----------
  const pitchedNotes = notes.filter((nt) => nt.dur >= 0.15);
  const lowest = pitchedNotes.length ? percentile(pitchedNotes.map((x) => x.center), 0.03) : NaN;
  const highest = pitchedNotes.length ? percentile(pitchedNotes.map((x) => x.center), 0.97) : NaN;
  const high = analyzeHighRegister(pitchedNotes);

  // ---------- 12. 音程ズレ・揺れなどのイベント（タイムライン用） ----------
  const events = [];
  for (const nt of tuned) {
    if (nt.dur >= 0.2 && Math.abs(nt.dev) >= 28) {
      events.push({ type: 'pitch', t: nt.t, tEnd: nt.tEnd, sev: Math.abs(nt.dev) >= 38 ? 2 : 1, value: nt.dev });
    }
  }
  for (const nt of longNotes) {
    if (nt.instability >= 16) events.push({ type: 'wobble', t: nt.t, tEnd: nt.tEnd, sev: nt.instability >= 24 ? 2 : 1, value: nt.instability });
    if (nt.vib && (nt.vib.extent > 95 || nt.vib.rate > 7.8 || nt.vib.rate < 4.2)) {
      events.push({ type: 'vibrato', t: nt.t, tEnd: nt.tEnd, sev: 1, value: nt.vib });
    }
  }
  for (const o of scoopEvents) events.push({ type: 'scoop', t: o.t, tEnd: o.note.t + 0.1, sev: o.approach > 0.2 ? 2 : 1, value: o });
  for (const tr of slowGlides) events.push({ type: 'glide', t: tr.t, tEnd: tr.note.t + 0.1, sev: 1, value: tr });
  for (const e of endings) if (e.isFall) events.push({ type: 'fall', t: e.note.tEnd - 0.2, tEnd: e.tEnd, sev: 1, value: e });
  for (const sp of spikes) events.push({ type: 'spike', t: sp.t - 0.1, tEnd: sp.t + 0.2, sev: 1, value: sp.d });
  for (const h of high.strained) events.push({ type: 'strain', t: h.t, tEnd: h.tEnd, sev: 1, value: h });
  // 良かった箇所：安定したロングトーン
  const goods = longNotes
    .filter((nt) => nt.dur >= 0.7 && nt.instability < 9 && Math.abs(nt.dev ?? 99) < 12)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 6);
  for (const nt of goods) events.push({ type: 'good', t: nt.t, tEnd: nt.tEnd, sev: 0, value: nt });
  events.sort((a, b) => a.t - b.t);

  return {
    duration: n * hop,
    voicedSec,
    levels: { noiseFloor, singLevel, dbThr },
    counts: { notes: notes.length, tuned: tuned.length, phrases: phrasesKept.length, longNotes: longNotes.length },
    pitch: { meanAbsDev, hitRate, drift },
    key: keyInfo,
    stability: { pitchInstability, hfJitter, loudWobble, intraNoteDrift, intraNoteDriftSigned },
    vibrato,
    onset: { count: onsets.length, median: onsetMed, scoopRatio, transMed, slowGlideRatio, overshootRatio, bigTrans: bigTrans.length },
    endings: { count: endings.length, fallRatio },
    dynamics: { phraseLevelStd, songLevelRange, phraseRangeMed, spikeRate, spikes: spikes.length, pitchLoud, plSlope },
    tone: { clarity, hnr, ring, alpha, hf, centroid },
    range: { lowest, highest },
    high,
    events,
    // タイムライン描画用
    track: {
      hop,
      t0,
      pitch: Float32Array.from(P),
      db: Float32Array.from(fr.db),
      notes: notes.map((nt) => ({ t: nt.t, tEnd: nt.tEnd, center: nt.center, dev: nt.dev ?? null, dur: nt.dur, vib: !!nt.vib })),
      phrases: phrasesKept.map((p) => ({ t: tAt(p.s), tEnd: tAt(p.e) })),
    },
  };
}

// ============================================================
// 前処理
// ============================================================

function removeShortRuns(P, minLen) {
  const n = P.length;
  let i = 0;
  while (i < n) {
    if (Number.isNaN(P[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isNaN(P[j])) j++;
    if (j - i < minLen) for (let k = i; k < j; k++) P[k] = NaN;
    i = j;
  }
}

function localMedian(P, i, h) {
  const v = [];
  for (let k = Math.max(0, i - h); k <= Math.min(P.length - 1, i + h); k++) if (!Number.isNaN(P[k])) v.push(P[k]);
  return v.length ? median(v) : NaN;
}

function fixOctaveErrors(P) {
  const src = Float64Array.from(P);
  for (let i = 0; i < P.length; i++) {
    if (Number.isNaN(src[i])) continue;
    const m = localMedian(src, i, 8);
    const d = src[i] - m;
    if (Math.abs(d - 12) < 1.5) P[i] = src[i] - 12;
    else if (Math.abs(d + 12) < 1.5) P[i] = src[i] + 12;
    else if (Math.abs(d - 19) < 1.0) P[i] = src[i] - 19; // 3倍音誤検出
  }
}

function removeOutliers(P) {
  const src = Float64Array.from(P);
  for (let i = 0; i < P.length; i++) {
    if (Number.isNaN(src[i])) continue;
    const m = localMedian(src, i, 4);
    if (Math.abs(src[i] - m) > 3) P[i] = NaN;
  }
}

function median3(P) {
  const src = Float64Array.from(P);
  for (let i = 1; i < P.length - 1; i++) {
    const a = src[i - 1], b = src[i], c = src[i + 1];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
    P[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
}

function findRuns(P, bridge) {
  const runs = [];
  let cur = null;
  let gap = 0;
  for (let i = 0; i < P.length; i++) {
    if (!Number.isNaN(P[i])) {
      if (cur && gap <= bridge) cur.e = i;
      else {
        cur = { s: i, e: i };
        runs.push(cur);
      }
      gap = 0;
    } else if (cur) gap++;
  }
  return runs.filter((r) => r.e - r.s + 1 >= 8);
}

function interpolateGaps(A, s, e) {
  let last = -1;
  for (let i = s; i <= e; i++) {
    if (!Number.isNaN(A[i])) {
      if (last >= 0 && i - last > 1) {
        for (let k = last + 1; k < i; k++) A[k] = A[last] + ((A[i] - A[last]) * (k - last)) / (i - last);
      }
      last = i;
    }
  }
}

// ============================================================
// 音符
// ============================================================

/**
 * 平滑化したピッチの「留まり」を切り出す。
 * 傾きの大きいフレーム（しゃくり・ずり上げ・移行中）は核に含めない。
 */
function segmentNotes(seg) {
  const n = seg.length;
  const sm = movingAverage(seg, 15);
  const steady = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = sm[Math.max(0, i - 4)];
    const b = sm[Math.min(n - 1, i + 4)];
    steady[i] = Math.abs(b - a) < 0.3 ? 1 : 0;
  }
  const cores = [];
  const TOL = 0.45;
  let s = -1, sum = 0, cnt = 0;
  const close = (e) => {
    if (s >= 0 && e - s + 1 >= MIN_NOTE_FRAMES) cores.push({ s, e });
    s = -1;
  };
  for (let i = 0; i < n; i++) {
    if (!steady[i]) {
      close(i - 1);
      continue;
    }
    if (s < 0) {
      s = i; sum = sm[i]; cnt = 1;
      continue;
    }
    if (Math.abs(sm[i] - sum / cnt) <= TOL) {
      sum += sm[i];
      cnt++;
    } else {
      close(i - 1);
      s = i; sum = sm[i]; cnt = 1;
    }
  }
  close(n - 1);
  return mergeOscillation(addWideVibratoCores(cores, seg), seg);
}

/**
 * 幅の広いビブラート（±60c 超）は移動平均では消えず「不安定」と判定されてしまう。
 * 上下包絡の中点が一定で、なおかつ中点を何度も往復している区間を 1 音として追加する。
 */
function addWideVibratoCores(cores, seg) {
  const n = seg.length;
  if (n < 40) return cores;
  const H = 15;
  const mid = new Float64Array(n);
  const width = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mx = -Infinity, mn = Infinity;
    for (let k = Math.max(0, i - H); k <= Math.min(n - 1, i + H); k++) {
      if (seg[k] > mx) mx = seg[k];
      if (seg[k] < mn) mn = seg[k];
    }
    mid[i] = (mx + mn) / 2;
    width[i] = mx - mn;
  }
  const spans = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const ok = i < n && i >= H && i < n - H &&
      Math.abs(mid[Math.min(n - 1, i + 8)] - mid[Math.max(0, i - 8)]) < 0.3 &&
      width[i] > 0.9 && width[i] < 3.5;
    if (ok && s < 0) s = i;
    if (!ok && s >= 0) {
      if (i - s >= 30) spans.push({ s: Math.max(0, s - H), e: Math.min(n - 1, i - 1 + H) });
      s = -1;
    }
  }
  const out = [];
  for (const sp of spans) {
    // 中点の周りを往復しているか（交差回数）
    let m = 0;
    for (let i = sp.s; i <= sp.e; i++) m += mid[i];
    m /= sp.e - sp.s + 1;
    let crosses = 0;
    for (let i = sp.s + 1; i <= sp.e; i++) if ((seg[i] - m) * (seg[i - 1] - m) < 0) crosses++;
    if (crosses >= 4) out.push({ s: sp.s, e: sp.e, osc: true });
  }
  if (!out.length) return cores;
  const kept = cores.filter((c) => !out.some((o) => c.s <= o.e && c.e >= o.s));
  return [...kept, ...out].sort((a, b) => a.s - b.s);
}

/** 幅の広い／遅いビブラートで細切れになった核（A-B-A…の往復）を 1 音にまとめる */
function mergeOscillation(cores, seg) {
  if (cores.length < 3) return cores;
  const cen = (c) => {
    let v = 0;
    for (let i = c.s; i <= c.e; i++) v += seg[i];
    return v / (c.e - c.s + 1);
  };
  const out = [];
  let i = 0;
  while (i < cores.length) {
    let j = i;
    while (
      j + 2 < cores.length &&
      cores[j + 1].e - cores[j + 1].s < 25 &&
      cores[j + 1].s - cores[j].e < 12 &&
      cores[j + 2].s - cores[j + 1].e < 12 &&
      Math.abs(cen(cores[j]) - cen(cores[j + 2])) < 0.5 &&
      Math.abs(cen(cores[j]) - cen(cores[j + 1])) < 1.6
    ) j += 2;
    if (j > i) {
      out.push({ s: cores[i].s, e: cores[j].e, osc: true });
      i = j + 1;
    } else {
      out.push(cores[i]);
      i++;
    }
  }
  return out;
}

/** 生ピッチで音の「到達」と「離脱」を決める */
function refineNote(nt, A) {
  const r = nt.run;
  const len = nt.ce - nt.cs + 1;
  // 中心の初期推定：核の中央部の中央値（入りと抜けの影響を避ける）
  const mid = [];
  for (let i = nt.cs + Math.floor(len * 0.25); i <= nt.ce - Math.floor(len * 0.1); i++) mid.push(A[i]);
  const c = mid.length ? mid.reduce((x, y) => x + y, 0) / mid.length : A[nt.cs];
  const tol = nt.osc ? 1.6 : 0.35; // 往復結合した音は揺れ幅ぶん許容
  const near = (i) => Math.abs(A[i] - c) < tol;
  // 到達：近傍に入って 4 フレーム以上留まる最初の点
  let s = nt.cs;
  for (let i = Math.max(r.s, nt.cs - 30); i <= nt.ce - 4; i++) {
    if (near(i) && near(i + 2) && near(i + 4)) {
      s = i;
      break;
    }
  }
  let e = nt.ce;
  for (let i = Math.min(r.e, nt.ce + 12); i >= s + 4; i--) {
    if (near(i) && near(i - 2) && near(i - 4)) {
      e = i;
      break;
    }
  }
  nt.s = s;
  nt.e = Math.max(e, s + 1);
  let sum = 0;
  for (let i = nt.s; i <= nt.e; i++) sum += A[i];
  nt.center = sum / (nt.e - nt.s + 1);
}

/** 重なり解消と、同じ高さの細切れ音の結合 */
function mergeNotes(notes, A) {
  notes.sort((a, b) => a.s - b.s);
  for (let k = 1; k < notes.length; k++) {
    const p = notes[k - 1];
    const q = notes[k];
    if (q.s <= p.e) {
      const mid = Math.floor((p.e + q.s) / 2);
      p.e = Math.max(p.s + 1, mid);
      q.s = Math.min(q.e - 1, mid + 1);
    }
  }
  for (let k = notes.length - 1; k >= 1; k--) {
    const p = notes[k - 1];
    const q = notes[k];
    if (p.run === q.run && q.s - p.e <= 4 && Math.abs(q.center - p.center) < 0.4) {
      p.e = q.e;
      let sum = 0;
      for (let i = p.s; i <= p.e; i++) sum += A[i];
      p.center = sum / (p.e - p.s + 1);
      notes.splice(k, 1);
    }
  }
  for (let k = notes.length - 1; k >= 0; k--) if (notes[k].e - notes[k].s + 1 < MIN_NOTE_FRAMES) notes.splice(k, 1);
}

function analyzeNoteDetail(nt, P, A, fr, hop) {
  const len = nt.e - nt.s + 1;
  const raw = Array.from(A.subarray(nt.s, nt.e + 1));
  // ビブラート検出（0.6 秒以上）
  nt.vib = null;
  if (nt.dur >= 0.6) nt.vib = detectVibrato(raw, hop);
  // 安定性（0.35 秒以上）。前後 50ms を除外
  if (nt.dur >= 0.35) {
    const cut = Math.min(5, Math.floor(len / 6));
    const core = raw.slice(cut, len - cut);
    const win = nt.vib ? Math.max(5, Math.round(1 / nt.vib.rate / hop)) : 15;
    const lf = movingAverage(core, win);
    const lfC = Array.from(lf).map((v) => v * 100);
    nt.wobble = detrendedStd(lfC);
    nt.driftCents = slope(lfC) * (lfC.length - 1);
    nt.instability = Math.sqrt(nt.wobble ** 2 + (0.35 * nt.driftCents) ** 2);
    const hfm = movingAverage(core, 5);
    nt.hfJitter = std(core.map((v, i) => (v - hfm[i]) * 100));
    const dbs = Array.from(fr.db.subarray(nt.s + cut, nt.e + 1 - cut));
    const dbLf = movingAverage(dbs, win);
    nt.dbWobble = detrendedStd(Array.from(dbLf));
  }
}

/** ピッチ軌跡の自己相関から 3.5–9Hz の周期揺れを検出 */
function detectVibrato(raw, hop) {
  const trend = movingAverage(raw, 31);
  const d = raw.map((v, i) => (v - trend[i]) * 100);
  const n = d.length;
  const minLag = Math.max(2, Math.floor(1 / 10 / hop));
  const maxLag = Math.ceil(1 / 3.5 / hop);
  if (n < maxLag * 2.5) return null;
  let e0 = 0;
  for (const v of d) e0 += v * v;
  if (e0 <= 0) return null;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    ac[lag] = (s / e0) * (n / (n - lag));
  }
  // 局所極大のうち、最大値の 85% 以上ある最初のもの（倍周期の誤選択を防ぐ）
  const peaks = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1]) peaks.push(lag);
  }
  let best = -1, bestLag = -1;
  if (peaks.length) {
    const top = Math.max(...peaks.map((l) => ac[l]));
    bestLag = peaks.find((l) => ac[l] >= 0.85 * top);
    best = ac[bestLag];
  }
  if (!(bestLag > 0) || !(best >= 0.35)) return null;
  // 振幅：200ms 窓ごとの標準偏差の大きい区間
  const w = 20;
  const stds = [];
  for (let i = 0; i + w <= n; i += 10) stds.push(std(d.slice(i, i + w)));
  const mx = Math.max(...stds);
  const act = stds.filter((s) => s >= 0.5 * mx);
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
  const den = a - 2 * b + c;
  const sh = den !== 0 ? clamp((0.5 * (a - c)) / den, -1, 1) : 0;
  const rate = 1 / ((bestLag + sh) * hop);
  // ピッチ推定窓（64ms）の平均化で振幅が縮むので補正（矩形窓の sinc 応答）
  const x = rate * 0.064;
  const atten = Math.max(0.4, Math.sin(Math.PI * x) / (Math.PI * x));
  const extent = (Math.SQRT2 * mean(act)) / atten; // 片側振幅（cents）
  if (extent < 10) return null;
  return { rate, extent, regularity: best, coverage: act.length / stds.length };
}

function computeDrift(tuned) {
  if (tuned.length < 6) return { range: 0, total: 0 };
  // オフセットの unwrap
  const offs = [];
  let prev = null;
  for (const nt of tuned) {
    let o = nt.offset;
    if (prev !== null) {
      while (o - prev > 0.5) o -= 1;
      while (o - prev < -0.5) o += 1;
    }
    offs.push(o);
    prev = o;
  }
  const sm = movingAverage(offs, 9);
  const range = (Math.max(...sm) - Math.min(...sm)) * 100;
  const total = (sm[sm.length - 1] - sm[0]) * 100;
  return { range, total };
}

function computeKeyFit(tuned) {
  if (tuned.length < 8) return { name: '判定不能', inScale: NaN, windows: [] };
  const end = tuned[tuned.length - 1].tEnd;
  const windows = [];
  const pcOf = (nt) => ((nt.pitchClassNote % 12) + 12) % 12;
  for (let ws = 0; ws < Math.max(end - 20, 1); ws += 10) {
    const hist = new Array(12).fill(0);
    let cnt = 0;
    for (const nt of tuned) {
      if (nt.t < ws || nt.t >= ws + 30) continue;
      hist[pcOf(nt)] += Math.min(nt.dur, 1.5);
      cnt++;
    }
    if (cnt < 8) continue;
    windows.push({ t: ws, ...estimateKey(hist), weight: cnt });
  }
  const globalHist = new Array(12).fill(0);
  for (const nt of tuned) globalHist[pcOf(nt)] += Math.min(nt.dur, 1.5);
  const g = estimateKey(globalHist);
  const inScale = windows.length ? wmean(windows.map((w) => w.inScale), windows.map((w) => w.weight)) : g.inScale;
  // 転調の検出：窓ごとの主音が変わった回数
  let modulations = 0;
  for (let i = 1; i < windows.length; i++) if (windows[i].tonic !== windows[i - 1].tonic && windows[i].r > 0.6) modulations++;
  // 各音符がスケール内か（イベント用）
  return { name: g.name, tonic: g.tonic, mode: g.mode, inScale, globalInScale: g.inScale, modulations, windowCount: windows.length };
}

function analyzeHighRegister(notes) {
  const res = { available: false, strained: [] };
  if (notes.length < 12) return res;
  const centers = notes.map((x) => x.center);
  const lo = percentile(centers, 0.1);
  const hiThr = percentile(centers, 0.8);
  if (percentile(centers, 0.95) - lo < 6) return res; // 音域が狭い曲は評価しない
  const highs = notes.filter((x) => x.center >= hiThr && x.dur >= 0.2);
  const mids = notes.filter((x) => x.center < hiThr && x.center >= lo && x.dur >= 0.2);
  if (highs.length < 4 || mids.length < 6) return res;
  const devHigh = highs.filter((x) => x.dev != null);
  const devMid = mids.filter((x) => x.dev != null);
  res.available = true;
  res.threshold = hiThr;
  res.absDevHigh = mean(devHigh.map((x) => Math.abs(x.dev)));
  res.absDevMid = mean(devMid.map((x) => Math.abs(x.dev)));
  res.signedDevHigh = mean(devHigh.map((x) => x.dev)) - mean(devMid.map((x) => x.dev));
  res.clarityHigh = median(highs.map((x) => x.clarity));
  res.clarityMid = median(mids.map((x) => x.clarity));
  // 1 に近い領域は差が誇張されるので 15dB で頭打ち
  const toHnr = (c) => Math.min(15, 10 * Math.log10(clamp(c, 0.01, 0.999) / (1 - clamp(c, 0.01, 0.999))));
  res.hnrDrop = toHnr(res.clarityMid) - toHnr(res.clarityHigh);
  res.loudJump = mean(highs.map((x) => x.db)) - mean(mids.map((x) => x.db));
  const hl = highs.filter((x) => x.instability != null);
  const ml = mids.filter((x) => x.instability != null);
  res.instHigh = hl.length ? mean(hl.map((x) => x.instability)) : NaN;
  res.instMid = ml.length ? mean(ml.map((x) => x.instability)) : NaN;
  for (const x of highs) {
    const hx = toHnr(x.clarity);
    const bad = (x.dev != null && x.dev < -30) || (hx < toHnr(res.clarityMid) - 5 && hx < 9);
    if (bad) res.strained.push({ t: x.t, tEnd: x.tEnd, dev: x.dev, clarity: x.clarity });
  }
  return res;
}

function wmedian(vals, ws) {
  const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) {
    acc += ws[i];
    if (acc >= tot / 2) return vals[i];
  }
  return vals[idx[idx.length - 1]];
}

function regressionSlope(x, y) {
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}
