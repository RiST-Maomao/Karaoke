// 解析パイプライン全体：フレーム → 計測 → 採点 → コーチング
import { analyzeFrames } from './analyze.js';
import { scoreMetrics } from './score.js';
import { buildCoaching } from './coach.js';
import { compareToReference } from './compare.js';

export const ANALYSIS_VERSION = 1;

/**
 * ref: お手本 { track: { hop, t0, pitch } }（任意）
 * synced: 伴奏（原曲）と同じ時間軸で歌ったか
 */
export function buildReport(frames, ref = null, synced = false, latency = 0) {
  const metrics = analyzeFrames(frames);
  if (ref && ref.track) {
    try {
      const cmp = compareToReference(metrics.track, ref.track, { synced, latency });
      metrics.reference = cmp;
      if (cmp.available) {
        for (const w of cmp.wrong) metrics.events.push({ type: 'melody', t: w.t, tEnd: w.tEnd, sev: Math.abs(w.semis) >= 1.5 ? 2 : 1, value: w.semis });
        if (cmp.timing) for (const l of cmp.timing.worst) metrics.events.push({ type: 'timing', t: l.t, tEnd: l.t + 0.3, sev: 1, value: l.lag - cmp.timing.medianLag });
        metrics.events.sort((a, b) => a.t - b.t);
      }
    } catch (e) {
      metrics.reference = { available: false, reason: String(e) };
    }
  }
  const score = scoreMetrics(metrics);
  const coaching = buildCoaching(metrics, score);
  const { track, events, reference, ...rawMetrics } = metrics;
  if (reference) {
    // ガイド（お手本の音程）はタイムライン用に track 側へ
    const { guide, guideT0, guideBin, ...refInfo } = reference;
    rawMetrics.reference = refInfo;
    if (guide) track.guide = { pitch: Float32Array.from(guide), t0: guideT0, bin: guideBin };
  }
  return {
    version: ANALYSIS_VERSION,
    total: score.total,
    reliability: score.reliability,
    categories: score.categories,
    coaching,
    metrics: rawMetrics,
    events,
    track,
    enoughVoice: !score.insufficient,
    insufficient: !!score.insufficient,
  };
}
