// Auto captions: taps the player's audio and feeds it to the Whisper worker.
//
// The audio is read from the <video> element. When hls.js plays a stream the
// media comes through fetch (with CORS), so the browser lets us read it. A
// stream played natively from another site without CORS would give silence.

// AudioWorklet that forwards mono audio in ~250 ms blocks
const WORKLET_SOURCE = `
class CaptionTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(Math.round(sampleRate / 4));
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < input.length; c++) sum += input[c][i];
        this.block[this.filled++] = sum / input.length;
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('caption-tap', CaptionTap);
`;

let worker = null;
let workerState = { ready: false, device: null };
const listeners = new Set();
const pending = new Map(); // translation id -> { resolve, reject }
let nextId = 1;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/whisperWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'ready') workerState = { ready: true, device: msg.device };
      if (msg.type === 'translated' || msg.type === 'translate-error') {
        const job = pending.get(msg.id);
        pending.delete(msg.id);
        if (job) {
          if (msg.type === 'translated') job.resolve(msg.text);
          else job.reject(new Error(msg.message));
        }
        return;
      }
      if (msg.type === 'error' && msg.fatal) {
        // Let the next attempt start from scratch
        worker.terminate();
        worker = null;
        workerState = { ready: false, device: null };
        pending.forEach(job => job.reject(new Error(msg.message)));
        pending.clear();
      }
      listeners.forEach(fn => fn(msg));
    };
  }
  return worker;
}

// An element can only ever have one MediaElementSource, so keep it around
const elementSources = new WeakMap();

function connectElement(ctx, video) {
  // Chrome, Edge: a copy of the audio that ignores the player's mute/volume
  if (typeof video.captureStream === 'function') {
    const stream = video.captureStream();
    return new Promise((resolve, reject) => {
      const attach = () => {
        if (!stream.getAudioTracks().length) return false;
        stream.removeEventListener('addtrack', attach);
        resolve({ node: ctx.createMediaStreamSource(stream), stream });
        return true;
      };
      if (!attach()) {
        stream.addEventListener('addtrack', attach);
        setTimeout(() => {
          stream.removeEventListener('addtrack', attach);
          reject(new Error('This stream has no audio'));
        }, 10000);
      }
    });
  }
  // Firefox, Safari: route the element through Web Audio (playback still
  // goes to the speakers through the same graph)
  let entry = elementSources.get(video);
  if (!entry || entry.ctx !== ctx) {
    if (entry) throw new Error('Reload the page to restart auto captions');
    entry = { ctx, node: ctx.createMediaElementSource(video) };
    entry.node.connect(ctx.destination);
    elementSources.set(video, entry);
  }
  return Promise.resolve({ node: entry.node, stream: null });
}

let sharedCtx = null;

/**
 * Start auto captions for a video element.
 * onEvent receives { type: 'progress' | 'ready' | 'listening' | 'text' | 'error', ... }
 * Returns a stop() function.
 */
export function startAutoCaptions(video, { task = 'transcribe', onEvent }) {
  let stopped = false;
  let tapNode = null;
  let sourceNode = null;
  let capture = null;

  const onMessage = (msg) => { if (!stopped) onEvent(msg); };
  listeners.add(onMessage);

  const w = getWorker();
  w.postMessage({ type: 'reset' });
  w.postMessage({ type: 'load', options: { task } });
  if (workerState.ready) onEvent({ type: 'ready', device: workerState.device });

  (async () => {
    // A context created outside a click starts suspended; the CC menu click
    // that turned captions on counts as one.
    if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
    const ctx = sharedCtx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (!ctx.audioWorklet) throw new Error("This browser can't read the stream's audio");
    if (!ctx.__captionTapLoaded) {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      ctx.__captionTapLoaded = true;
    }
    if (stopped) return;
    capture = await connectElement(ctx, video);
    if (stopped) return;
    sourceNode = capture.node;
    tapNode = new AudioWorkletNode(ctx, 'caption-tap');
    tapNode.port.onmessage = (event) => {
      if (stopped || video.paused) return;
      w.postMessage({ type: 'audio', samples: event.data, sampleRate: ctx.sampleRate }, [event.data.buffer]);
    };
    sourceNode.connect(tapNode);
    // Keep the worklet running without making extra sound
    const silent = ctx.createGain();
    silent.gain.value = 0;
    tapNode.connect(silent).connect(ctx.destination);
    tapNode.__silent = silent;
    onEvent({ type: 'listening' });
  })().catch(err => {
    if (!stopped) onEvent({ type: 'error', fatal: true, message: err?.message || String(err) });
  });

  return () => {
    stopped = true;
    listeners.delete(onMessage);
    try {
      if (tapNode) {
        tapNode.port.onmessage = null;
        sourceNode?.disconnect(tapNode);
        tapNode.disconnect();
        tapNode.__silent?.disconnect();
      }
      // A captureStream source belongs to us alone; the element source stays
      // connected to the speakers.
      if (capture?.stream) capture.node.disconnect();
    } catch {
      // already disconnected
    }
    worker?.postMessage({ type: 'reset' });
  };
}

// English -> target with a small Opus-MT model in the worker
export function translateInWorker(text, target) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'translate', id, text, target });
  });
}

// Model download progress for translateInWorker: fn({ target, loaded, total })
export function onWorkerTranslationProgress(fn) {
  const listener = (msg) => { if (msg.type === 'mt-progress') fn(msg); };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAutoCaptionTask(task) {
  worker?.postMessage({ type: 'options', options: { task } });
}

export function autoCaptionsSupported() {
  return typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof AudioWorkletNode !== 'undefined';
}
