// 小さな DOM ヘルパ

/** h('div.card#id', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** CSS 変数の値 */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 高 DPI 対応でキャンバスのサイズを合わせる。戻り値は CSS ピクセルでの幅・高さ */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const hgt = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}

export function scoreColor(v) {
  if (v == null) return cssVar('--text3');
  if (v >= 88) return cssVar('--good');
  if (v >= 75) return cssVar('--blue');
  if (v >= 62) return cssVar('--warn');
  return cssVar('--bad');
}

export function devColor(absCents) {
  if (absCents < 15) return cssVar('--good');
  if (absCents < 28) return cssVar('--warn');
  return cssVar('--bad');
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
