import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { synthSinging } from './synth.mjs';

// 定常音でのピッチ精度
let worst = 0;
for (const midi of [43, 48, 55, 60, 64, 69, 72, 76, 81]) {
  const notes = [{ midi, dur: 1.0 }];
  const x = synthSinging(notes, { breath: 0.03 }, 48000, midi);
  const fa = new FrameAnalyzer(48000);
  for (let i = 0; i < x.length; i += 128) fa.push(x.subarray(i, i + 128));
  const r = fa.result();
  const errs = [];
  const want = 440 * Math.pow(2, (midi - 69) / 12);
  let clar = 0, cn = 0;
  for (let i = 20; i < r.n - 10; i++) {
    if (r.f0[i] > 0) {
      errs.push(1200 * Math.log2(r.f0[i] / want));
      clar += r.clarity[i];
      cn++;
    }
  }
  errs.sort((a, b) => a - b);
  const med = errs[errs.length >> 1];
  const maxAbs = Math.max(...errs.map(Math.abs));
  worst = Math.max(worst, maxAbs);
  console.log(`midi ${midi} (${want.toFixed(1)}Hz): voiced ${cn}/${r.n}, median err ${med.toFixed(2)}c, max |err| ${maxAbs.toFixed(1)}c, clarity ${(clar / cn).toFixed(3)}, ring ${r.ring[50].toFixed(1)} db ${r.db[50].toFixed(1)}`);
}
console.log('worst', worst.toFixed(1));
