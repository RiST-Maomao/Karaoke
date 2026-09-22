import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { analyzeFrames } from '../js/analysis/analyze.js';
import { scoreMetrics } from '../js/analysis/score.js';
import { synthSinging, demoMelody } from './synth.mjs';

export const STYLES = {
  pro: { detune: 6, vibDepth: 40, vibRate: 5.8, breath: 0.015, dynamics: 5, wobble: 2, drift: -10 },
  good: { detune: 12, vibDepth: 30, vibRate: 6.2, breath: 0.03, dynamics: 4, wobble: 5, scoopCents: 80, scoopTime: 0.07 },
  scoops: { detune: 10, scoopCents: 150, scoopTime: 0.2, breath: 0.03, dynamics: 4, wobble: 4 },
  offkey: { detune: 30, breath: 0.03, dynamics: 3, wobble: 6 },
  shaky: { detune: 14, wobble: 25, breath: 0.05, dynamics: 2, vibDepth: 120, vibRate: 3.8 },
  breathy: { detune: 10, breath: 0.07, dynamics: 3, wobble: 4 },
  flat: { detune: 10, dynamics: 0, wobble: 4, fallEnd: 180, breath: 0.03 },
  proLyrics: { detune: 6, vibDepth: 40, vibRate: 5.8, breath: 0.015, dynamics: 5, wobble: 2, drift: -10, lyrics: true },
  goodLyrics: { detune: 12, vibDepth: 30, vibRate: 6.2, breath: 0.03, dynamics: 4, wobble: 5, scoopCents: 80, scoopTime: 0.07, lyrics: true },
  offkeyLyrics: { detune: 30, breath: 0.03, dynamics: 3, wobble: 6, lyrics: true },
  chirimen: { detune: 10, vibDepth: 15, vibRate: 8.8, vibOnLong: 0, breath: 0.03, dynamics: 4 },
};

export function run(style, seed = 3, transpose = 0) {
  const x = synthSinging(demoMelody(transpose, 2), style, 32000, seed);
  const fa = new FrameAnalyzer(32000);
  for (let i = 0; i < x.length; i += 128) fa.push(x.subarray(i, i + 128));
  const m = analyzeFrames(fa.result());
  const s = scoreMetrics(m);
  return { m, s };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const only = process.argv[2];
  for (const [name, style] of Object.entries(STYLES)) {
    if (only && name !== only) continue;
    const { m, s } = run(style);
    const cats = s.categories.map((c) => `${c.short}${c.score ?? '-'}`).join(' ');
    console.log(`${name.padEnd(9)} total ${s.total.toFixed(1).padStart(5)} | ${cats}`);
    if (only) {
      const { track, events, ...rest } = m;
      console.log(JSON.stringify(rest, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 1));
      console.log('events', events.map((e) => `${e.type}@${e.t.toFixed(1)}`).join(' '));
    }
  }
}
