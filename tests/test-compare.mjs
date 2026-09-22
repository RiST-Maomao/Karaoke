import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { analyzeFrames } from '../js/analysis/analyze.js';
import { compareToReference, shiftLabel } from '../js/analysis/compare.js';
import { synthSinging, demoMelody } from './synth.mjs';
import { STYLES } from './test-score.mjs';

function track(notes, style, seed) {
  const x = synthSinging(notes, style, 16000, seed);
  const fa = new FrameAnalyzer(16000);
  fa.push(x);
  return analyzeFrames(fa.result()).track;
}
const base = demoMelody(0, 2);
const ref = track(base, STYLES.pro, 1);

export function cases() {
  // 1) 同期・オクターブ下・正しいメロディ
  const u1 = track(base.map((n) => (n.rest ? n : { ...n, midi: n.midi - 12 })), STYLES.good, 2);
  // 2) 同期・メロディ違い（3 音に 1 音、全音ずれ）＋ 遅れ気味
  let k = 0;
  const wrongNotes = base.map((n) => (n.rest ? n : { ...n, midi: n.midi + (k++ % 3 === 0 ? 2 : 0) }));
  const u2 = track(wrongNotes, STYLES.good, 3);
  // 3) 非同期：前に 2 秒の無音、テンポ 1.12 倍遅い、+3 キー
  const slow = [{ rest: true, dur: 2 }, ...base.map((n) => ({ ...n, dur: n.dur * 1.12, midi: n.rest ? n.midi : n.midi + 3 }))];
  const u3 = track(slow, STYLES.good, 4);
  // 4) 同期・リズムがバラバラ（各音の長さを ±25% ランダムに）
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jit = base.map((n) => ({ ...n, dur: n.dur * (0.75 + rnd() * 0.5) }));
  const u4 = track(jit, STYLES.good, 5);
  return [
    ['同期・1oct下・正しい', compareToReference(u1, ref, { synced: true })],
    ['同期・メロディ違い', compareToReference(u2, ref, { synced: true })],
    ['非同期・遅い・+3キー', compareToReference(u3, ref, { synced: false })],
    ['同期・リズム乱れ', compareToReference(u4, ref, { synced: true })],
  ];
}

if (process.argv[1] && process.argv[1].endsWith('test-compare.mjs')) {
  for (const [name, c] of cases()) {
    const tm = c.timing ? `lag ${(c.timing.medianLag * 1000).toFixed(0)}ms spread ${(c.timing.spread * 1000).toFixed(0)}ms n${c.timing.samples}` : 'timing -';
    console.log(`${name}: shift ${c.shift}(${shiftLabel(c.shift)}) match ${(c.melodyMatch * 100).toFixed(0)}% cover ${(c.coverage * 100).toFixed(0)}% wrong ${c.wrong.length} | ${tm} | melody ${c.melodyScore.toFixed(0)} rhythm ${Number.isFinite(c.rhythmScore) ? c.rhythmScore.toFixed(0) : '-'} score ${c.score.toFixed(0)}`);
  }
}
