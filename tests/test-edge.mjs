// 端のケース：無音・雑音のみ・ごく短い歌・大音量クリップ
import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { buildReport } from '../js/analysis/report.js';
import { synthSinging, demoMelody } from './synth.mjs';

const sr = 16000;
function run(name, x, ref = null) {
  try {
    const fa = new FrameAnalyzer(sr);
    fa.push(x);
    const r = buildReport(fa.result(), ref, false);
    const bad = JSON.stringify(r.categories).includes('NaN') || !Number.isFinite(r.total);
    console.log(`${bad ? '✗' : '✓'} ${name}: total ${r.total} enough ${r.enoughVoice} issues ${r.coaching.issues.length} notes ${r.coaching.notes.length}`);
    return bad ? 1 : 0;
  } catch (e) {
    console.log(`✗ ${name}: ${e.stack}`);
    return 1;
  }
}
let fails = 0;
fails += run('無音', new Float32Array(sr * 5));
const noise = new Float32Array(sr * 5).map(() => (Math.random() - 0.5) * 0.02);
fails += run('雑音のみ', noise);
fails += run('短い歌 1 秒', synthSinging([{ midi: 60, dur: 1 }], {}, sr, 1));
fails += run('短い歌 3 音', synthSinging(demoMelody(0, 1).slice(0, 4), {}, sr, 1));
const loud = synthSinging(demoMelody(0, 1), { level: 3 }, sr, 2).map((v) => Math.max(-1, Math.min(1, v)));
fails += run('クリップした大音量', loud);
const quiet = synthSinging(demoMelody(0, 1), { level: 0.003, noise: 0.0002 }, sr, 3);
fails += run('とても小さい声', quiet);
fails += run('0.2 秒', new Float32Array(3200));
// お手本付き・歌声なし
const fa = new FrameAnalyzer(sr);
fa.push(synthSinging(demoMelody(0, 1), {}, sr, 4));
const refTrack = buildReport(fa.result()).track;
fails += run('お手本あり・無音', new Float32Array(sr * 5), { track: refTrack });
fails += run('お手本あり・短い歌', synthSinging([{ midi: 60, dur: 1 }], {}, sr, 1), { track: refTrack });
console.log(fails ? `${fails} 件失敗` : 'すべて成功');
process.exit(fails ? 1 : 0);
