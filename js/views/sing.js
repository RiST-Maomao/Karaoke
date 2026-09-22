// 歌うタブ：準備画面・録音画面・解析中画面
import { app, startLive, stopLive, finishRecording, analyzeFile, navigate, loadReferenceFor, registerReference, isSynced } from '../app.js';
import { h, toast } from '../ui/dom.js';
import { PitchRoll } from '../ui/pitchRoll.js';
import { hzToMidi, midiName, midiNameJa, fmtTime } from '../analysis/music.js';
import * as store from '../storage.js';

const MAX_REC_SEC = 10 * 60;

export async function renderSing(main) {
  const eng = app.engine;

  // 曲名
  const titleInput = h('input.input', {
    type: 'text',
    placeholder: '例：糸 / ultra soul（任意）',
    value: app.songTitle,
    list: 'songTitles',
    oninput: (e) => {
      app.songTitle = e.target.value;
      clearTimeout(titleTimer);
      titleTimer = setTimeout(async () => {
        await loadReferenceFor(app.songTitle);
        renderRef();
      }, 300);
    },
  });
  let titleTimer = null;
  const titles = h('datalist#songTitles');
  store.listSessions().then((list) => {
    const seen = new Set();
    for (const s of list) if (s.title && s.title !== '無題' && !seen.has(s.title)) (seen.add(s.title), titles.append(h('option', { value: s.title })));
  }).catch(() => {});

  // 伴奏
  const accompName = h('span.name', app.accompName || '未選択（アカペラで歌う）');
  const accompFile = h('input.hidden-file', {
    type: 'file',
    accept: 'audio/*,.mp3,.m4a,.wav,.aac',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        accompName.textContent = '読み込み中…';
        const dur = await eng.loadAccompaniment(f);
        app.accompName = f.name;
        accompName.textContent = `${f.name}（${fmtTime(dur)}）`;
        clearBtn.hidden = false;
        if (!app.songTitle) {
          app.songTitle = f.name.replace(/\.[^.]+$/, '');
          titleInput.value = app.songTitle;
        }
      } catch {
        accompName.textContent = '読み込めませんでした';
        toast('この音声ファイルは読み込めませんでした');
      }
      e.target.value = '';
    },
  });
  const clearBtn = h('button.btn.small.ghost', {
    hidden: !app.accompName,
    onclick: () => {
      eng.clearAccompaniment();
      app.accompName = '';
      accompName.textContent = '未選択（アカペラで歌う）';
      clearBtn.hidden = true;
    },
  }, '外す');
  const vol = h('input', {
    type: 'range', min: 0, max: 1, step: 0.05, value: app.accompVolume,
    oninput: (e) => {
      app.accompVolume = +e.target.value;
      savePrefs();
    },
  });

  // お手本ボーカル
  const refStatus = h('div.small.grow');
  const refProgress = h('div.progress', { hidden: true }, h('i'));
  const refFile = h('input.hidden-file', {
    type: 'file',
    accept: 'audio/*,.mp3,.m4a,.wav,.aac',
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!app.songTitle.trim()) {
        app.songTitle = f.name.replace(/\.[^.]+$/, '').replace(/[ _-]?(vocals?|ボーカル|acapella|アカペラ)$/i, '');
        titleInput.value = app.songTitle;
      }
      refProgress.hidden = false;
      refStatus.textContent = 'お手本を解析中…';
      try {
        const ref = await registerReference(f, app.songTitle, (v) => (refProgress.firstChild.style.width = `${Math.round(v * 100)}%`));
        toast(`お手本を登録しました（聞き心地 ${ref.total.toFixed(1)} 点）`);
      } catch (err) {
        toast(`お手本を登録できませんでした：${err.message || err}`, 4000);
      }
      refProgress.hidden = true;
      renderRef();
    },
  });
  const syncBox = h('input', { type: 'checkbox', checked: app.refSynced, onchange: (e) => ((app.refSynced = e.target.checked), savePrefs()) });
  const refRemove = h('button.btn.small.ghost', {
    onclick: async () => {
      if (!app.reference || !confirm(`「${app.reference.title}」のお手本を削除しますか？`)) return;
      await store.deleteRef(app.reference.title);
      app.reference = null;
      renderRef();
    },
  }, '削除');
  function renderRef() {
    const r = app.reference;
    refRemove.hidden = !r;
    refStatus.innerHTML = '';
    if (r) {
      refStatus.append(h('span.pill.good', '登録済み'), ' ', `${r.fileName}（${fmtTime(r.duration || 0)}・お手本の聞き心地 ${r.total.toFixed(1)} 点）`);
    } else {
      refStatus.append(h('span.muted', app.songTitle.trim() ? 'この曲のお手本は未登録です' : '未登録（曲名ごとに保存されます）'));
    }
  }
  loadReferenceFor(app.songTitle).then(renderRef);

  // マイクチェック
  const meterFill = h('i');
  const meter = h('div.meter', h('div.zone'), meterFill);
  const micMsg = h('div.small.muted', 'ボタンを押して声を出すと、入力レベルが表示されます。');
  const noteView = h('div.small', '');
  let checking = false;
  const onFrames = (frames) => {
    const f = frames[frames.length - 1];
    const lvl = Math.max(0, Math.min(1, (f.db + 60) / 60));
    meterFill.style.width = `${lvl * 100}%`;
    if (f.f0 > 0 && f.c > 0.7 && f.db > -55) {
      const m = hzToMidi(f.f0);
      noteView.textContent = `検出中の音：${midiNameJa(m)}（${midiName(m)}）`;
    }
    if (f.db > -3) micMsg.textContent = '⚠ 音が割れています。マイクを口から少し離してください。';
    else if (f.db > -45 && f.c > 0.7) micMsg.textContent = '✓ ちょうど良い入力です。';
  };
  const micBtn = h('button.btn.small', {
    onclick: async () => {
      if (checking) {
        stopCheck();
        return;
      }
      try {
        await startLive();
        app.liveListeners.add(onFrames);
        checking = true;
        micBtn.textContent = 'チェック終了';
        const label = eng.inputLabel();
        micMsg.textContent = label ? `入力：${label}` : 'マイクに向かって「あー」と声を出してください';
      } catch (e) {
        micMsg.textContent = micErrorText(e);
      }
    },
  }, 'マイクを確認');
  function stopCheck() {
    app.liveListeners.delete(onFrames);
    checking = false;
    micBtn.textContent = 'マイクを確認';
    meterFill.style.width = '0';
  }

  // ファイル解析
  const analyzeInput = h('input.hidden-file', {
    type: 'file',
    accept: 'audio/*,video/*,.mp3,.m4a,.wav,.aac',
    onchange: (e) => {
      const f = e.target.files[0];
      if (f) analyzeFile(f);
    },
  });

  const intro = h('div.card', { hidden: true },
    h('h2', 'はじめての方へ'),
    h('ol.small', { style: { paddingLeft: '20px', margin: '0' } },
      h('li', 'イヤホンマイクをつないで、下の「マイクを確認」でレベルチェック'),
      h('li', '好きな曲を 1 コーラス（1 分〜）歌う。伴奏はなくても OK'),
      h('li', '結果の「もっと良くなるポイント」と練習メニューに取り組む')
    ),
    h('p.tiny', { style: { margin: '8px 0 0' } }, '点数は“誰が聞いても上手い”に近いほど上がります。機械的な採点のクセを攻略する必要はありません。')
  );
  store.listSessions().then((l) => (intro.hidden = l.length > 0)).catch(() => {});

  main.append(
    h('div.fade-in',
      h('div.hero', h('div.logo', 'ききごこち'), h('p', '“聞き心地”で採点する、ボイトレ先生つきカラオケ')),
      intro,
      h('div.card',
        h('label.field', h('span', '曲名'), titleInput, titles),
        h('div.field',
          h('span', '伴奏・原曲（任意）'),
          h('div.file-row', accompName, clearBtn, h('button.btn.small', { onclick: () => accompFile.click() }, '選ぶ'), accompFile),
          h('div.row', { style: { marginTop: '8px' } }, h('span.tiny.nowrap', '伴奏の音量'), vol),
          h('div.tiny', { style: { marginTop: '4px' } }, 'ファイルアプリ内の音源をイヤホンで流しながら歌えます。採点に使うのはマイクの歌声だけです。')
        )
      ),
      h('div.center',
        h('button.record-btn', {
          onclick: () => {
            // iOS はタップの処理中にオーディオを起動しないと無音になるので、画面遷移の前に起動
            app.engine.ensureContext();
            navigate('#/record');
          },
          'aria-label': '録音開始',
        },
          h('div', svgMic(), h('div', { style: { fontSize: '15px' } }, '歌う'))
        ),
        h('div.tiny', 'イヤホンマイク推奨 ・ 1 コーラス以上で精度が上がります')
      ),
      h('div.card', { style: { marginTop: '16px' } },
        h('h2', 'マイクチェック'),
        h('div.mic-check', meter, micBtn),
        h('div', { style: { marginTop: '8px' } }, micMsg, noteView),
        h('div.tiny', { style: { marginTop: '6px' } }, 'イヤホンのマイクは口元から 3〜5cm。一番大きい声でもメーターが赤まで行かない位置がベストです。')
      ),
      h('details.card', { open: !!app.reference },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'お手本ボーカル（任意・上級）'),
        h('p.small.muted', 'プロの歌声だけの音源（原曲からボーカルを抽出したもの等）を登録すると、メロディの取り違えやリズムのズレも判定し、録音中に音程ガイドを表示します。曲名ごとに端末内に保存されます。'),
        h('div.file-row', refStatus, refRemove, h('button.btn.small', { onclick: () => refFile.click() }, '選ぶ'), refFile),
        refProgress,
        h('label.row.small', { style: { marginTop: '8px' } }, syncBox, h('span', '伴奏とお手本は同じ時間軸（伴奏＝原曲、お手本＝その歌声）')),
        h('div.tiny', '同じ時間軸なら、リズム（もたり・走り）も判定できます。キーを変えて歌っても自動で合わせます。')
      ),
      h('div.card',
        h('h2', '録音済みの音声を採点'),
        h('p.small.muted', 'ボイスメモなどで録った歌声（アカペラ）や、プロのボーカルだけの音源を採点できます。伴奏入りの音源は正しく評価できません。'),
        h('button.btn.block', { onclick: () => analyzeInput.click() }, 'ファイルを選んで採点'),
        analyzeInput
      )
    )
  );

  return {
    cleanup() {
      if (checking) stopCheck();
      // 録音画面に移る場合はマイクを開いたままにする（再許可のダイアログを避ける）
      if (location.hash !== '#/record') stopLive();
    },
  };
}

function savePrefs() {
  store.setKV('prefs', { accompVolume: app.accompVolume, refSynced: app.refSynced }).catch(() => {});
}

export function micErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '⚠ マイクの使用が許可されていません。iPhone の「設定 → Safari → マイク」で許可してください。';
  if (n === 'NotFoundError') return '⚠ マイクが見つかりません。';
  return `⚠ マイクを開けませんでした：${e && e.message ? e.message : e}`;
}

function svgMic() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return s;
}

// ============================================================
// 録音画面
// ============================================================
export async function renderRecording(main) {
  const eng = app.engine;
  const canvas = h('canvas');
  const roll = new PitchRoll(canvas);
  if (isSynced()) roll.setGuide(app.reference.track.notes);
  const timeEl = h('span.rec-time', '0:00');
  const noteEl = h('div.rec-note', '—', h('small', '声を出すと音程が表示されます'));
  const meterFill = h('i');
  let finished = false;
  let timer = null;

  const stop = async () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    app.liveListeners.delete(onFrames);
    roll.stop();
    await finishRecording();
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    eng.stopRecording();
    eng.stopAccompaniment();
    stopLive();
    navigate('#/');
  };

  main.append(
    h('div.rec-screen.fade-in',
      h('div.rec-head',
        h('div', h('span.rec-dot'), timeEl),
        h('div.small.muted', app.songTitle || '無題')
      ),
      noteEl,
      h('div.roll-wrap', canvas),
      h('div.meter', meterFill),
      h('button.stop-btn', { onclick: stop, 'aria-label': '録音を止めて採点' }, h('i')),
      h('div.center.small.muted', '止めると採点します'),
      h('div.center', h('button.btn.ghost.small', { onclick: cancel }, 'やめる（保存しない）'))
    )
  );

  const onFrames = (frames) => {
    roll.push(frames);
    const f = frames[frames.length - 1];
    meterFill.style.width = `${Math.max(0, Math.min(1, (f.db + 60) / 60)) * 100}%`;
    if (f.f0 > 0 && f.c > 0.7 && f.db > -55) {
      const m = hzToMidi(f.f0);
      const cents = Math.round((m - Math.round(m)) * 100);
      noteEl.firstChild.textContent = midiName(m);
      noteEl.lastChild.textContent = `${midiNameJa(m)} ・ ${cents > 0 ? '+' : ''}${cents}c`;
    }
  };

  try {
    await startLive(); // 既に開いていればワーカーだけリセット
  } catch (e) {
    main.innerHTML = '';
    main.append(h('div.card', h('h2', 'マイクを使えません'), h('p', micErrorText(e)), h('button.btn', { onclick: () => navigate('#/') }, '戻る')));
    return null;
  }
  app.liveListeners.add(onFrames);
  eng.startRecording();
  const accomp = eng.startAccompaniment(app.accompVolume);
  if (accomp) {
    accomp.onended = () => {
      if (!finished) setTimeout(stop, 800);
    };
  }
  roll.start();
  const t0 = performance.now();
  timer = setInterval(() => {
    const sec = (performance.now() - t0) / 1000;
    timeEl.textContent = fmtTime(sec);
    if (sec > MAX_REC_SEC) stop();
  }, 250);

  return {
    cleanup() {
      app.liveListeners.delete(onFrames);
      roll.stop();
      if (!finished) {
        // 戻るなどで離れた場合は破棄
        finished = true;
        clearInterval(timer);
        eng.stopRecording();
        eng.stopAccompaniment();
        stopLive();
      }
    },
  };
}

// ============================================================
// 解析中
// ============================================================
export function renderAnalyzing(main) {
  main.append(
    h('div.analyzing.fade-in',
      h('div.spinner'),
      h('h2', '先生が聴いています…'),
      h('p.small.muted', '音程・響き・抑揚・語尾などを分析中'),
      h('div.progress', h('i'))
    )
  );
  return null;
}
