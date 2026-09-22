// マイク入力を 2048 サンプル単位でメインスレッドへ送る AudioWorklet
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush' && this.n > 0) {
        this.port.postMessage(this.buf.slice(0, this.n));
        this.n = 0;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
