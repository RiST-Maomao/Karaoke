// 結果画面
import { app, loadAudio, downloadAudio, navigate } from '../app.js';
import { h, toast, scoreColor, fmtDate } from '../ui/dom.js';
import { drawRadar } from '../ui/charts.js';
import { Timeline } from '../ui/timeline.js';
import { fmtTime, midiName } from '../analysis/music.js';
import * as store from '../storage.js';
import { makeShareImage, shareOrDownload } from '../ui/share.js';

export async function renderResult(main, [id]) {
  const session = await store.getSession(id);
  if (!session) {
    main.append(h('div.card', h('p', 'この記録は見つかりませんでした。'), h('a', { href: '#/history' }, '履歴へ')));
    return null;
  }
  const r = session.report;
  const c = r.coaching;
  const eng = app.engine;

  // 前回（同じ曲があれば同じ曲、なければ直前の記録）
  const all = await store.listSessions();
  const older = all.filter((s) => s.date < session.date && !s.insufficient);
  const prev = older.find((s) => s.title === session.title && session.title !== '無題') || null;

  // ---------- 再生 ----------
  let audio = null;
  let raf = 0;
  let playingBtn = null;
  const stopPlay = () => {
    eng.stopPlayback();
    cancelAnimationFrame(raf);
    tl.setPlayhead(null);
    if (playingBtn) playingBtn.classList.remove('playing');
    playingBtn = null;
    playAllBtn.textContent = '▶ 全体を再生';
  };
  const play = async (from, to, btn) => {
    await eng.ensureContext();
    if (!audio) audio = await loadAudio(id);
    if (!audio) return toast('録音データが残っていません（古い記録は音声が自動削除されます）');
    if (playingBtn === btn && btn) return stopPlay();
    stopPlay();
    eng.playPcm(audio.pcm, audio.sampleRate, from, to, () => {
      if (playingBtn === btn) stopPlay();
    }, withAccomp && accompBox.checked);
    playingBtn = btn;
    if (btn) btn.classList.add('playing');
    const tick = () => {
      const p = eng.playbackPosition();
      if (p == null) return;
      tl.setPlayhead(p);
      raf = requestAnimationFrame(tick);
    };
    tick();
  };

  // 伴奏つき再生：この録音で使った伴奏がまだ読み込まれている場合のみ
  const withAccomp = !!(session.accomp && eng.accompBuffer && app.accompName === session.accomp && session.source === 'mic');
  const accompBox = h('input', { type: 'checkbox', checked: withAccomp });
  const tl = new Timeline(r, { onSeek: (t) => play(t, null, null) });
  const playAllBtn = h('button.btn.small', {
    onclick: () => {
      if (eng.playSrc) return stopPlay();
      play(0, null, null);
      playAllBtn.textContent = '■ 停止';
    },
  }, '▶ 全体を再生');

  const exBtn = (ex) => {
    const b = h('button.ex-btn', {
      onclick: () => {
        tl.setHighlight([ex.t, ex.tEnd]);
        play(Math.max(0, ex.t - 0.6), ex.tEnd + 0.5, b);
      },
    }, `${fmtTime(ex.t)} ${ex.label}`);
    return b;
  };

  // ---------- スコア ----------
  const scoreEl = h('div.score-num', '0', h('small', '.000'));
  if (r.insufficient) {
    main.append(
      h('div.fade-in',
        h('div.card.score-hero', h('div.song', session.title), h('div.score-num', '—'), h('div.score-rank', h('span', '判定できませんでした'))),
        h('div.card', h('div.teacher', h('div.avatar', '🎤'), h('div.bubble', c.summary))),
        c.notes.length ? h('div.card', h('ul.goal-list.small', c.notes.map((n) => h('li', n)))) : null,
        h('div.row.wrap', { style: { gap: '8px' } },
          h('button.btn.primary.grow', { onclick: () => navigate('#/') }, 'もう一度歌う'),
          h('button.btn', { onclick: () => downloadAudio(id, session.title) }, '録音を保存'),
          h('button.btn.danger', { onclick: async () => { await store.deleteSession(id); navigate('#/history'); } }, '削除')
        )
      )
    );
    return null;
  }
  const delta = prev ? r.total - prev.total : null;

  const radar = h('canvas');
  const cats = r.categories;

  main.append(
    h('div.fade-in',
      h('div.card.score-hero',
        h('div.song', session.title),
        h('div.tiny', `${fmtDate(session.date)} ・ ${session.source === 'file' ? 'ファイル' : 'マイク録音'}${session.refName ? ' ・ お手本比較あり' : ''}`),
        scoreEl,
        h('div.score-rank', h('b', c.label.rank), h('span', c.label.text)),
        delta != null ? h('div.delta', h('span', { class: delta >= 0 ? 'up' : 'down' }, `前回（${fmtDate(prev.date)}）から ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`)) : null,
        r.reliability < 0.6 ? h('div.tiny', { style: { marginTop: '6px' } }, '※ 歌唱時間が短いため参考値です') : null
      ),
      h('div.card', h('div.teacher', h('div.avatar', '🎤'), h('div.bubble', c.summary))),
      h('div.card',
        h('h2', '項目別スコア'),
        h('div.radar-wrap', radar),
        h('div.cat-list', cats.map((ct) => catItem(ct, prev))),
        prev ? h('div.tiny', { style: { marginTop: '8px' } }, '点線：前回の同じ曲') : null
      ),
      c.strengths.length
        ? h('div.card',
            h('h2', '👍 良かったところ'),
            c.strengths.map((s) => h('div.fb-item.good', h('h3', s.title), h('p', s.detail))),
            goodExamples(r, exBtn)
          )
        : null,
      c.issues.length
        ? h('div.card',
            h('h2', c.issues.every((x) => x.polish) ? '🚀 さらに上を目指すなら' : '🎯 もっと良くなるポイント'),
            c.issues.map((is, i) =>
              h('div.fb-item.issue',
                h('h3', h('span.pill', `${i + 1}`), is.title, catPill(cats, is.cat)),
                h('p', is.detail),
                h('p.why', is.why),
                h('p.tip', h('b', 'コツ：'), is.tip),
                is.examples.length ? h('div', h('div.tiny', '気になった箇所（タップで再生）'), h('div.ex-list', is.examples.map(exBtn))) : null,
                practiceLink(r, is)
              )
            )
          )
        : h('div.card', h('h2', '🎯 改善ポイント'), h('p.muted', '大きな改善点は見つかりませんでした。素晴らしい！')),
      c.phrases && (c.phrases.worst.length || c.phrases.best)
        ? h('div.card',
            h('h2', '🎧 フレーズ別チェック'),
            c.phrases.worst.length
              ? h('div',
                  h('div.small', 'もう一度練習したいフレーズ'),
                  h('div.ex-list', c.phrases.worst.map((p) => exBtn({ t: p.t, tEnd: p.tEnd, label: `${Math.round(p.score)}点${p.main ? `・${p.main}` : ''}` })))
                )
              : null,
            c.phrases.best
              ? h('div', { style: { marginTop: '10px' } },
                  h('div.small', 'いちばん良かったフレーズ（お手本にしよう）'),
                  h('div.ex-list', exBtn({ t: c.phrases.best.t, tEnd: c.phrases.best.tEnd, label: `${Math.round(c.phrases.best.score)}点・平均ズレ ${Math.round(c.phrases.best.mad)}c` }))
                )
              : null,
            h('p.tiny', { style: { marginTop: '8px' } }, '良いフレーズと苦手なフレーズを聞き比べると、違いが耳でわかるようになります。')
          )
        : null,
      h('div.card',
        h('div.row', h('h2.grow', { style: { margin: 0 } }, '歌唱タイムライン'), playAllBtn),
        h('p.tiny', '線：あなたの音程 ／ 帯：検出した音符（色は音程の正確さ）／ ▼：指摘・良かった箇所'),
        withAccomp ? h('label.row.small', { style: { marginBottom: '8px' } }, accompBox, h('span', '伴奏と一緒に再生')) : null,
        tl.el
      ),
      h('div.card',
        h('h2', '📝 今日の練習メニュー'),
        c.menu.map((d, i) =>
          h('details.drill', { open: i === 0 },
            h('summary', `${i + 1}. ${d.name}`, h('span.pill', d.time)),
            h('ol', d.steps.map((s) => h('li', s))),
            h('div.point', d.point),
            ['longtone', 'attack', 'scale'].includes(d.id)
              ? h('div', { style: { marginTop: '8px' } }, h('button.btn.small', { onclick: () => navigate('#/practice', { mode: d.id }) }, '練習モードを開く'))
              : null
          )
        )
      ),
      c.goals.length ? h('div.card', h('h2', '🏁 次回の目標'), h('ul.goal-list', c.goals.map((g) => h('li', g)))) : null,
      c.notes.length ? h('div.card', h('h2', 'メモ'), h('ul.goal-list.small', c.notes.map((n) => h('li', n)))) : null,
      h('details.card',
        h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '詳細データ（上級者・調整用）'),
        metricsTable(r),
        h('div', { style: { marginTop: '10px' } },
          h('button.btn.small', {
            onclick: async () => {
              const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
              const data = { v: r.version, total: r.total, categories: Object.fromEntries(r.categories.map((c) => [c.id, c.score])), metrics: r.metrics };
              const text = JSON.stringify(data, round);
              try {
                await navigator.clipboard.writeText(text);
                toast('計測値をコピーしました');
              } catch {
                prompt('以下をコピーしてください', text);
              }
            },
          }, '計測値をコピー'),
          h('span.tiny', { style: { marginLeft: '8px' } }, '採点の調整用（音声は含みません）')
        )
      ),
      h('div.row.wrap', { style: { gap: '8px' } },
        h('button.btn.primary.grow', { onclick: () => { app.songTitle = session.title === '無題' ? '' : session.title; navigate('#/'); } }, 'もう一度歌う'),
        h('button.btn', {
          onclick: async () => {
            try {
              await shareOrDownload(await makeShareImage(session));
            } catch {
              toast('画像を作れませんでした');
            }
          },
        }, '画像でシェア'),
        h('button.btn', { onclick: () => downloadAudio(id, session.title) }, '録音を保存'),
        h('button.btn.danger', {
          onclick: async () => {
            if (!confirm('この記録を削除しますか？')) return;
            await store.deleteSession(id);
            toast('削除しました');
            navigate('#/history');
          },
        }, '削除')
      )
    )
  );

  // レーダーとスコアのアニメーション
  requestAnimationFrame(() => drawRadar(radar, cats, prev ? prev.categories : null));
  animateScore(scoreEl, r.total);
  const onResize = () => drawRadar(radar, cats, prev ? prev.categories : null);
  window.addEventListener('resize', onResize);

  return {
    cleanup() {
      stopPlay();
      tl.destroy();
      window.removeEventListener('resize', onResize);
    },
  };
}

/** 指摘箇所の音を目標にして練習モードを開くボタン */
function practiceLink(r, is) {
  const ex = is.examples.find((e) => ['pitch', 'wobble', 'scoop', 'melody', 'strain', 'glide'].includes(e.type));
  if (!ex) return null;
  const tr = r.track;
  let target = null;
  if (ex.type === 'melody' && tr.guide) {
    // お手本の音程（あなたのキーに合わせたもの）
    const v = [];
    for (let i = Math.floor((ex.t - tr.guide.t0) / tr.guide.bin); i <= Math.ceil((ex.tEnd - tr.guide.t0) / tr.guide.bin); i++) {
      const p = tr.guide.pitch[i];
      if (p != null && !Number.isNaN(p)) v.push(p);
    }
    if (v.length) target = Math.round(v.sort((a, b) => a - b)[v.length >> 1]);
  }
  if (target == null) {
    const n = tr.notes.find((x) => x.tEnd >= ex.t && x.t <= ex.tEnd) || tr.notes.find((x) => x.t >= ex.t);
    if (n) target = Math.round(n.center - (n.dev || 0) / 100);
  }
  if (target == null) return null;
  const mode = ex.type === 'scoop' || ex.type === 'glide' ? 'attack' : 'longtone';
  return h('div', { style: { marginTop: '8px' } },
    h('button.btn.small', { onclick: () => navigate('#/practice', { target, mode }) },
      `🎯 この音（${midiName(target)}）を${mode === 'attack' ? '入りの' : 'ロングトーン'}練習`));
}

function catItem(ct, prev) {
  const p = prev && prev.categories.find((x) => x.id === ct.id);
  const d = p && p.score != null && ct.score != null ? ct.score - p.score : null;
  return h('div.cat-item',
    h('div.nm', ct.name),
    h('div.row',
      h('div.sc', ct.score == null ? '—' : ct.score.toFixed(1)),
      d != null && Math.abs(d) >= 0.5 ? h('span.small', { class: d > 0 ? 'up' : 'down' }, `${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(1)}`) : null
    ),
    h('div.bar', h('i', { style: { width: `${ct.score ?? 0}%`, background: scoreColor(ct.score) } }))
  );
}

function catPill(cats, id) {
  const ct = cats.find((x) => x.id === id);
  if (!ct || ct.score == null) return null;
  const cls = ct.score >= 80 ? 'good' : ct.score >= 65 ? 'warn' : 'bad';
  return h(`span.pill.${cls}`, `${ct.short} ${Math.round(ct.score)}`);
}

function goodExamples(r, exBtn) {
  const goods = r.events.filter((e) => e.type === 'good').slice(0, 4);
  if (!goods.length) return null;
  return h('div', h('div.tiny', '特に良かったロングトーン（タップで再生）'),
    h('div.ex-list', goods.map((g) => exBtn({ t: g.t, tEnd: g.tEnd, label: `${(g.tEnd - g.t).toFixed(1)}秒の安定した音` }))));
}

function animateScore(el, target) {
  const start = performance.now();
  const dur = 1400;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const v = target * e;
    const s = v.toFixed(3).split('.');
    el.firstChild.textContent = s[0];
    el.lastChild.textContent = `.${s[1]}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // 画面が非表示で rAF が止まっていても最終値は必ず表示
  setTimeout(() => step(start + dur), dur + 200);
}

function metricsTable(r) {
  const m = r.metrics;
  const f = (v, d = 1, u = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${u}`);
  const rows = [
    ['歌唱時間', f(m.voicedSec, 1, ' 秒')],
    ['検出した音符数 / フレーズ数', `${m.counts.notes} / ${m.counts.phrases}`],
    ['音程：平均ズレ', f(m.pitch.meanAbsDev, 1, ' c')],
    ['音程：±20c 以内の割合', f(m.pitch.hitRate * 100, 0, ' %')],
    ['音程：全体のずれ込み', f(m.pitch.drift?.total, 0, ' c')],
    ['推定キー / スケール内率', `${m.key.name} / ${f(m.key.inScale * 100, 0, '%')}`],
    ['ロングトーンの揺れ', f(m.stability.pitchInstability, 1, ' c')],
    ['細かい揺れ（ジッター）', f(m.stability.hfJitter, 1, ' c')],
    ['音量の揺れ', f(m.stability.loudWobble, 2, ' dB')],
    ['ビブラート（使用率/速さ/幅）', `${f(m.vibrato.ratio * 100, 0, '%')} / ${f(m.vibrato.rate, 1, '回/秒')} / ±${f(m.vibrato.extent, 0, 'c')}`],
    ['歌い出しの到達時間（中央値）', f(m.onset.median * 1000, 0, ' ms')],
    ['しゃくり率', f(m.onset.scoopRatio * 100, 0, ' %')],
    ['跳躍の遅い移動 / 行き過ぎ', `${f(m.onset.slowGlideRatio * 100, 0, '%')} / ${f(m.onset.overshootRatio * 100, 0, '%')}`],
    ['語尾が下がる割合', f(m.endings.fallRatio * 100, 0, ' %')],
    ['フレーズ内の強弱幅', f(m.dynamics.phraseRangeMed, 1, ' dB')],
    ['フレーズ間の音量差', f(m.dynamics.phraseLevelStd, 1, ' dB')],
    ['音量の急変（/分）', f(m.dynamics.spikeRate, 1)],
    ['明瞭度 HNR', f(m.tone.hnr, 1, ' dB')],
    ['響き（2-4kHz 比）', f(m.tone.ring, 1, ' dB')],
    ['息・歯擦音（5kHz+）', f(m.tone.hf, 1, ' dB')],
    ['高音：明瞭度低下 / 音程 / 音量増', m.high.available ? `${f(m.high.hnrDrop, 1)}dB / ${f(m.high.signedDevHigh, 0)}c / ${f(m.high.loudJump, 1)}dB` : '—'],
    ...(m.reference && m.reference.available
      ? [
          ['お手本：キー / 比較方法', `${m.reference.shift > 0 ? '+' : ''}${m.reference.shift} 半音 / ${m.reference.synced ? '同じ時間軸' : '自動整列'}`],
          ['お手本：メロディ一致率 / カバー率', `${f(m.reference.melodyMatch * 100, 0, '%')} / ${f(m.reference.coverage * 100, 0, '%')}`],
          ['お手本：メロディ違いの音', `${m.reference.wrong.length} 箇所`],
          ['お手本：タイミング（平均/ばらつき）', m.reference.timing ? `${f(m.reference.timing.medianLag * 1000, 0, 'ms')} / ${f(m.reference.timing.spread * 1000, 0, 'ms')}` : '—'],
        ]
      : []),
    ['入力レベル（歌/ノイズ）', `${f(m.levels.singLevel, 0)} / ${f(m.levels.noiseFloor, 0)} dBFS`],
  ];
  return h('table.metrics-table', rows.map(([k, v]) => h('tr', h('td', k), h('td', v))));
}
