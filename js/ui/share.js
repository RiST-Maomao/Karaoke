// 結果のシェア画像（1080×1350）とデータのバックアップ

import { drawRadarOn } from './charts.js';

export async function makeShareImage(session) {
  const r = session.report;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (w, s) => `${w} ${s}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;

  // 背景
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d1826');
  g.addColorStop(1, '#2b1f2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, 150, 10, W * 0.8, 150, 600);
  glow.addColorStop(0, 'rgba(255,143,107,0.35)');
  glow.addColorStop(1, 'rgba(255,143,107,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb38a';
  ctx.font = font(800, 44);
  ctx.fillText('ききごこち', W / 2, 100);
  ctx.fillStyle = '#b7aec6';
  ctx.font = font(500, 30);
  ctx.fillText(truncate(ctx, session.title, W - 160), W / 2, 160);

  // スコア
  ctx.fillStyle = '#f3eff8';
  ctx.font = font(800, 190);
  const [ip, fp] = r.total.toFixed(3).split('.');
  const wInt = ctx.measureText(ip).width;
  ctx.font = font(700, 80);
  const wFrac = ctx.measureText(`.${fp}`).width;
  const x0 = W / 2 - (wInt + wFrac) / 2;
  ctx.textAlign = 'left';
  ctx.font = font(800, 190);
  ctx.fillText(ip, x0, 370);
  ctx.font = font(700, 80);
  ctx.fillText(`.${fp}`, x0 + wInt, 370);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff8f6b';
  ctx.font = font(800, 52);
  ctx.fillText(`${r.coaching.label.rank}  ${r.coaching.label.text}`, W / 2, 450);

  // レーダー
  drawRadarOn(ctx, W / 2, 830, 255, r.categories, { text: '#f3eff8', sub: '#b7aec6', line: '#4a4258', accent: '#ff8f6b', fontScale: 2.2 });

  // ひとこと
  const s = r.coaching.strengths[0];
  const i = r.coaching.issues[0];
  ctx.textAlign = 'left';
  let y = 1170;
  if (s) {
    ctx.fillStyle = '#5fd3b0';
    ctx.font = font(700, 32);
    ctx.fillText(`👍 ${s.title}`, 90, y);
    y += 56;
  }
  if (i) {
    ctx.fillStyle = '#ffc857';
    ctx.font = font(700, 32);
    ctx.fillText(`🎯 ${truncate(ctx, i.title, W - 200)}`, 90, y);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#857b96';
  ctx.font = font(500, 26);
  const d = new Date(session.date);
  ctx.fillText(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`, W - 70, H - 50);

  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  return new File([blob], `ききごこち_${session.title}.png`, { type: 'image/png' });
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- バックアップ（型付き配列を base64 で） ----------
function f32ToB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToF32(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function toBackupJSON(obj) {
  return JSON.stringify(obj, (k, v) => (v instanceof Float32Array ? { __f32: f32ToB64(v) } : v));
}

export function fromBackupJSON(text) {
  return JSON.parse(text, (k, v) => (v && typeof v === 'object' && typeof v.__f32 === 'string' ? b64ToF32(v.__f32) : v));
}
