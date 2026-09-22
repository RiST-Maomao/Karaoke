// テスト用 WAV を生成
import { writeFileSync } from 'node:fs';
import { synthSinging, demoMelody } from './synth.mjs';
import { STYLES } from './test-score.mjs';
const sr = 24000;
let k = 0;
const wrongMelody = demoMelody(-5, 2).map((n) => (n.rest ? n : { ...n, midi: n.midi + (k++ % 4 === 1 ? 2 : 0) }));
const jobs = { pro: [demoMelody(-5, 2), STYLES.proLyrics], good: [demoMelody(-5, 2), STYLES.goodLyrics], shaky: [demoMelody(-5, 2), STYLES.shaky], wrong: [wrongMelody, STYLES.goodLyrics] };
for (const [name, [mel, style]] of Object.entries(jobs)) {
  const x = synthSinging(mel, style, sr, 7);
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(`tests/fixtures/${name}.wav`, buf);
}
console.log('ok');
