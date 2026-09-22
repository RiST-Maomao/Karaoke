// 母音×音高でオクターブ誤りの頻度を調べる
import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { synthSinging } from './synth.mjs';
let bad = 0, total = 0;
const rows = [];
for (const vowel of ['a', 'i', 'u', 'e', 'o']) {
  let line = `${vowel}: `;
  for (let midi = 45; midi <= 79; midi += 2) {
    const x = synthSinging([{ midi, dur: 0.6 }], { vowelFixed: vowel }, 16000, midi);
    const fa = new FrameAnalyzer(16000);
    fa.push(x);
    const r = fa.result();
    const want = 440 * Math.pow(2, (midi - 69) / 12);
    let oct = 0, n = 0;
    for (let i = 12; i < r.n - 6; i++) {
      if (r.f0[i] <= 0) continue;
      n++;
      if (Math.abs(1200 * Math.log2(r.f0[i] / want)) > 300) oct++;
    }
    total += n;
    bad += oct;
    line += oct > n * 0.2 ? 'X' : oct ? 'x' : '.';
  }
  rows.push(line);
}
console.log(rows.join('\n'));
console.log(`octave-error frames: ${bad}/${total} (${((bad / total) * 100).toFixed(1)}%)`);
