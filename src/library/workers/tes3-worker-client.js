export class Tes3WorkerClient {
  #worker;
  #pending = new Map();
  #nextId = 1;

  constructor(workerUrl = new URL('./tes3-worker.js', import.meta.url)) {
    this.#worker = new Worker(workerUrl, { type: 'module', name: 'oaab-tes3-parser' });
    this.#worker.addEventListener('message', (event) => this.#onMessage(event));
    this.#worker.addEventListener('error', (event) => this.#failAll(event.error || event.message));
  }

  version() {
    return this.#request('version');
  }

  parseNif(bytes, animationBytes = null) {
    const buffer = toStandaloneArrayBuffer(bytes);
    const animationBuffer = animationBytes
      ? toStandaloneArrayBuffer(animationBytes)
      : new ArrayBuffer(0);
    const transfers = animationBuffer.byteLength ? [buffer, animationBuffer] : [buffer];
    return this.#request('parseNif', { bytes: buffer, animationBytes: animationBuffer }, transfers);
  }

  parsePlugin(bytes) {
    const buffer = toStandaloneArrayBuffer(bytes);
    return this.#request('parsePlugin', { bytes: buffer }, [buffer]);
  }

  terminate() {
    this.#worker.terminate();
    this.#failAll(new Error('TES3 worker terminated'));
  }

  #request(op, payload = {}, transfers = []) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, op, ...payload }, transfers);
    });
  }

  #onMessage(event) {
    const { id, ok, result, error } = event.data || {};
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error || 'TES3 worker request failed'));
  }

  #failAll(error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    for (const { reject } of this.#pending.values()) reject(normalized);
    this.#pending.clear();
  }
}

function toStandaloneArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  throw new TypeError('TES3 parser input must be an ArrayBuffer or typed array');
}
