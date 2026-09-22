// テスト用の合成歌声ジェネレータ。
// 旋律（MIDI ノート列）と「歌い方のクセ」パラメータから歌声らしい信号を作る。

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 母音ごとのフォルマント（F1, F2）
const VOWELS = { a: [800, 1200], i: [300, 2300], u: [350, 1300], e: [500, 1900], o: [500, 900] };

// 母音風のフォルマント包絡
function formantGain(hz, ring, vowel = 'a') {
  const [f1, f2] = VOWELS[vowel];
  const F = [
    [f1, 80, 1.0],
    [f2, 90, 0.6],
    [2600, 120, 0.25],
    [3000, 200, 0.2 * ring],
  ];
  let g = 0.02;
  for (const [f, bw, a] of F) g += a / (1 + ((hz - f) / bw) ** 2);
  return g / Math.pow(1 + hz / 400, 0.7);
}

/**
 * notes: [{ midi, dur, rest? }]
 * style: {
 *   detune: 各ノートのランダム音程ずれ(cents, 標準偏差)
 *   bias: 全体の音程ずれ(cents)
 *   drift: 1曲あたりの音程ドリフト(cents)
 *   scoop: 入りのしゃくり量(cents)と時間
 *   vibRate, vibDepth (cents), vibOnLong
 *   wobble: 低周波のふらつき(cents)
 *   breath: 息成分の量 (0..1)
 *   dynamics: フレーズ抑揚(dB)
 *   ring: 響き(2.6-3kHz 帯の強さ)
 *   fallEnd: 語尾の音程下がり(cents)
 * }
 */
export function synthSinging(notes, style = {}, sr = 48000, seed = 1) {
  const rnd = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const s = {
    detune: 0, bias: 0, drift: 0, scoopCents: 0, scoopTime: 0.06,
    vibRate: 5.8, vibDepth: 0, vibOnLong: 0.35, wobble: 0, jitter: 0.1,
    breath: 0.02, dynamics: 3, ring: 1, fallEnd: 0, level: 0.25, noise: 0.0005,
    abruptEnd: false, lyrics: false, ...style,
  };
  const total = notes.reduce((a, n) => a + n.dur, 0);
  const N = Math.ceil(total * sr);
  const out = new Float32Array(N);
  let phase = 0;
  let t0 = 0;
  let wobblePhase = rnd() * 10;
  let prevMidi = null;
  let phraseIdx = 0;
  let noteInPhrase = 0;
  let lp = 0; // 息ノイズ用ローパス
  const gains = [];
  for (let ni = 0; ni < notes.length; ni++) {
    const note = notes[ni];
    const start = Math.floor(t0 * sr);
    const len = Math.floor(note.dur * sr);
    t0 += note.dur;
    if (note.rest) {
      phraseIdx++;
      noteInPhrase = 0;
      prevMidi = null;
      for (let i = 0; i < len && start + i < N; i++) out[start + i] = s.noise * gauss();
      continue;
    }
    const nextRest = !notes[ni + 1] || notes[ni + 1].rest;
    // 歌詞：母音を変え、一部の音の頭に子音（無声の摩擦音＋短い無音）を入れる
    const vowel = s.lyrics ? 'aiueo'[Math.floor(rnd() * 5)] : 'a';
    const consonant = s.lyrics && rnd() < 0.5 ? 0.03 + rnd() * 0.05 : 0;
    const errCents = s.detune * gauss() + s.bias + (s.drift * (t0 / total));
    const target = note.midi + errCents / 100;
    const phraseDb = Math.sin(phraseIdx * 1.7) * s.dynamics * 0.5;
    for (let i = 0; i < len && start + i < N; i++) {
      const tt = i / sr;
      let m = target;
      // 前の音からのグライド or しゃくり
      if (prevMidi !== null && tt < 0.05) m = prevMidi + (target - prevMidi) * (tt / 0.05);
      if (s.scoopCents && tt < s.scoopTime) m -= (s.scoopCents / 100) * (1 - tt / s.scoopTime);
      // ビブラート（長い音の後半）
      if (s.vibDepth && note.dur > 0.5 && tt > note.dur * s.vibOnLong) {
        const ramp = Math.min(1, (tt - note.dur * s.vibOnLong) / 0.2);
        m += (s.vibDepth / 100) * ramp * Math.sin(2 * Math.PI * s.vibRate * tt);
      }
      // 低周波ふらつき
      wobblePhase += 1 / sr;
      if (s.wobble) m += (s.wobble / 100) * (Math.sin(2 * Math.PI * 1.3 * wobblePhase) * 0.6 + Math.sin(2 * Math.PI * 2.7 * wobblePhase + 1) * 0.4);
      // 語尾下がり
      if (nextRest && s.fallEnd && tt > note.dur - 0.18) m -= (s.fallEnd / 100) * ((tt - (note.dur - 0.18)) / 0.18);
      const hz = midiToHz(m) * (1 + (s.jitter / 100) * 0.01 * gauss());
      phase += (2 * Math.PI * hz) / sr;
      // 振幅包絡
      const att = Math.min(1, tt / 0.03);
      const rel = s.abruptEnd ? Math.min(1, (note.dur - tt) / 0.005) : nextRest ? Math.min(1, (note.dur - tt) / 0.12) : 1;
      const phraseShape = Math.sin(Math.PI * Math.min(1, (noteInPhrase + tt / note.dur) / 6)) * s.dynamics * 0.3;
      const amp = s.level * Math.pow(10, (phraseDb + phraseShape) / 20) * att * Math.max(0, rel);
      if ((i & 63) === 0) {
        gains.length = 0;
        for (let h = 1; h * hz < sr / 2 - 500 && h < 40; h++) gains.push(formantGain(h * hz, s.ring, vowel) / Math.sqrt(h));
      }
      let v = 0;
      for (let h = 0; h < gains.length; h++) v += gains[h] * Math.sin((h + 1) * phase);
      lp = 0.7 * lp + 0.3 * gauss();
      if (tt < consonant) {
        // 子音：前半は摩擦ノイズ、声はまだ出ていない
        out[start + i] = (tt < consonant * 0.6 ? s.level * 0.15 * (gauss() - lp) : 0) + s.noise * gauss();
        continue;
      }
      out[start + i] = amp * (v * 1.6 + s.breath * 3 * (gauss() - lp)) + s.noise * gauss();
    }
    prevMidi = target;
    noteInPhrase++;
  }
  return out;
}

/** 簡単なメロディ（ハ長調風, 4 フレーズ） */
export function demoMelody(transpose = 0, repeats = 2) {
  const phrases = [
    [[60, 0.4], [62, 0.4], [64, 0.4], [65, 0.4], [67, 1.2]],
    [[67, 0.3], [69, 0.3], [67, 0.3], [65, 0.3], [64, 0.8], [62, 0.8]],
    [[64, 0.4], [65, 0.4], [67, 0.4], [72, 1.6]],
    [[71, 0.4], [69, 0.4], [67, 0.4], [65, 0.4], [64, 0.4], [62, 0.4], [60, 1.5]],
  ];
  const notes = [{ rest: true, dur: 0.6 }];
  for (let r = 0; r < repeats; r++) {
    for (const p of phrases) {
      for (const [m, d] of p) notes.push({ midi: m + transpose, dur: d });
      notes.push({ rest: true, dur: 0.7 });
    }
  }
  return notes;
}
