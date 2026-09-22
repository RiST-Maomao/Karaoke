// オーディオ入出力：マイク取得、ワーカーへのストリーミング、録音の保持、再生、伴奏、基準音

import { concatFloat32, HalfDecimator } from './pcm.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.onChunk = null; // (Float32Array) => void
    this.recording = false;
    this.chunks = [];
    this.playSrc = null;
    this.accompBuffer = null;
    this.accompSrc = null;
    this.accompGain = null;
    this.toneOsc = null;
    this.wakeLock = null;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  /** ユーザー操作の中で呼ぶこと（iOS の自動再生制限） */
  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {}
    }
    return this.ctx;
  }

  /** 伴奏が鳴ってから、それに合わせた声が録音されるまでの遅れ（出力＋入力）の推定値 */
  get roundTripLatency() {
    const c = this.ctx;
    if (!c) return 0.04;
    return (c.outputLatency || 0.02) + (c.baseLatency || 0.01) + 0.01;
  }

  get micOpen() {
    return !!this.stream;
  }

  async openMic() {
    await this.ensureContext();
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('このブラウザはマイク入力に対応していません（HTTPS でアクセスしているか確認してください）');
    }
    // 歌の解析のため、エコーキャンセル・ノイズ抑制・自動音量調整はすべて切る
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const ctx = this.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    const deliver = (data) => {
      // 保存・再生用の録音はメモリ節約のため 44.1k/48k → 半分のレートで持つ（解析はフル帯域のまま）
      if (this.recording) this.chunks.push(this.decimator ? this.decimator.process(data) : data);
      if (this.onChunk) this.onChunk(data);
    };
    try {
      if (!ctx.audioWorklet) throw new Error('no worklet');
      if (!this._workletLoaded) {
        await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
        this._workletLoaded = true;
      }
      this.node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      this.node.port.onmessage = (e) => deliver(e.data);
    } catch {
      // 古い環境向けフォールバック
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => deliver(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.node = sp;
    }
    this.source.connect(this.node);
    this.node.connect(this.sink);
  }

  closeMic() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.node = null;
  }

  /** 接続中の入力デバイス名（許可後のみ取得可） */
  inputLabel() {
    const t = this.stream?.getAudioTracks()[0];
    return t ? t.label : '';
  }

  startRecording() {
    this.chunks = [];
    this.decimator = this.sampleRate >= 44100 ? new HalfDecimator() : null;
    this.recording = true;
    this.recordStartTime = this.ctx.currentTime;
    this.requestWakeLock();
  }

  stopRecording() {
    this.recording = false;
    if (this.node?.port) this.node.port.postMessage('flush');
    this.releaseWakeLock();
    const pcm = concatFloat32(this.chunks);
    this.chunks = [];
    return { pcm, sampleRate: this.decimator ? this.sampleRate / 2 : this.sampleRate };
  }

  // ---------- 再生 ----------
  /**
   * 録音を再生。withAccomp が true なら、読み込み中の伴奏も同じ位置から重ねて鳴らす。
   * 録音はマイク入力＋出力の遅延ぶん伴奏より遅れて記録されているので、その分だけ声を前に詰める。
   */
  playPcm(pcm, sampleRate, from = 0, to = null, onEnd = null, withAccomp = false) {
    this.stopPlayback();
    const ctx = this.ctx;
    if (!this._pcmCache || this._pcmCache.pcm !== pcm) {
      const b = ctx.createBuffer(1, pcm.length, sampleRate);
      b.copyToChannel(pcm, 0);
      this._pcmCache = { pcm, buf: b };
    }
    const buf = this._pcmCache.buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const dur = to != null ? Math.max(0.05, to - from) : undefined;
    const t0 = ctx.currentTime + 0.05;
    if (withAccomp && this.accompBuffer) {
      const latency = this.roundTripLatency;
      const a = ctx.createBufferSource();
      a.buffer = this.accompBuffer;
      const g = ctx.createGain();
      g.gain.value = 0.55;
      a.connect(g).connect(ctx.destination);
      a.start(t0, Math.max(0, from), dur);
      this.playAccompSrc = a;
      src.start(t0, Math.max(0, from + latency), dur);
    } else {
      src.start(t0, Math.max(0, from), dur);
    }
    src.onended = () => {
      if (this.playSrc === src) this.playSrc = null;
      onEnd && onEnd();
    };
    this.playSrc = src;
    this.playStartedAt = t0;
    this.playFrom = Math.max(0, from);
    return src;
  }

  playbackPosition() {
    if (!this.playSrc) return null;
    return this.playFrom + Math.max(0, this.ctx.currentTime - this.playStartedAt);
  }

  stopPlayback() {
    if (this.playAccompSrc) {
      try {
        this.playAccompSrc.stop();
      } catch {}
      this.playAccompSrc = null;
    }
    if (this.playSrc) {
      const s = this.playSrc;
      this.playSrc = null;
      try {
        s.onended = null;
        s.stop();
      } catch {}
    }
  }

  // ---------- 伴奏 ----------
  async loadAccompaniment(file) {
    await this.ensureContext();
    const ab = await file.arrayBuffer();
    this.accompBuffer = await this.ctx.decodeAudioData(ab);
    return this.accompBuffer.duration;
  }

  clearAccompaniment() {
    this.stopAccompaniment();
    this.accompBuffer = null;
  }

  startAccompaniment(volume = 0.8) {
    if (!this.accompBuffer) return;
    this.stopAccompaniment();
    const ctx = this.ctx;
    this.accompGain = ctx.createGain();
    this.accompGain.gain.value = volume;
    this.accompGain.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = this.accompBuffer;
    src.connect(this.accompGain);
    src.start();
    this.accompSrc = src;
    return src;
  }

  setAccompVolume(v) {
    if (this.accompGain) this.accompGain.gain.value = v;
  }

  stopAccompaniment() {
    if (this.accompSrc) {
      try {
        this.accompSrc.onended = null;
        this.accompSrc.stop();
      } catch {}
      this.accompSrc = null;
    }
  }

  // ---------- 基準音（練習用） ----------
  playTone(hz, seconds = 1.2) {
    this.stopTone();
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.03);
    g.gain.setValueAtTime(0.25, t + seconds - 0.15);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    this.toneOsc = osc;
  }

  stopTone() {
    try {
      this.toneOsc?.stop();
    } catch {}
    this.toneOsc = null;
  }

  // ---------- 画面スリープ防止 ----------
  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }

  releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch {}
    this.wakeLock = null;
  }
}
