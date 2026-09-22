import { run, STYLES } from './test-score.mjs';
const only = process.argv[2];
for (const [name, style] of Object.entries(STYLES)) {
  if (only && name !== only) continue;
  const { m, s } = run(style);
  const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  console.log(`${name.padEnd(9)} ${f(s.total,1)} notes ${m.counts.notes} long ${m.counts.longNotes} ph ${m.counts.phrases} | dev ${f(m.pitch.meanAbsDev,1)} inScale ${f(m.key.inScale)} | inst ${f(m.stability.pitchInstability,1)} | vib ${m.vibrato.count}/${m.vibrato.candidates} r${f(m.vibrato.rate,1)} e${f(m.vibrato.extent,0)} | onset n${m.onset.count} med${f(m.onset.median)} scoop${f(m.onset.scoopRatio)} | end n${m.endings.count} fall${f(m.endings.fallRatio)} | clar ${f(m.tone.clarity,3)} hnr ${f(m.tone.hnr,1)} ring ${f(m.tone.ring,1)} hf ${f(m.tone.hf,1)} | dyn ${f(m.dynamics.phraseLevelStd,1)} ${f(m.dynamics.phraseRangeMed,1)} sp${f(m.dynamics.spikeRate,1)}`);
}
