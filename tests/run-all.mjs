// 回帰テスト：合成歌声で「上手い歌ほど高く」「欠点は該当項目で検出」されるかを確認
// 実行: node tests/run-all.mjs
import { run, STYLES } from './test-score.mjs';
import { FrameAnalyzer } from '../js/dsp/frameAnalyzer.js';
import { synthSinging } from './synth.mjs';
import { buildCoaching } from '../js/analysis/coach.js';

let fails = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails++;
};

// 1. ピッチ精度
for (const midi of [45, 57, 69, 79]) {
  const x = synthSinging([{ midi, dur: 0.8 }], {}, 32000, midi);
  const fa = new FrameAnalyzer(32000);
  fa.push(x);
  const r = fa.result();
  const want = 440 * Math.pow(2, (midi - 69) / 12);
  const errs = [];
  for (let i = 15; i < r.n - 8; i++) if (r.f0[i] > 0) errs.push(Math.abs(1200 * Math.log2(r.f0[i] / want)));
  check(errs.length > 30 && Math.max(...errs) < 8, `ピッチ精度 midi ${midi}: 最大誤差 ${Math.max(...errs).toFixed(1)}c`);
}

// 2. 採点
const res = {};
for (const name of Object.keys(STYLES)) res[name] = run(STYLES[name]);
const cat = (name, id) => res[name].s.categories.find((c) => c.id === id).score;
const tot = (name) => res[name].s.total;

check(tot('pro') >= 96, `プロ相当 ≥ 96 (${tot('pro').toFixed(1)})`);
check(tot('proLyrics') >= 96, `プロ相当＋歌詞 ≥ 96 (${tot('proLyrics').toFixed(1)})`);
check(tot('pro') > tot('good'), 'プロ > 上手い');
for (const bad of ['scoops', 'offkey', 'shaky', 'flat', 'chirimen']) {
  check(tot('good') > tot(bad) + 3, `上手い > ${bad} (${tot('good').toFixed(1)} vs ${tot(bad).toFixed(1)})`);
}
check(cat('offkey', 'pitch') < 80, `音程ズレを検出 (${cat('offkey', 'pitch')})`);
check(cat('offkeyLyrics', 'pitch') < 80, `歌詞ありでも音程ズレを検出 (${cat('offkeyLyrics', 'pitch')})`);
check(cat('scoops', 'onset') < 75, `しゃくりを検出 (${cat('scoops', 'onset')})`);
check(cat('flat', 'phrase') < 60, `語尾下がりを検出 (${cat('flat', 'phrase')})`);
check(cat('chirimen', 'vibrato') < 65, `ちりめんビブラートを検出 (${cat('chirimen', 'vibrato')})`);
check(cat('shaky', 'vibrato') < 60, `うねるビブラートを検出 (${cat('shaky', 'vibrato')})`);
check(cat('breathy', 'tone') < 80, `息漏れを検出 (${cat('breathy', 'tone')})`);
check(!res.proLyrics.m.events.some((e) => e.type === 'strain'), 'プロ相当で高音の力みを誤検出しない');

// 3. コーチング
for (const name of ['scoops', 'flat', 'offkey']) {
  const c = buildCoaching(res[name].m, res[name].s);
  const want = { scoops: 'onset', flat: 'phrase', offkey: 'pitch' }[name];
  check(c.issues.length && c.issues[0].cat === want, `${name}: 最重要の指摘が ${want} (${c.issues[0]?.cat})`);
  check(c.menu.length >= 2, `${name}: 練習メニューがある`);
}

console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功');
process.exit(fails ? 1 : 0);
