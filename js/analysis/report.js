// 解析パイプライン全体：フレーム → 計測 → 採点 → コーチング
import { analyzeFrames } from './analyze.js';
import { scoreMetrics } from './score.js';
import { buildCoaching } from './coach.js';

export const ANALYSIS_VERSION = 1;

export function buildReport(frames) {
  const metrics = analyzeFrames(frames);
  const score = scoreMetrics(metrics);
  const coaching = buildCoaching(metrics, score);
  const { track, events, ...rawMetrics } = metrics;
  return {
    version: ANALYSIS_VERSION,
    total: score.total,
    reliability: score.reliability,
    categories: score.categories,
    coaching,
    metrics: rawMetrics,
    events,
    track,
    enoughVoice: metrics.voicedSec >= 5 && metrics.counts.notes >= 5,
  };
}
