// ストリーミング・フレーム解析器。
// 任意サンプルレートの音声チャンクを受け取り、16kHz に変換して 10ms ごとに
//   f0（McLeod Pitch Method）/ 明瞭度 / 音量 / スペクトル特徴 を算出する。
// 録音中にリアルタイムで回せる程度に軽く、ファイル解析でも同じコードを使う。

import { fft } from './fft.js';

export const ANALYSIS_SR = 16000;
export const HOP = 160; // 10ms
export const WIN = 1024; // 64ms
const FFT_N = 2048;
const MIN_F0 = 70;
const MAX_F0 = 1100;
const MPM_K = 0.9;

/** 窓付き sinc のローパス FIR */
function designLowpass(cutoffNorm, taps) {
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    const sinc = x === 0 ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

/** ストリーミング・リサンプラ（FIR ローパス → 線形補間） */
class Resampler {
  constructor(inRate, outRate) {
    this.ratio = inRate / outRate;
    this.passthrough = inRate === outRate;
    const taps = 95;
    this.h = designLowpass(Math.min(0.45 * outRate, 7200) / inRate, taps);
    this.hist = new Float64Array(taps); // 直近入力の循環バッファ
    this.histPos = 0;
    this.prev = 0; // 直前のフィルタ出力
    this.phase = 0; // 次の出力位置（入力サンプル単位、prev からの相対）
    // DC / 低域ランブル除去（出力側 1 次 HPF 約 50Hz）
    this.hpA = Math.exp((-2 * Math.PI * 50) / outRate);
    this.hpX = 0;
    this.hpY = 0;
  }

  process(input) {
    const out = [];
    if (this.passthrough) {
      for (let i = 0; i < input.length; i++) out.push(this.hp(input[i]));
      return out;
    }
    const { h, hist } = this;
    const taps = h.length;
    if (Number.isInteger(this.ratio)) {
      // 整数比（48k/32k → 16k）は間引きのみ：必要な点でだけ FIR を計算
      const r = this.ratio;
      this.decim = this.decim || 0;
      for (let i = 0; i < input.length; i++) {
        hist[this.histPos] = input[i];
        this.histPos = (this.histPos + 1) % taps;
        if (++this.decim < r) continue;
        this.decim = 0;
        let acc = 0;
        let p = this.histPos;
        for (let k = 0; k < taps; k++) {
          acc += h[k] * hist[p];
          p++;
          if (p === taps) p = 0;
        }
        out.push(this.hp(acc));
      }
      return out;
    }
    for (let i = 0; i < input.length; i++) {
      hist[this.histPos] = input[i];
      this.histPos = (this.histPos + 1) % taps;
      let acc = 0;
      let p = this.histPos;
      for (let k = 0; k < taps; k++) {
        acc += h[k] * hist[p];
        p++;
        if (p === taps) p = 0;
      }
      // prev(=位置0) と acc(=位置1) の間に出力点があれば補間
      while (this.phase <= 1) {
        out.push(this.hp(this.prev + (acc - this.prev) * this.phase));
        this.phase += this.ratio;
      }
      this.phase -= 1;
      this.prev = acc;
    }
    return out;
  }

  hp(x) {
    const y = this.hpA * (this.hpY + x - this.hpX);
    this.hpX = x;
    this.hpY = y;
    return y;
  }
}

const hann = new Float64Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

/** 伸長可能な Float32 配列 */
class Growable {
  constructor(cap = 4096) {
    this.a = new Float32Array(cap);
    this.n = 0;
  }
  push(v) {
    if (this.n === this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}

export const FRAME_FIELDS = ['f0', 'clarity', 'db', 'centroid', 'ring', 'alpha', 'hf'];

export class FrameAnalyzer {
  constructor(inputRate) {
    this.inputRate = inputRate;
    this.resampler = new Resampler(inputRate, ANALYSIS_SR);
    this.buf = new Float64Array(WIN * 4);
    this.bufLen = 0;
    this.frameIndex = 0;
    this.fields = {};
    for (const f of FRAME_FIELDS) this.fields[f] = new Growable();
    // 作業領域
    this.re = new Float64Array(FFT_N);
    this.im = new Float64Array(FFT_N);
    this.sre = new Float64Array(WIN);
    this.sim = new Float64Array(WIN);
    this.nsdf = new Float64Array(Math.ceil(ANALYSIS_SR / MIN_F0) + 4);
  }

  /** 入力チャンクを投入し、新たに確定したフレームの配列を返す */
  push(chunk) {
    const samples = this.resampler.process(chunk);
    const newFrames = [];
    for (let i = 0; i < samples.length; i++) {
      if (this.bufLen === this.buf.length) {
        // 先頭 (bufLen - WIN) を捨てる
        const keep = WIN;
        this.buf.copyWithin(0, this.bufLen - keep, this.bufLen);
        this.bufLen = keep;
      }
      this.buf[this.bufLen++] = samples[i];
      this.sinceHop = (this.sinceHop || 0) + 1;
      if (this.bufLen >= WIN && this.sinceHop >= HOP) {
        this.sinceHop = 0;
        newFrames.push(this.analyzeFrame(this.buf.subarray(this.bufLen - WIN, this.bufLen)));
      } else if (this.bufLen < WIN && this.sinceHop >= HOP) {
        // 窓が満ちるまでの先頭フレームは無音扱い
        this.sinceHop = 0;
        newFrames.push(this.emit({ f0: 0, clarity: 0, db: -100, centroid: 0, ring: 0, alpha: 0, hf: 0 }));
      }
    }
    return newFrames;
  }

  emit(fr) {
    fr.i = this.frameIndex++;
    fr.t = ((fr.i + 1) * HOP - WIN / 2) / ANALYSIS_SR; // 窓中心の時刻（秒）
    for (const f of FRAME_FIELDS) this.fields[f].push(fr[f]);
    return fr;
  }

  analyzeFrame(x) {
    // 音量：窓中央 20ms の RMS
    let e = 0;
    const c0 = (WIN >> 1) - 160;
    for (let i = c0; i < c0 + 320; i++) e += x[i] * x[i];
    const db = 10 * Math.log10(e / 320 + 1e-12);

    let f0 = 0;
    let clarity = 0;
    if (db > -70) {
      const r = this.mpm(x);
      f0 = r.f0;
      clarity = r.clarity;
    }
    const spec = this.spectral(x);
    return this.emit({ f0, clarity, db, ...spec });
  }

  /** McLeod Pitch Method */
  mpm(x) {
    const { re, im, nsdf } = this;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = x[i];
    fft(re, im);
    for (let i = 0; i < FFT_N; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    fft(re, im, true); // re = 自己相関
    const maxTau = Math.min(nsdf.length - 1, Math.floor(ANALYSIS_SR / MIN_F0) + 2);
    let m = 0;
    for (let i = 0; i < WIN; i++) m += 2 * x[i] * x[i];
    for (let tau = 0; tau <= maxTau; tau++) {
      nsdf[tau] = m > 0 ? (2 * re[tau]) / m : 0;
      m -= x[tau] * x[tau] + x[WIN - 1 - tau] * x[WIN - 1 - tau];
    }
    // 正方向ゼロクロス間の極大（key maxima）を収集
    const minTau = Math.floor(ANALYSIS_SR / MAX_F0);
    const peaks = [];
    let tau = 1;
    while (tau < maxTau && nsdf[tau] > 0) tau++; // 最初の負領域まで
    while (tau < maxTau) {
      while (tau < maxTau && nsdf[tau] <= 0) tau++;
      let best = -1;
      let bestTau = -1;
      while (tau < maxTau && nsdf[tau] > 0) {
        if (nsdf[tau] > best) {
          best = nsdf[tau];
          bestTau = tau;
        }
        tau++;
      }
      if (bestTau > 0 && bestTau >= minTau) peaks.push(bestTau);
    }
    if (!peaks.length) return { f0: 0, clarity: 0 };
    let maxVal = 0;
    for (const p of peaks) if (nsdf[p] > maxVal) maxVal = nsdf[p];
    const thr = MPM_K * maxVal;
    let chosen = peaks[0];
    for (const p of peaks) {
      if (nsdf[p] >= thr) {
        chosen = p;
        break;
      }
    }
    // 放物線補間
    const a = nsdf[chosen - 1];
    const b = nsdf[chosen];
    const c = nsdf[chosen + 1] ?? b;
    const den = a - 2 * b + c;
    let shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    if (!Number.isFinite(shift) || Math.abs(shift) > 1) shift = 0;
    const period = chosen + shift;
    const peakVal = b - 0.25 * (a - c) * shift;
    const f0 = ANALYSIS_SR / period;
    if (f0 < MIN_F0 || f0 > MAX_F0) return { f0: 0, clarity: 0 };
    return { f0, clarity: Math.min(1, Math.max(0, peakVal)) };
  }

  spectral(x) {
    const { sre, sim } = this;
    for (let i = 0; i < WIN; i++) {
      sre[i] = x[i] * hann[i];
      sim[i] = 0;
    }
    fft(sre, sim);
    const binHz = ANALYSIS_SR / WIN;
    let e01 = 0, e12 = 0, e24 = 0, e45 = 0, e58 = 0, tot = 0, cent = 0;
    for (let k = 1; k < WIN / 2; k++) {
      const p = sre[k] * sre[k] + sim[k] * sim[k];
      const hz = k * binHz;
      if (hz < 80) continue;
      tot += p;
      cent += p * hz;
      if (hz < 1000) e01 += p;
      else if (hz < 2000) e12 += p;
      else if (hz < 4000) e24 += p;
      else if (hz < 5000) e45 += p;
      else e58 += p;
    }
    const L = (v) => 10 * Math.log10(v + 1e-18);
    return {
      centroid: tot > 0 ? cent / tot : 0,
      ring: L(e24) - L(e01 + e12), // 2–4kHz の「響き・通り」
      alpha: L(e12 + e24 + e45) - L(e01), // 高域/低域バランス
      hf: L(e58) - L(tot), // 5kHz 以上（息漏れ・歯擦音）
    };
  }

  /** これまでの全フレームを typed array で取得 */
  result() {
    // フレーム i の中心時刻 = t0 + i * hop
    const out = { hop: HOP / ANALYSIS_SR, t0: (HOP - WIN / 2) / ANALYSIS_SR, n: this.frameIndex };
    for (const f of FRAME_FIELDS) out[f] = this.fields[f].view().slice();
    return out;
  }
}
