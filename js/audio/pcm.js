// PCM ユーティリティ

/** 録音用のストリーミング 1/2 間引き（15 タップ FIR ローパス） */
export class HalfDecimator {
  constructor() {
    // 半帯域フィルタ（カットオフ ≈ 0.22 fs）
    this.h = [-0.0025, 0, 0.0125, 0, -0.0415, 0, 0.2903, 0.5, 0.2903, 0, -0.0415, 0, 0.0125, 0, -0.0025];
    this.hist = new Float32Array(this.h.length);
    this.pos = 0;
    this.odd = false;
  }

  process(input) {
    const out = new Float32Array(Math.ceil(input.length / 2) + 1);
    let n = 0;
    const { h, hist } = this;
    const L = h.length;
    for (let i = 0; i < input.length; i++) {
      hist[this.pos] = input[i];
      this.pos = (this.pos + 1) % L;
      this.odd = !this.odd;
      if (!this.odd) continue;
      let acc = 0;
      let p = this.pos;
      for (let k = 0; k < L; k++) {
        acc += h[k] * hist[p];
        p = p + 1 === L ? 0 : p + 1;
      }
      out[n++] = acc;
    }
    return out.subarray(0, n);
  }
}

export function concatFloat32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * 保存用に圧縮：半分のサンプルレート（48k→24k）の 16bit に。
 * 簡易ローパス（7 タップ）で折り返しを抑えてから間引く。
 */
export function packForStorage(pcm, sampleRate) {
  const decim = sampleRate >= 32000 ? 2 : 1;
  const h = [-0.0156, 0, 0.2656, 0.5, 0.2656, 0, -0.0156];
  const n = Math.floor(pcm.length / decim);
  const out = new Int16Array(n);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = peak > 0 && peak < 0.25 ? 0.25 / peak : 1; // 小さすぎる録音は量子化ノイズ対策で持ち上げる
  for (let j = 0; j < n; j++) {
    const c = j * decim;
    let v = 0;
    if (decim === 1) v = pcm[c];
    else for (let k = 0; k < 7; k++) v += h[k] * (pcm[c + k - 3] || 0);
    out[j] = Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767)));
  }
  return { data: out, sampleRate: sampleRate / decim, gain };
}

export function unpackStored(stored) {
  const f = new Float32Array(stored.data.length);
  const inv = 1 / 32768 / (stored.gain || 1);
  for (let i = 0; i < f.length; i++) f[i] = stored.data[i] * inv;
  return f;
}

/** WAV（16bit モノラル）に書き出し */
export function encodeWav(int16, sampleRate) {
  const buf = new ArrayBuffer(44 + int16.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + int16.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, int16.length * 2, true);
  new Int16Array(buf, 44).set(int16);
  return new Blob([buf], { type: 'audio/wav' });
}

/** 音声ファイルをデコードしてモノラル Float32 に */
export async function decodeFileToMono(ctx, file) {
  const ab = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(ab);
  const n = buf.length;
  const out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  // 44.1k/48k は半分のレートにしてメモリを節約（解析は 16kHz で行うので影響なし）
  if (buf.sampleRate >= 44100) {
    return { pcm: new HalfDecimator().process(out).slice(), sampleRate: buf.sampleRate / 2 };
  }
  return { pcm: out, sampleRate: buf.sampleRate };
}
