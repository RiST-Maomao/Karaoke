// 練習タブ：チューナー／ロングトーン／音の入り（アタック）練習
import { app, startLive, stopLive } from '../app.js';
import { h, fitCanvas, cssVar, devColor, toast } from '../ui/dom.js';
import { hzToMidi, midiToHz, midiName, midiNameJa } from '../analysis/music.js';
import { pl, std, mean } from '../analysis/stats.js';
import { micErrorText } from './sing.js';
import * as store from '../storage.js';

export async function renderPractice(main, params, state = {}) {
  const eng = app.engine;
  const prefs = (await store.getKV('practice', null)) || { target: 57, useTarget: false, mode: 'longtone' };
  let { target, useTarget, mode } = prefs;
  // 結果画面から「この音を練習」で来た場合
  if (state && Number.isFinite(state.target)) {
    target = state.target;
    useTarget = true;
    mode = state.mode || mode;
  }
  const save = () => store.setKV('practice', { target, useTarget, mode }).catch(() => {});

  let live = false;
  const hist = []; // {t, cents(対象音からのズレ), m}
  let cur = null; // 継続中の発声
  let silentFrames = 0;
  const trials = [];

  // ---------- UI ----------
  const noteEl = h('div.note', '—');
  const noteJa = h('div.note-ja', '声を出してください');
  const centsEl = h('div.cents', '');
  const canvas = h('canvas');
  const targetVal = h('div.val');
  const statDur = h('div.v', '—');
  const statDurLabel = h('div.k', mode === 'attack' ? '到達時間' : '伸ばした時間');
  const statMean = h('div.v', '—');
  const statStab = h('div.v', '—');
  const trialList = h('div.trial-list');
  const modeHelp = h('p.small.muted');
  const startBtn = h('button.btn.primary.block', { onclick: () => toggle() }, 'マイク開始');

  const renderTarget = () => {
    targetVal.textContent = useTarget ? `${midiName(target)}（${midiNameJa(target)}）` : '自由（近い音）';
  };
  const modeSeg = h('div.seg',
    [['longtone', 'ロングトーン'], ['attack', '音の入り']].map(([id, label]) =>
      h('button', {
        class: id === mode ? 'on' : '',
        onclick: (e) => {
          mode = id;
          for (const b of modeSeg.children) b.classList.remove('on');
          e.currentTarget.classList.add('on');
          if (mode === 'attack' && !useTarget) {
            useTarget = true;
            renderTarget();
          }
          updateHelp();
          statDurLabel.textContent = mode === 'attack' ? '到達時間' : '伸ばした時間';
          save();
        },
      }, label)
    )
  );
  const updateHelp = () => {
    modeHelp.textContent =
      mode === 'longtone'
        ? '「あー」と 5〜10 秒まっすぐ伸ばしましょう。伸ばし終わると、平均のズレと揺れを採点します。目標：ズレ ±10c 以内・揺れ 8c 以下。'
        : '基準音を聞いてから、息を吸って一発で「ア」と入りましょう。目標の音に届くまでの時間を測ります。目標：100ms 以内。';
  };
  updateHelp();
  renderTarget();

  main.append(
    h('div.fade-in',
      h('div.card', modeSeg, modeHelp),
      h('div.card.tuner',
        noteEl, noteJa, canvas, centsEl,
        h('div.stat-grid', { style: { marginTop: '8px' } },
          h('div.stat', statDur, statDurLabel),
          h('div.stat', statMean, h('div.k', '平均のズレ')),
          h('div.stat', statStab, h('div.k', '揺れ'))
        )
      ),
      h('div.card',
        h('h2', '目標の音'),
        h('div.target-picker',
          h('button.btn.small', { onclick: () => { useTarget = true; target--; renderTarget(); save(); } }, '♭ 下げる'),
          targetVal,
          h('button.btn.small', { onclick: () => { useTarget = true; target++; renderTarget(); save(); } }, '♯ 上げる')
        ),
        h('div.row', { style: { marginTop: '10px', justifyContent: 'center' } },
          h('button.btn.small', { onclick: async () => { await eng.ensureContext(); eng.playTone(midiToHz(useTarget ? target : 57), 1.5); } }, '🔊 基準音'),
          h('button.btn.small.ghost', { onclick: () => { useTarget = !useTarget; renderTarget(); save(); } }, '自由モード切替')
        ),
        h('div.tiny.center', { style: { marginTop: '6px' } }, '男性の目安 mid1G〜mid2E（G3〜E4）、女性の目安 mid2C〜hiC（C4〜C5）')
      ),
      startBtn,
      h('div.card', { style: { marginTop: '14px' } }, h('h2', '今回の記録'), trialList, h('div.tiny', 'イヤホンで基準音を聴くと、声と混ざらず正確に測れます。'))
    )
  );

  // ---------- 描画 ----------
  let raf = 0;
  const draw = () => {
    const { ctx, w, h: H } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, H);
    const y = (c) => H / 2 - (c / 60) * (H / 2 - 6);
    // 目盛
    ctx.fillStyle = cssVar('--good');
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, y(10), w, y(-10) - y(10));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--line');
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = cssVar('--text3');
    for (const c of [-50, -25, 0, 25, 50]) {
      ctx.globalAlpha = c === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y(c));
      ctx.lineTo(w, y(c));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(`${c > 0 ? '+' : ''}${c}`, 2, y(c) - 2);
    }
    if (hist.length) {
      const tNow = hist[hist.length - 1].t;
      const SPAN = 5;
      const x = (t) => w - 8 - ((tNow - t) / SPAN) * (w - 30);
      ctx.lineWidth = 2.5;
      let prev = null;
      for (const p of hist) {
        if (p.cents == null) {
          prev = null;
          continue;
        }
        const c = Math.max(-60, Math.min(60, p.cents));
        if (prev) {
          ctx.strokeStyle = devColor(Math.abs(c));
          ctx.beginPath();
          ctx.moveTo(x(prev.t), y(prev.c));
          ctx.lineTo(x(p.t), y(c));
          ctx.stroke();
        }
        prev = { t: p.t, c };
      }
    }
    if (live) raf = requestAnimationFrame(draw);
  };

  // ---------- 解析 ----------
  const onFrames = (frames) => {
    for (const f of frames) {
      const voiced = f.f0 > 0 && f.c >= 0.7 && f.db > -52;
      if (!voiced) {
        hist.push({ t: f.t, cents: null });
        silentFrames++;
        if (cur && silentFrames >= 15) finishTrial();
        continue;
      }
      silentFrames = 0;
      const m = hzToMidi(f.f0);
      if (!cur) cur = { t0: f.t, ms: [], ts: [] };
      cur.ms.push(m);
      cur.ts.push(f.t);
      // 自由モードは、発声の中央値に最も近い半音を目標にする
      const ref = useTarget ? target : Math.round(cur.ms.length > 10 ? median(cur.ms.slice(-60)) : m);
      const cents = (m - ref) * 100;
      hist.push({ t: f.t, cents, m });
      noteEl.textContent = midiName(m);
      noteJa.textContent = `${midiNameJa(m)}${useTarget ? ` → 目標 ${midiName(target)}` : ''}`;
      centsEl.textContent = `${cents > 0 ? '+' : ''}${Math.round(cents)} セント`;
      centsEl.style.color = devColor(Math.abs(cents));
      if (mode === 'longtone' && cur.ms.length > 20) {
        statDur.textContent = `${(f.t - cur.t0).toFixed(1)}s`;
      }
    }
    const cut = hist.length ? hist[hist.length - 1].t - 6 : 0;
    while (hist.length && hist[0].t < cut) hist.shift();
  };

  function finishTrial() {
    const c = cur;
    cur = null;
    if (!c || c.ms.length < 25) return;
    const dur = c.ts[c.ts.length - 1] - c.t0;
    const ref = useTarget ? target : Math.round(median(c.ms.slice(Math.floor(c.ms.length * 0.2))));
    const cents = c.ms.map((m) => (m - ref) * 100);
    if (mode === 'attack') {
      let arrive = null;
      for (let i = 0; i + 4 < cents.length; i++) {
        if (cents.slice(i, i + 5).every((v) => Math.abs(v) < 20)) {
          arrive = c.ts[i] - c.t0;
          break;
        }
      }
      const score = arrive == null ? 0 : Math.round(pl(arrive, [[0.05, 100], [0.1, 90], [0.18, 70], [0.3, 45], [0.5, 25]]));
      statDur.textContent = arrive == null ? '届かず' : `${Math.round(arrive * 1000)}ms`;
      const body = cents.slice(Math.min(cents.length - 1, 15));
      statMean.textContent = `${Math.round(mean(body))}c`;
      statStab.textContent = `${Math.round(std(body))}c`;
      addTrial(`入り ${midiName(ref)}`, arrive == null ? '目標に届かず' : `${Math.round(arrive * 1000)}ms で到達`, score);
    } else {
      const body = cents.slice(15, cents.length - 5);
      if (body.length < 20) return;
      const mDev = mean(body);
      const sm = movingAvg(body, 17);
      const wob = std(sm);
      const jit = std(body.map((v, i) => v - sm[i]));
      const s1 = pl(Math.abs(mDev), [[5, 100], [10, 92], [20, 70], [35, 40]]);
      const s2 = pl(wob, [[3, 100], [6, 92], [10, 75], [18, 45]]);
      const s3 = pl(dur, [[1.5, 60], [3, 80], [5, 95], [8, 100]]);
      const score = Math.round(s1 * 0.4 + s2 * 0.45 + s3 * 0.15);
      statDur.textContent = `${dur.toFixed(1)}s`;
      statMean.textContent = `${mDev > 0 ? '+' : ''}${Math.round(mDev)}c`;
      statStab.textContent = `${Math.round(wob)}c`;
      const vib = jit > 12 ? '・ビブラート/細かい揺れあり' : '';
      addTrial(`${midiName(ref)} ${dur.toFixed(1)}秒`, `ズレ ${mDev > 0 ? '+' : ''}${Math.round(mDev)}c・揺れ ${Math.round(wob)}c${vib}`, score);
    }
  }

  function addTrial(title, detail, score) {
    trials.unshift({ title, detail, score });
    trialList.innerHTML = '';
    for (const t of trials.slice(0, 12)) {
      trialList.append(h('div', h('span', h('b', t.title), ' ', h('span.tiny', t.detail)), h('b', { style: { color: t.score >= 85 ? cssVar('--good') : t.score >= 65 ? cssVar('--warn') : cssVar('--bad') } }, `${t.score}点`)));
    }
    if (score >= 90) toast('🎯 ナイス！');
  }

  async function toggle() {
    if (live) {
      stop();
      return;
    }
    try {
      await startLive();
    } catch (e) {
      toast(micErrorText(e), 4000);
      return;
    }
    app.liveListeners.add(onFrames);
    live = true;
    startBtn.textContent = '停止';
    startBtn.classList.remove('primary');
    draw();
  }

  function stop() {
    live = false;
    app.liveListeners.delete(onFrames);
    stopLive();
    cancelAnimationFrame(raf);
    startBtn.textContent = 'マイク開始';
    startBtn.classList.add('primary');
  }

  requestAnimationFrame(draw);
  return { cleanup: () => live && stop() };
}

function median(a) {
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
}

function movingAvg(a, win) {
  const hw = win >> 1;
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - hw); k <= Math.min(a.length - 1, i + hw); k++) (s += a[k]), n++;
    return s / n;
  });
}
