// 計測値とスコアから「ボイトレの先生」としてのフィードバックを作る

import { fmtTime, midiName, midiNameJa } from './music.js';
import { scoreLabel } from './score.js';
import { shiftLabel } from './compare.js';

const r0 = (v) => Math.round(v);
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${Math.round(v * 100)}%`;

export const DRILLS = {
  longtone: {
    name: 'チューナー・ロングトーン',
    time: '5分',
    steps: [
      'アプリの「練習」→「ロングトーン」を開く',
      '楽に出せる高さで「あー」を 8 秒まっすぐ伸ばす',
      '針（ズレ表示）が ±10 セント以内に収まり続けるのが目標',
      '音の高さを半音ずつ変えて 5 音 × 2 セット',
    ],
    point: '「伸ばしている間ずっと同じ高さ」を体に覚えさせる、音程と安定感の基礎練習です。',
  },
  scale: {
    name: '音階（ドレミファソファミレド）',
    time: '5分',
    steps: [
      'アプリの「練習」→「音階」を開き、目標の音（ド）を自分の楽な高さに',
      '基準音と一緒に「あ」や「ま」で歌う（最初は「ゆっくり」）',
      '全部の音が ±15 セント以内（緑）になったら、ドを半音上げてもう一度',
      '「ファ」と「ド（最後）」は低くなりやすいので特に注意',
    ],
    point: '音と音の間隔（音程感覚）を体に覚えさせる基本練習です。曲の中での音程の精度が上がります。',
  },
  lipRoll: {
    name: 'リップロール',
    time: '3分',
    steps: [
      '唇を軽く閉じ、息で「ぷるるる」と震わせる',
      '震えを保ったまま「ドレミファソファミレド」を上下',
      '震えが止まる所は息が弱い or 喉に力が入っているサイン',
    ],
    point: '喉の余計な力を抜き、息の流れを一定にします。揺れ・力み・高音の苦しさ全般に効きます。',
  },
  straw: {
    name: 'ストロー発声',
    time: '3分',
    steps: [
      '細めのストローをくわえ、ストローを通して「うー」と声を出す',
      'そのまま低い音から高い音へサイレンのように上下',
      '最後にストローを外して同じ感覚で「あー」',
    ],
    point: '声帯がきれいに閉じる感覚が身につき、息漏れ（かすれ）が減って声の芯が出ます。',
  },
  attack: {
    name: '「狙って置く」発声',
    time: '5分',
    steps: [
      '練習モードで目標の音を鳴らし、一度頭の中で鳴らす',
      '息を吸ったら、下からすくわずに「ア」と一発でその音に入る',
      'ズレ表示が最初の 0.1 秒で真ん中に来れば成功。10 回連続を目指す',
      '慣れたら「ド→ミ」「ド→ソ」の跳躍でも同じことを',
    ],
    point: 'しゃくりは“味”にもなりますが、毎回だと音程が甘く聞こえます。まず「真っ直ぐ入れる」選択肢を持つのが大事。',
  },
  messa: {
    name: 'メッサ・ディ・ヴォーチェ（小→大→小）',
    time: '4分',
    steps: [
      '楽な高さで「あー」を 8 秒伸ばす',
      '最初の 4 秒で小さい声からだんだん大きく、次の 4 秒でだんだん小さく',
      '音量が変わっても音の高さが動かないように',
    ],
    point: '音量を「意図して」変えられるようになり、抑揚と息のコントロールが同時に鍛えられます。',
  },
  phraseEnd: {
    name: '語尾キープ練習',
    time: '3分',
    steps: [
      '歌のフレーズの最後の音だけを取り出して「あー」で伸ばす',
      '最後まで同じ高さを保ち、音量だけをすっと小さくして終える',
      '終わる瞬間に息を「止める」のではなく「そっと離す」イメージ',
    ],
    point: '語尾が下がると“投げやり”“疲れている”ように聞こえます。最後の 0.2 秒を丁寧にするだけで印象が大きく変わります。',
  },
  breath: {
    name: 'ロングブレス（スー）',
    time: '3分',
    steps: [
      '鼻から 4 秒吸い、歯の隙間から「スーーー」と一定の強さで吐く',
      '20 秒以上、息の音量が揺れないように',
      '慣れたら「スー」を「ズー」（声あり）に変える',
    ],
    point: '支えの安定＝声の安定。音量のムラやロングトーンの揺れの根本改善になります。',
  },
  vibrato: {
    name: 'ビブラート・パルス練習',
    time: '5分',
    steps: [
      'メトロノームを ♩=90 に設定',
      '「あ・あ・あ」と音程を少しだけ上下させ、1 拍に 3 回揺らす',
      '1 拍 4 回 → 1 拍 5 回と速くし、最後はメトロノームを止めて自然な揺れに',
      '揺れ幅は半音より小さく（練習モードの表示で ±30〜50 セント程度）',
    ],
    point: '理想のビブラートは 1 秒に 5〜7 回、揺れ幅は控えめ。速さと幅を自分でコントロールできるようにします。',
  },
  interval: {
    name: '跳躍インターバル',
    time: '4分',
    steps: [
      '「ド→ソ→ド」「ド→高いド→ド」を「あ」で歌う',
      '移る瞬間は素早く、着地した音はまっすぐ',
      '練習モードで着地の瞬間のズレを確認',
    ],
    point: '音と音の移動をスムーズにし、ずり上げ・行き過ぎを減らします。',
  },
  yawn: {
    name: 'あくび喉＋ハミング',
    time: '3分',
    steps: [
      'あくびの始まりの形（喉の奥が広い状態）を作る',
      'その形のまま口を閉じ「んー」とハミングで 5 音スケール',
      '鼻の付け根〜頬骨あたりが振動するのを感じたら「んーあー」と口を開ける',
    ],
    point: '喉を開いて共鳴させることで、こもらず・キンキンしない“通る声”になります。',
  },
  softHigh: {
    name: '高音を小さく出す練習',
    time: '4分',
    steps: [
      '曲のいちばん高いフレーズを、半分くらいの音量で歌う',
      '裏声まじりでも OK。喉が締まらない感覚を優先',
      '慣れたら少しずつ音量を戻す（音量を上げても喉の感覚は同じまま）',
    ],
    point: '高音を「力で押す」癖があると、声が硬く音程も上がりきりません。小さく出せる高音は、大きくしても楽に響きます。',
  },
  listenRef: {
    name: 'お手本と聴き比べ',
    time: '5分',
    steps: [
      '結果の「メロディ違い」の箇所をタップして自分の声を聞く',
      'お手本（原曲）の同じ箇所を 3 回聴き、音の上がり下がりを指でなぞる',
      '歌詞をつけずに「ラ」でその部分だけ歌い、音が合ったら歌詞をつける',
    ],
    point: '音程の“取り違え”は、声の問題ではなく「覚え方」の問題です。正しく覚え直すだけで一気に良くなります。',
  },
  rhythm: {
    name: 'リズム練習（手拍子＋発声）',
    time: '5分',
    steps: [
      '原曲を流しながら、2・4 拍目で手拍子',
      '手拍子を続けたまま、歌詞を「リズムだけ」で話すように言う',
      '最後にメロディをつけて歌う。言葉の頭を拍の頭に「置く」意識で',
    ],
    point: 'リズムが合うと、音程が少し甘くても上手く聞こえます。体でビートを感じるのが近道です。',
  },
  listen: {
    name: '聞き返し',
    time: '5分',
    steps: [
      '結果画面の「気になった箇所」をタップして自分の声を聞く',
      '良かった箇所と聞き比べて、何が違うかを言葉にする',
      '同じ箇所だけを 3 回歌い直して録音',
    ],
    point: '上手い人ほど自分の声を客観的に聞いています。耳が育つと上達が一気に速くなります。',
  },
};

const EVENT_LABELS = {
  pitch: '音程ズレ',
  wobble: 'ロングトーンの揺れ',
  scoop: 'しゃくり',
  glide: 'ずり上げ',
  fall: '語尾の下がり',
  spike: '音量の急変',
  strain: '高音の苦しさ',
  vibrato: 'ビブラートの癖',
  good: '良いロングトーン',
  melody: 'メロディ違い',
  timing: 'タイミング',
};

export function eventLabel(e) {
  const base = EVENT_LABELS[e.type] || e.type;
  if (e.type === 'pitch') return `${base}（${e.value > 0 ? '+' : ''}${r0(e.value)}c ${e.value > 0 ? '高め' : '低め'}）`;
  if (e.type === 'wobble') return `${base}（${r0(e.value)}c）`;
  if (e.type === 'scoop') return `${base}（${r0(e.value.approach * 1000)}ms かけて到達）`;
  if (e.type === 'spike') return `${base}（${e.value > 0 ? '急に大きく' : '一瞬抜ける'}）`;
  if (e.type === 'vibrato') return `${base}（${r1(e.value.rate)}回/秒・±${r0(e.value.extent)}c）`;
  if (e.type === 'melody') return `${base}（お手本より${e.value > 0 ? '高い' : '低い'} ${Math.abs(e.value).toFixed(1)} 半音）`;
  if (e.type === 'timing') return `${e.value > 0 ? '遅れ' : '早い'}（${r0(Math.abs(e.value) * 1000)}ms）`;
  return base;
}

/** type の事例を最大 n 件、深刻度順→時刻順で */
function examples(events, types, n = 3) {
  return events
    .filter((e) => types.includes(e.type))
    .sort((a, b) => b.sev - a.sev || a.t - b.t)
    .slice(0, n)
    .sort((a, b) => a.t - b.t)
    .map((e) => ({ t: e.t, tEnd: e.tEnd, label: eventLabel(e), type: e.type }));
}

/**
 * m: analyzeFrames の結果, s: scoreMetrics の結果
 * 戻り値: { label, summary, strengths[], issues[], menu[], goals[], notes[] }
 */
export function buildCoaching(m, s) {
  if (s.insufficient) {
    return {
      label: { rank: '—', text: '判定できませんでした' },
      summary: '歌声がほとんど検出できませんでした。マイクが口元にあるか、入力レベル（マイクチェック）を確認して、1 フレーズ以上歌ってからもう一度試してみてください。',
      strengths: [],
      issues: [],
      menu: [],
      goals: [],
      notes: levelNotes(m),
    };
  }
  const cat = Object.fromEntries(s.categories.map((c) => [c.id, c]));
  const sc = (id) => cat[id]?.score;
  const issues = [];
  const strengths = [];
  const notes = [];
  const ev = m.events;

  // ---------- 音程 ----------
  const p = m.pitch;
  if (Number.isFinite(sc('pitch'))) {
    if (sc('pitch') >= 88) {
      strengths.push({
        cat: 'pitch',
        title: '音程が正確',
        detail: `1 音 1 音の高さのズレが平均 ${r0(p.meanAbsDev)} セントと小さく、${pct(p.hitRate)} の音がほぼピッタリ（±20 セント以内）でした。聞いていて安心感があります。`,
      });
    } else {
      const highFlat = m.high.available && m.high.signedDevHigh < -12;
      issues.push({
        cat: 'pitch',
        title: '音程の精度',
        detail:
          `音の高さのズレが平均 ${r0(p.meanAbsDev)} セント（半音の ${r0(p.meanAbsDev)}%）ありました。` +
          `ピッタリ（±20 セント以内）に入った音は ${pct(p.hitRate)}。` +
          (m.key.inScale < 0.85 ? `また、曲のキー（${m.key.name}）から外れた音が ${pct(1 - m.key.inScale)} あり、半音単位で音を取り違えている箇所がありそうです。` : '') +
          (highFlat ? '特に高い音が低めに外れる傾向（ぶら下がり）があります。' : ''),
        why: '音程のズレは聞き手が最も敏感に「違和感」を覚えるポイントです。15 セントを超えるズレが続くと、多くの人が「なんとなく不安定」と感じ始めます。',
        tip: highFlat
          ? '高い音は「下から届かせる」のではなく「上から置く」イメージで。目標の音より少し上を狙うくらいでちょうど良くなります。'
          : '伸ばす音の「入ってから 0.3 秒」を特に意識して、正しい高さに素早く合わせましょう。原曲を聴きながら、伸ばす音だけを「あー」で合わせる練習が効果的です。',
        drills: ['scale', 'longtone', 'interval'],
        examples: examples(ev, ['pitch'], 4),
        loss: lossOf(cat.pitch),
      });
    }
    if (p.drift && Math.abs(p.drift.total) >= 50) {
      notes.push(`曲の最初と最後で全体の音程が ${r0(Math.abs(p.drift.total))} セント${p.drift.total < 0 ? '下がって' : '上がって'}いました（伴奏なしだと起きやすい現象です）。伴奏を聴きながら歌うと改善しやすいです。`);
    }
  }

  // ---------- 安定感 ----------
  const st = m.stability;
  if (Number.isFinite(sc('stability'))) {
    if (sc('stability') >= 88) {
      strengths.push({
        cat: 'stability',
        title: 'ロングトーンが安定',
        detail: `伸ばす音の揺れが平均 ${r0(st.pitchInstability)} セントと小さく、まっすぐ伸びています。息の支えができている証拠です。`,
      });
    } else {
      const loud = st.loudWobble > 1.6;
      issues.push({
        cat: 'stability',
        title: '伸ばす音の揺れ',
        detail:
          `伸ばしている音の高さが平均 ${r0(st.pitchInstability)} セント揺れていました（ビブラートは除いて計算）。` +
          (Math.abs(st.intraNoteDrift) > 15 ? `伸ばしている途中で ${r0(st.intraNoteDrift)} セントほど高さが${st.intraNoteDriftSigned < -8 ? '下がっていく' : st.intraNoteDriftSigned > 8 ? '上がっていく' : '動く'}傾向があります。` : '') +
          (loud ? '音量も細かく揺れていて、息の流れが一定でない様子です。' : ''),
        why: '意図しない揺れは「自信がなさそう」「頼りない」印象を与えます。逆にまっすぐ伸びる声は、それだけで上手く聞こえます。',
        tip: '伸ばす音の後半ほど、お腹（みぞおちの下）で息を“ゆっくり押し出し続ける”意識を。息が減ってくると音が下がりやすくなります。',
        drills: loud ? ['breath', 'longtone'] : ['longtone', 'lipRoll'],
        examples: examples(ev, ['wobble'], 3),
        loss: lossOf(cat.stability),
      });
    }
  }

  // ---------- 声質 ----------
  const tn = m.tone;
  if (Number.isFinite(sc('tone'))) {
    const breathy = tn.hnr < 8;
    const dull = tn.ring < -24;
    const shrill = tn.ring > -5;
    if (sc('tone') >= 88) {
      strengths.push({
        cat: 'tone',
        title: '声に芯がある',
        detail: `声の明瞭さ（倍音と雑音の比）が ${r1(tn.hnr)} dB と高く、クリアで芯のある声です。`,
      });
    } else {
      issues.push({
        cat: 'tone',
        title: breathy ? '声のかすれ・息漏れ' : dull ? '声のこもり' : shrill ? '声が硬い・キンキンする' : '声の響き',
        detail: breathy
          ? `声の明瞭さ（倍音と雑音の比）が ${r1(tn.hnr)} dB で、息が多く混じったかすれ気味の声でした。`
          : dull
            ? '高い周波数の響き（声の“通り”を生む成分）が少なく、こもって聞こえやすい声でした。'
            : shrill
              ? '高い周波数が強すぎて、硬く刺さる印象の声になっていました。喉が締まっている可能性があります。'
              : `声の明瞭さは ${r1(tn.hnr)} dB。もう少し芯と響きが出ると、ぐっと聞きやすくなります。`,
        why: breathy
          ? 'ウィスパー的な表現として使うのは良いのですが、ずっと息が多いと言葉が聞き取りにくく、音程も甘く聞こえます。'
          : '声の響きは“聞き心地”を大きく左右します。同じ音程でも、響く声は上手く、こもった声・硬い声は素人っぽく聞こえます。',
        tip: breathy
          ? '声帯をしっかり閉じる感覚を。「ん」の口で軽くハミングしてから「あ」に開くと、息漏れの少ない声が出しやすくなります。'
          : dull
            ? '口の中（奥）を縦に広げ、声を顔の前に飛ばすイメージで。口角を少し上げると明るい響きになります。'
            : shrill
              ? '喉の力を抜き、あくびの喉で。大きい声を出そうとせず、響きで遠くに届ける意識を持ちましょう。'
              : '声を出す前に軽くハミングして、鼻の付け根に響きが集まる感覚をつかんでから歌い出しましょう。息を「声に変える」効率を上げると芯が出ます。',
        drills: breathy ? ['straw', 'yawn'] : shrill ? ['lipRoll', 'yawn'] : ['yawn', 'straw'],
        examples: [],
        loss: lossOf(cat.tone),
      });
    }
    if (Number.isFinite(tn.hf) && tn.hf > -15) notes.push('サ行や息の音（5kHz 以上の成分）がやや強めに入っています。マイクと口の距離を少し離すか、息の量を抑えると聞きやすくなります。');
  }

  // ---------- 入り・つなぎ ----------
  const on = m.onset;
  if (Number.isFinite(sc('onset'))) {
    if (sc('onset') >= 88) {
      strengths.push({
        cat: 'onset',
        title: '音の入りがクリーン',
        detail: `フレーズの歌い出しで狙った音にすっと入れています（到達まで中央値 ${r0((on.median || 0) * 1000)}ms）。`,
      });
    } else {
      const scoopy = on.scoopRatio >= 0.2;
      issues.push({
        cat: 'onset',
        title: scoopy ? 'しゃくり（下からすくう入り）が多い' : '音の移動・入りの甘さ',
        detail:
          (scoopy ? `歌い出しの ${pct(on.scoopRatio)} で、音の下からずり上げて入っていました（目標の音に着くまで中央値 ${r0(on.median * 1000)}ms）。` : '') +
          (on.slowGlideRatio >= 0.15 ? `音が大きく跳ぶところの ${pct(on.slowGlideRatio)} で、移動がゆっくり（0.2 秒以上）でした。` : '') +
          (on.overshootRatio >= 0.15 ? `跳躍の着地で目標を行き過ぎる癖（${pct(on.overshootRatio)}）もあります。` : ''),
        why: 'しゃくりはプロも“味付け”で使いますが、ほぼ毎回だと「音程が甘い」「クセが強い」と聞こえます。使う場所を選ぶと一気に洗練されます。',
        tip: '息を吸った瞬間に、次の音の高さを頭の中で鳴らしておくこと。「探しながら出す」のではなく「決めてから出す」を習慣に。',
        drills: ['attack', 'interval'],
        examples: examples(ev, ['scoop', 'glide'], 4),
        loss: lossOf(cat.onset),
      });
    }
  }

  // ---------- 抑揚 ----------
  const dy = m.dynamics;
  if (Number.isFinite(sc('dynamics'))) {
    const monotone = (dy.phraseRangeMed < 3.5 || dy.phraseLevelStd < 1.0) && dy.spikeRate < 4;
    if (sc('dynamics') >= 88) {
      strengths.push({
        cat: 'dynamics',
        title: '抑揚が自然',
        detail: `フレーズの中で ${r1(dy.phraseRangeMed)} dB ほどの自然な強弱があり、急な音量の乱れもほとんどありません。`,
      });
    } else {
      issues.push({
        cat: 'dynamics',
        title: monotone ? '抑揚が少ない（一本調子）' : '音量のコントロール',
        detail: monotone
          ? `フレーズ内の強弱の幅が ${r1(dy.phraseRangeMed)} dB、フレーズ間の差も ${r1(dy.phraseLevelStd)} dB と小さく、平坦な印象です。`
          : `伸ばす音の途中で急に大きくなったり抜けたりする箇所が 1 分あたり ${r1(dy.spikeRate)} 回ありました。` +
            (dy.pitchLoud > 0.7 ? '高い音ほど大きくなる（力で押し上げる）傾向も強めです。' : ''),
        why: monotone
          ? '音程が合っていても、強弱がないと感情が伝わりにくく「上手いけど心に響かない」歌になりがちです。'
          : '意図しない音量の飛びは、聞き手に「びっくり」「耳が疲れる」感覚を与えます。',
        tip: monotone
          ? 'サビ前の A メロは 6 割、サビは 9 割、のように歌詞の意味に合わせて音量の“地図”を作ってみましょう。1 フレーズの中でも、言葉の頭を少し強く、語尾を少し弱くすると自然な抑揚になります。'
          : '音量は「喉」ではなく「息の量」で変えるイメージで。大きく出す時ほど喉はリラックス。',
        drills: monotone ? ['messa', 'listen'] : ['messa', 'breath'],
        examples: examples(ev, ['spike'], 3),
        loss: lossOf(cat.dynamics),
      });
    }
  }

  // ---------- 語尾 ----------
  const en = m.endings;
  if (Number.isFinite(sc('phrase'))) {
    if (sc('phrase') >= 88) {
      strengths.push({ cat: 'phrase', title: '語尾が丁寧', detail: 'フレーズの終わりで音程が落ちず、最後まで丁寧に歌えています。' });
    } else {
      issues.push({
        cat: 'phrase',
        title: '語尾が下がる',
        detail: `フレーズの終わり ${en.count} 箇所のうち ${pct(en.fallRatio)} で、最後の音の高さが下がって終わっていました。`,
        why: '語尾の音程落ちは、日本語の話し言葉の癖がそのまま出たもの。聞き手には「投げやり」「息切れ」に聞こえてしまいます。',
        tip: '最後の音は「音程はキープ、音量だけフェードアウト」。フレーズの最後まで息を残しておく配分も大切です。',
        drills: ['phraseEnd', 'breath'],
        examples: examples(ev, ['fall'], 4),
        loss: lossOf(cat.phrase),
      });
    }
  }

  // ---------- ビブラート ----------
  const vb = m.vibrato;
  if (Number.isFinite(sc('vibrato'))) {
    if (vb.count === 0) {
      if (vb.candidates < 4) notes.push(`伸ばす音（${vb.candidates} 箇所）でビブラートは検出されませんでした。ストレートな歌い方も魅力ですが、ロングトーンの後半に軽くかけられると表現の幅が広がります。`);
      else {
        issues.push({
          cat: 'vibrato',
          title: 'ビブラートで余韻を',
          detail: `伸ばす音が ${vb.candidates} 箇所ありましたが、ビブラートはかかっていませんでした。`,
          why: 'まっすぐな音は清潔感がありますが、長い音がすべてストレートだと少し硬く聞こえます。自然なビブラートは余韻と温かみを生みます。',
          tip: 'まずは「まっすぐ伸ばす → 最後の 1 秒だけ揺らす」から。無理に揺らすより、喉の力が抜けると自然にかかります。',
          drills: ['vibrato', 'lipRoll'],
          examples: [],
          loss: lossOf(cat.vibrato),
        });
      }
    } else if (sc('vibrato') >= 85) {
      strengths.push({
        cat: 'vibrato',
        title: '自然なビブラート',
        detail: `ビブラートが 1 秒に ${r1(vb.rate)} 回・揺れ幅 ±${r0(vb.extent)} セントと、聞き心地の良い範囲に収まっています（ロングトーンの ${pct(vb.ratio)} で使用）。`,
      });
    } else {
      const fast = vb.rate > 7.2;
      const slow = vb.rate < 4.6;
      const wide = vb.extent > 90;
      const narrow = vb.extent < 18;
      let kind = 'ビブラートの質';
      if (fast && narrow) kind = 'ちりめんビブラート（細かく速い）';
      else if (fast) kind = 'ビブラートが速すぎる';
      else if (slow && wide) kind = 'ビブラートがうねる（遅く深い）';
      else if (wide) kind = 'ビブラートの揺れ幅が大きすぎる';
      else if (slow) kind = 'ビブラートが遅い';
      issues.push({
        cat: 'vibrato',
        title: kind,
        detail: `ビブラートは 1 秒に ${r1(vb.rate)} 回、揺れ幅 ±${r0(vb.extent)} セントでした（心地よい目安は 5〜7 回・±25〜70 セント）。`,
        why: fast
          ? '速く細かい揺れは喉の緊張から来ることが多く、「震えている」「ヤギの声」のように聞こえてしまいます。'
          : '遅く大きな揺れは音程があいまいになり、演歌的・大げさな印象や「音程が不安定」と感じさせます。',
        tip: fast ? '喉で揺らそうとせず、力を抜いてゆったり。まずは揺らさずまっすぐ伸ばせる状態を作ってから。' : '揺れ幅を半分にするイメージで。メトロノームで速さを整える練習が有効です。',
        drills: ['vibrato', 'longtone'],
        examples: examples(ev, ['vibrato'], 3),
        loss: lossOf(cat.vibrato),
      });
    }
  }

  // ---------- 高音 ----------
  const hi = m.high;
  if (Number.isFinite(sc('high'))) {
    if (sc('high') >= 88) {
      strengths.push({
        cat: 'high',
        title: '高音に余裕がある',
        detail: `${midiNameJa(hi.threshold)}（${midiName(hi.threshold)}）より上の音でも、声質・音程が崩れていません。`,
      });
    } else {
      issues.push({
        cat: 'high',
        title: '高音で力んでいる',
        detail:
          `${midiNameJa(hi.threshold)}（${midiName(hi.threshold)}）より上の音で、` +
          [
            hi.hnrDrop > 3 ? `声の明瞭さが ${r1(hi.hnrDrop)} dB 落ち（かすれ・締まり）` : null,
            hi.signedDevHigh < -12 ? `音程が ${r0(-hi.signedDevHigh)} セント低め` : null,
            hi.loudJump > 7 ? `音量が ${r1(hi.loudJump)} dB 跳ね上がる（張り上げ）` : null,
          ]
            .filter(Boolean)
            .join('、') +
          'という傾向がありました。',
        why: '高音で苦しそうな声は、聞き手にも緊張が伝わってしまいます。“楽そうに出ている高音”こそが上手さの象徴です。',
        tip: '高音ほど「口を縦に開け、喉は下げたまま、息は少なめ」。キーを 1〜2 つ下げて楽に歌える状態で練習するのも立派な戦略です。',
        drills: ['softHigh', 'lipRoll'],
        examples: examples(ev, ['strain'], 3),
        loss: lossOf(cat.high),
      });
    }
  }

  // ---------- お手本比較 ----------
  const rf = m.reference;
  if (rf && rf.available) {
    const melOk = rf.melodyScore >= 88;
    if (melOk) {
      strengths.push({
        cat: 'melody',
        title: 'お手本どおりのメロディ',
        detail: `お手本と比べて ${pct(rf.melodyMatch)} の区間で同じ音程（±50 セント以内）を歌えています（${shiftLabel(rf.shift)}）。`,
      });
    } else {
      issues.push({
        cat: 'melody',
        title: 'メロディの取り違え',
        detail: `お手本と比べた音程の一致率は ${pct(rf.melodyMatch)}（${shiftLabel(rf.shift)}として比較）。${rf.wrong.length} 箇所で、お手本と半音以上違う音を歌っていました。`,
        why: '声がきれいでも、メロディが違うと聞き手はすぐに「あれ？」と感じます。原曲を知っている人ほど気になるポイントです。',
        tip: '間違えやすい箇所は、歌詞をつけずに「ラ」で音だけ確かめてから歌いましょう。',
        drills: ['listenRef', 'interval'],
        examples: examples(ev, ['melody'], 4),
        loss: (100 - rf.melodyScore) * 24 * 0.65,
      });
    }
    const tm = rf.timing;
    if (tm) {
      const late = tm.medianLag > 0.08, early = tm.medianLag < -0.08, loose = tm.spread > 0.11;
      if (!late && !early && !loose) {
        strengths.push({ cat: 'melody', title: 'リズムが正確', detail: `歌い出しのタイミングがお手本とほぼ一致しています（平均 ${r0(Math.abs(tm.medianLag) * 1000)}ms、ばらつき ${r0(tm.spread * 1000)}ms）。` });
      } else {
        issues.push({
          cat: 'melody',
          title: late ? 'リズムがもたる（遅れ気味）' : early ? 'リズムが走る（早め）' : 'タイミングのばらつき',
          detail:
            (late || early ? `歌い出しがお手本より平均 ${r0(Math.abs(tm.medianLag) * 1000)}ms ${late ? '遅れて' : '早く'}います。` : '') +
            (loose ? `タイミングのばらつきが ${r0(tm.spread * 1000)}ms あります。` : ''),
          why: 'リズムのズレは伴奏との“一体感”を壊し、聞き手に落ち着かない印象を与えます。',
          tip: late
            ? '言葉の子音を拍より少しだけ前に出すイメージで。母音が拍の頭に来るように。'
            : early
              ? '伴奏をよく聴いて、焦らず「置いていく」ように。ブレスの位置を決めておくと走りにくくなります。'
              : '伴奏のドラム（特にスネア）を聴きながら、体でリズムを取って歌いましょう。',
          drills: ['rhythm', 'listenRef'],
          examples: examples(ev, ['timing'], 4),
          loss: (100 - (rf.rhythmScore || 70)) * 24 * 0.35,
        });
      }
    }
    if (rf.coverage < 0.8) notes.push(`お手本が歌っている部分のうち、あなたが声を出していたのは ${pct(rf.coverage)} でした（歌詞が出てこなかった・ブレスが長い箇所がありそうです）。`);
    notes.push(`お手本比較：${shiftLabel(rf.shift)}で歌ったと判定${rf.synced ? '（伴奏と同じ時間軸で比較）' : '（時間軸を自動で合わせて比較）'}。`);
  } else if (rf && !rf.available) {
    notes.push('お手本との比較ができませんでした（歌声またはお手本が短すぎる可能性があります）。');
  }

  issues.sort((a, b) => b.loss - a.loss);
  const topIssues = issues.slice(0, 4);
  // 上手な人向け：改善点が少なければ、低めの項目から「さらに磨く」提案を追加
  if (topIssues.length < 2) {
    const have = new Set(topIssues.map((x) => x.cat));
    const cands = s.categories
      .filter((c) => c.score != null && c.score < 98 && !have.has(c.id) && POLISH[c.id])
      .sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight);
    for (const c of cands.slice(0, 2 - topIssues.length)) {
      const p = POLISH[c.id];
      topIssues.push({ cat: c.id, polish: true, title: p.title, detail: p.detail(m), why: p.why, tip: p.tip, drills: p.drills, examples: [], loss: lossOf(c) });
    }
  }
  const catOrder = Object.fromEntries(s.categories.map((c) => [c.id, c.score ?? 0]));
  strengths.sort((a, b) => catOrder[b.cat] - catOrder[a.cat]);

  // 練習メニュー（改善点の上位から重複なく 3 つ＋聞き返し）
  const menu = [];
  for (const is of topIssues) {
    for (const d of is.drills) {
      if (!menu.includes(d) && menu.length < 3) {
        menu.push(d);
        break;
      }
    }
  }
  if (menu.length < 3) for (const is of topIssues) for (const d of is.drills) if (!menu.includes(d) && menu.length < 3) menu.push(d);
  if (!menu.includes('listen')) menu.push('listen');

  const label = scoreLabel(s.total);
  const summary = composeSummary(m, s, strengths, topIssues, label);
  const goals = composeGoals(m, topIssues);

  const range = Number.isFinite(m.range.lowest)
    ? `今回の音域：${midiNameJa(m.range.lowest)}（${midiName(m.range.lowest)}）〜 ${midiNameJa(m.range.highest)}（${midiName(m.range.highest)}）`
    : null;
  if (range) notes.unshift(range);
  if (m.key.name && m.key.name !== '判定不能') notes.unshift(`推定キー：${m.key.name}${m.key.modulations ? `（途中で転調あり）` : ''}`);
  notes.unshift(...levelNotes(m));
  if (s.reliability < 0.6) notes.unshift('⚠ 歌っている時間が短いため、今回の評価はブレが大きい可能性があります。1 コーラス（1 分以上）歌うのがおすすめです。');

  return { label, summary, strengths: strengths.slice(0, 4), issues: topIssues, menu: menu.map((id) => ({ id, ...DRILLS[id] })), goals, notes };
}

/** 入力レベルに関する注意 */
function levelNotes(m) {
  const out = [];
  const lv = m.levels && m.levels.singLevel;
  if (Number.isFinite(lv) && lv > -4) out.push('⚠ 入力が大きすぎて音が割れている可能性があります。マイクを口から少し離すと、声質の判定が正確になります。');
  else if (Number.isFinite(lv) && lv < -48) out.push('⚠ 入力がかなり小さめです。マイクを口元に近づけると、より正確に判定できます。');
  if (m.levels && Number.isFinite(m.levels.noiseFloor) && Number.isFinite(lv) && lv - m.levels.noiseFloor < 20) out.push('⚠ 周りの雑音が大きめです。静かな場所で歌うと判定が安定します。');
  return out;
}

// 上手な人向けの「さらに磨く」提案
const POLISH = {
  pitch: {
    title: '音程の精度をもう一段上げる',
    detail: (m) => `平均ズレ ${r0(m.pitch.meanAbsDev)} セントは十分に良い水準です。プロの安定した歌唱は 10 セント前後まで詰まっています。`,
    why: '“正確さ”が極まると、声を張らなくても説得力が出ます。',
    tip: '短い音（8 分音符など）の高さこそ丁寧に。速いフレーズだけを抜き出してゆっくり歌う練習が効きます。',
    drills: ['interval', 'longtone'],
  },
  stability: {
    title: 'ロングトーンをさらに真っ直ぐに',
    detail: (m) => `伸ばす音の揺れは ${r0(m.stability.pitchInstability)} セント。十分安定していますが、最後の 1 秒でわずかに動く傾向があります。`,
    why: '伸ばしきった最後の瞬間の安定感が、歌全体の「余裕」の印象を決めます。',
    tip: '音を切る直前まで息の支えを保ち、音量だけを減らしていくイメージで。',
    drills: ['longtone', 'breath'],
  },
  tone: {
    title: '声の響きを磨く',
    detail: (m) => `声の明瞭さ ${r1(m.tone.hnr)} dB。ここが上がると、同じ音量でもより遠くまで届く声になります。`,
    why: '響きのある声は、小さな音量でも「上手い」と感じさせます。',
    tip: '口の奥を縦に開けたまま、息を声に変える効率を上げる意識で。',
    drills: ['yawn', 'straw'],
  },
  onset: {
    title: '音の入りを使い分ける',
    detail: (m) => `歌い出しで音に届くまで中央値 ${r0((m.onset.median || 0) * 1000)}ms。しゃくりは ${pct(m.onset.scoopRatio)}。`,
    why: 'すっと入る音と、あえてすくう音を使い分けられると表現力が一段上がります。',
    tip: '歌詞の意味が強い所だけしゃくる、など「入り方の設計」をしてみましょう。',
    drills: ['attack'],
  },
  dynamics: {
    title: '抑揚をもっと大胆に',
    detail: (m) => `フレーズ内の強弱の幅は ${r1(m.dynamics.phraseRangeMed)} dB。もう少し大胆に差をつけても良さそうです。`,
    why: '強弱の差は、聞き手の感情を動かす一番の道具です。',
    tip: 'A メロは語りかけるように小さく、サビで開放する、というコントラストを意識して。',
    drills: ['messa', 'listen'],
  },
  phrase: {
    title: '語尾の表情をつける',
    detail: () => '語尾は丁寧に処理できています。',
    why: '語尾の抜き方・残し方に個性が出ます。',
    tip: '同じ語尾でも「すっと抜く」「少し長めに残す」を歌詞に合わせて使い分けてみましょう。',
    drills: ['phraseEnd'],
  },
  vibrato: {
    title: 'ビブラートの表現を広げる',
    detail: (m) => (m.vibrato.count ? `ビブラートは ${r1(m.vibrato.rate)} 回/秒・±${r0(m.vibrato.extent)} セント。` : 'ロングトーンはストレートに歌えています。'),
    why: 'ビブラートのかけ始めのタイミングや深さの変化で、余韻の表情が変わります。',
    tip: 'まっすぐ伸ばしてから後半だけかける「ディレイド・ビブラート」を試してみましょう。',
    drills: ['vibrato'],
  },
  high: {
    title: '高音をさらに楽に',
    detail: () => '高音でも大きく崩れてはいません。',
    why: '“楽そうな高音”は、聞き手に安心感と爽快感を与えます。',
    tip: '高音ほど息を増やすのではなく、響きを上に集める意識で。',
    drills: ['softHigh'],
  },
};

function lossOf(c) {
  return c && c.score != null ? (100 - c.score) * c.weight : 0;
}

function composeSummary(m, s, strengths, issues, label) {
  const lines = [];
  const t = s.total;
  if (t >= 95) lines.push('素晴らしい！聞いていて心地よく、思わず聴き入ってしまう歌声です。');
  else if (t >= 88) lines.push('とても上手です。安心して聴ける、完成度の高い歌でした。');
  else if (t >= 80) lines.push('上手に歌えています。いくつかのポイントを整えると、一段上の「聴かせる歌」になります。');
  else if (t >= 70) lines.push('良い土台があります。改善ポイントがはっきりしているので、練習の効果が出やすい段階です。');
  else lines.push('歌ってくれてありがとう！伸びしろがたくさんあります。一つずつ一緒に直していきましょう。');

  if (strengths.length) lines.push(`特に「${strengths[0].title}」という点は大きな武器です。`);
  const real = issues.filter((x) => !x.polish);
  if (real.length) {
    const top = real[0];
    lines.push(`今いちばん聞き心地に影響しているのは「${top.title}」。${top.tip}`);
    if (real.length > 1) lines.push(`次に「${real[1].title}」を意識すると、さらに良くなります。`);
  } else if (issues.length) {
    lines.push(`さらに上を目指すなら「${issues[0].title}」。${issues[0].tip}`);
  }
  return lines.join('');
}

function composeGoals(m, issues) {
  const goals = [];
  for (const is of issues.slice(0, 3)) {
    switch (is.cat) {
      case 'pitch':
        goals.push(`音程のズレを平均 ${r0(m.pitch.meanAbsDev)}c → ${r0(Math.max(8, m.pitch.meanAbsDev * 0.8))}c に`);
        break;
      case 'stability':
        goals.push(`ロングトーンの揺れを ${r0(m.stability.pitchInstability)}c → ${r0(Math.max(5, m.stability.pitchInstability * 0.75))}c に`);
        break;
      case 'onset':
        goals.push(`しゃくりの割合を ${pct(m.onset.scoopRatio)} → ${pct(Math.max(0.05, m.onset.scoopRatio * 0.6))} に`);
        break;
      case 'phrase':
        goals.push(`語尾が下がる割合を ${pct(m.endings.fallRatio)} → ${pct(Math.max(0.05, m.endings.fallRatio * 0.5))} に`);
        break;
      case 'dynamics':
        goals.push('サビと A メロで音量の差をはっきりつける');
        break;
      case 'tone':
        goals.push(`声の明瞭さ（HNR）を ${r1(m.tone.hnr)}dB → ${r1(m.tone.hnr + 1.5)}dB に`);
        break;
      case 'vibrato':
        if (m.vibrato.count === 0) goals.push('ロングトーンの最後に 5〜7 回/秒のビブラートをかける');
        else goals.push(`ビブラートを ${r1(m.vibrato.rate)} 回/秒・±${r0(m.vibrato.extent)}c → 5〜7 回/秒・±70c 以内に`);
        break;
      case 'high':
        goals.push('いちばん高いフレーズを、喉を締めずに歌う');
        break;
      case 'melody':
        if (is.title.includes('メロディ')) goals.push(`お手本とのメロディ一致率を ${pct(m.reference.melodyMatch)} → ${pct(Math.min(0.95, m.reference.melodyMatch + 0.1))} に`);
        else goals.push('歌い出しのタイミングをお手本に合わせる（ズレ 80ms 以内）');
        break;
    }
  }
  return goals;
}

export { fmtTime };
