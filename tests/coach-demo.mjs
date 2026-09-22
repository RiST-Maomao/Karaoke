import { run, STYLES } from './test-score.mjs';
import { buildCoaching } from '../js/analysis/coach.js';
for (const k of (process.argv[2] || 'good,shaky').split(',')) {
  const { m, s } = run(STYLES[k]);
  const c = buildCoaching(m, s);
  console.log(`== ${k} ${s.total.toFixed(1)}`);
  console.log(c.summary);
  for (const i of c.issues) console.log(` - ${i.polish ? '[polish] ' : ''}${i.title} | ${i.detail} | ex:${i.examples.map((e) => e.label).join(',')}`);
  console.log(' menu:', c.menu.map((d) => d.name).join(', '));
  console.log(' goals:', c.goals.join(' / '));
  console.log(' notes:', c.notes.join(' / '));
}
