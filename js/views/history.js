// 履歴タブ：成長グラフと記録一覧
import { h, scoreColor, fmtDate } from '../ui/dom.js';
import { drawLineChart } from '../ui/charts.js';
import { CATEGORIES } from '../analysis/score.js';
import { navigate } from '../app.js';
import * as store from '../storage.js';
import { toBackupJSON, fromBackupJSON, shareOrDownload } from '../ui/share.js';
import { toast } from '../ui/dom.js';

export async function renderHistory(main) {
  const all = await store.listSessions();
  const list = all.filter((s) => !s.insufficient); // 判定できなかった記録は統計から除外
  if (!list.length) {
    main.append(
      h('div.card.center.fade-in',
        h('h2', 'まだ記録がありません'),
        h('p.muted.small', '歌って採点すると、ここに成長の記録がたまっていきます。'),
        h('a.btn.primary', { href: '#/' }, '歌ってみる')
      ),
      backupCard()
    );
    return null;
  }

  let metric = 'total';
  let song = '';
  const canvas = h('canvas.chart-canvas');
  const songs = [...new Set(list.map((s) => s.title))].filter((t) => t && t !== '無題');

  const draw = () => {
    const src = list.filter((s) => !song || s.title === song).slice().reverse().slice(-30);
    const pts = src.map((s) => {
      const d = new Date(s.date);
      const y = metric === 'total' ? s.total : s.categories.find((c) => c.id === metric)?.score;
      return { y: y ?? NaN, label: `${d.getMonth() + 1}/${d.getDate()}` };
    });
    drawLineChart(canvas, pts);
  };

  const metricSeg = h('div.seg',
    [{ id: 'total', short: '総合' }, ...CATEGORIES].map((c) =>
      h('button', {
        class: c.id === metric ? 'on' : '',
        onclick: (e) => {
          metric = c.id;
          for (const b of metricSeg.children) b.classList.remove('on');
          e.currentTarget.classList.add('on');
          draw();
        },
      }, c.short)
    )
  );
  const songSel = songs.length
    ? h('select.input', { style: { marginTop: '8px' }, onchange: (e) => ((song = e.target.value), draw()) },
        h('option', { value: '' }, 'すべての曲'),
        songs.map((s) => h('option', { value: s }, s))
      )
    : null;

  // ベスト・平均
  const best = Math.max(...list.map((s) => s.total));
  const recent = list.slice(0, 5);
  const avgRecent = recent.reduce((a, s) => a + s.total, 0) / recent.length;
  // 伸びた項目（最初の 3 回と直近 3 回の比較）
  const growth = computeGrowth(list);

  main.append(
    h('div.fade-in',
      h('div.card',
        h('div.stat-grid',
          h('div.stat', h('div.v', list.length), h('div.k', '記録数')),
          h('div.stat', h('div.v', best.toFixed(1)), h('div.k', 'ベスト')),
          h('div.stat', h('div.v', avgRecent.toFixed(1)), h('div.k', '直近 5 回の平均'))
        ),
        streakLine(list)
      ),
      h('div.card', h('h2', '成長グラフ'), metricSeg, songSel, canvas, h('div.tiny', '点線：直近 5 回の移動平均')),
      growth ? h('div.card', h('h2', '伸びている項目'), h('p.small', growth)) : null,
      h('div.card',
        h('h2', '記録'),
        all.map((s) =>
          h('div.hist-item', { onclick: () => navigate(`#/result/${s.id}`) },
            h('div.grow',
              h('div.hist-title', s.title),
              h('div.tiny', `${fmtDate(s.date)}${s.source === 'file' ? ' ・ ファイル' : ''}`)
            ),
            h('div.hist-score', { style: { color: s.insufficient ? '' : scoreColor(s.total) } }, s.insufficient ? '—' : s.total.toFixed(2))
          )
        )
      ),
      backupCard()
    )
  );
  requestAnimationFrame(draw);
  window.addEventListener('resize', draw);
  return { cleanup: () => window.removeEventListener('resize', draw) };
}

/** 連続で歌った日数 */
function streakLine(list) {
  const day = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = new Set(list.map((s) => day(s.date)));
  const today = day(Date.now());
  const DAY = 86400000;
  let cur = days.has(today) ? today : today - DAY;
  let streak = 0;
  while (days.has(cur)) {
    streak++;
    cur -= DAY;
  }
  const week = [...days].filter((d) => d > today - 7 * DAY).length;
  const msg = streak >= 2 ? `🔥 ${streak} 日連続で歌っています！` : days.has(today) ? '今日も歌いました 👏' : '今日はまだ歌っていません';
  return h('div.small.center', { style: { marginTop: '10px' } }, `${msg}（この 7 日間で ${week} 日）`);
}

function backupCard() {
  const input = h('input.hidden-file', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = fromBackupJSON(await f.text());
        if (!data || data.app !== 'kikigokochi') throw new Error('format');
        let n = 0;
        for (const s of data.sessions || []) {
          if (!(await store.getSession(s.id))) {
            await store.saveSession(s, null);
            n++;
          }
        }
        for (const r of data.refs || []) await store.saveRef(r);
        toast(`${n} 件の記録を読み込みました`);
        navigate('#/history');
      } catch {
        toast('バックアップファイルを読み込めませんでした');
      }
    },
  });
  return h('details.card',
    h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'データのバックアップ'),
    h('p.small.muted', '記録は端末内（ブラウザ）に保存されています。ホーム画面に追加して使うと消えにくくなりますが、機種変更などに備えて時々バックアップしておくと安心です（録音の音声は含みません）。'),
    h('div.row.wrap',
      h('button.btn.small', {
        onclick: async () => {
          const ids = (await store.listSessions()).map((s) => s.id);
          const sessions = [];
          for (const id of ids) sessions.push(await store.getSession(id));
          const refs = [];
          for (const t of await store.listRefTitles()) refs.push(await store.getRef(t));
          const json = toBackupJSON({ app: 'kikigokochi', version: 1, exported: Date.now(), sessions, refs });
          const d = new Date();
          await shareOrDownload(new File([json], `kikigokochi-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, { type: 'application/json' }));
        },
      }, '書き出す'),
      h('button.btn.small', { onclick: () => input.click() }, '読み込む'),
      input
    )
  );
}

function computeGrowth(list) {
  if (list.length < 4) return null;
  const chrono = list.slice().reverse();
  const n = Math.min(3, Math.floor(chrono.length / 2));
  const first = chrono.slice(0, n);
  const last = chrono.slice(-n);
  const avg = (arr, id) => {
    const v = arr.map((s) => s.categories.find((c) => c.id === id)?.score).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const diffs = CATEGORIES.map((c) => ({ c, d: avg(last, c.id) != null && avg(first, c.id) != null ? avg(last, c.id) - avg(first, c.id) : null }))
    .filter((x) => x.d != null)
    .sort((a, b) => b.d - a.d);
  const ups = diffs.filter((x) => x.d >= 2).slice(0, 3);
  if (!ups.length) return '最初の頃と比べて大きな変化はまだありません。練習メニューを続けてみましょう！';
  return `最初の ${n} 回と比べて、${ups.map((x) => `「${x.c.name}」が +${x.d.toFixed(1)}`).join('、')} 伸びています。練習の成果が出ています！`;
}
