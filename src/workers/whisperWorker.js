// Auto captions: runs a Whisper speech model in the browser, off the main
// thread. Receives raw audio from the player and posts back caption text.
//
// transformers.js (with the ONNX runtime, ~25 MB of wasm) comes from a CDN on
// first use, so it never weighs on the app's own build. The speech model comes
// from the Hugging Face hub; the browser caches both.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

let pipeline = null;
async function loadLibrary() {
  if (pipeline) return;
  const mod = await import(/* @vite-ignore */ TRANSFORMERS_URL);
  mod.env.allowLocalModels = false;
  pipeline = mod.pipeline;
}

const SAMPLE_RATE = 16000;
const MIN_CHUNK_S = 3;      // transcribe once this much audio is buffered...
const MAX_CHUNK_S = 6;      // ...and never wait for more than this
const MAX_BACKLOG_S = 12;   // drop old audio if the model can't keep up
const SILENCE_RMS = 0.006;  // quieter than this: nothing to caption

// Bigger model on WebGPU, tiny one on the CPU so it keeps up in real time
const MODELS = {
  webgpu: {
    id: 'onnx-community/whisper-base',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
  wasm: {
    id: 'onnx-community/whisper-tiny',
    dtype: 'q8',
  },
  // Older export of the same model, in case the one above can't be fetched
  wasmFallback: {
    id: 'Xenova/whisper-tiny',
    dtype: 'q8',
  },
};

// Whisper "hears" these in music and silence
const HALLUCINATIONS = [
  /^(thank you|thanks)( (so|very) much)?( for watching)?[.!]*$/i,
  /^(please )?subscribe/i,
  /^you\.?$/i,
  /^bye[.!]*$/i,
  /subtitles? (by|made by)/i,
  /amara\.org/i,
];

let asr = null;
let device = null;
let options = { task: 'transcribe' };
let buffer = new Float32Array(0);
let busy = false;

async function pickDevice() {
  try {
    if (self.navigator?.gpu && (await self.navigator.gpu.requestAdapter())) return 'webgpu';
  } catch {
    // fall through to the CPU
  }
  return 'wasm';
}

async function load() {
  await loadLibrary();
  device = await pickDevice();
  const model = MODELS[device];
  const files = new Map();
  const progress_callback = (info) => {
    if (info.status === 'progress' && info.total) {
      files.set(info.file, { loaded: info.loaded, total: info.total });
      let loaded = 0;
      let total = 0;
      files.forEach(f => { loaded += f.loaded; total += f.total; });
      self.postMessage({ type: 'progress', loaded, total });
    }
  };
  const tryLoad = (m, dev) => pipeline('automatic-speech-recognition', m.id, { device: dev, dtype: m.dtype, progress_callback });
  try {
    asr = await tryLoad(model, device);
  } catch (err) {
    // Some GPUs advertise WebGPU but can't run the model: use the CPU
    console.warn('Auto captions: falling back to the CPU model', err);
    device = 'wasm';
    files.clear();
    try {
      asr = await tryLoad(MODELS.wasm, device);
    } catch {
      asr = await tryLoad(MODELS.wasmFallback, device);
    }
  }
  // Warm up so the first real caption isn't slow
  await asr(new Float32Array(SAMPLE_RATE), { task: 'transcribe' });
  self.postMessage({ type: 'ready', device });
}

// Linear resampling to the 16 kHz Whisper expects
function resample(samples, fromRate) {
  if (fromRate === SAMPLE_RATE) return samples;
  const ratio = fromRate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const next = idx + 1 < samples.length ? samples[idx + 1] : samples[idx];
    out[i] = samples[idx] * (1 - frac) + next * frac;
  }
  return out;
}

function append(samples) {
  const merged = new Float32Array(buffer.length + samples.length);
  merged.set(buffer);
  merged.set(samples, buffer.length);
  buffer = merged.length > MAX_BACKLOG_S * SAMPLE_RATE
    ? merged.slice(merged.length - MAX_BACKLOG_S * SAMPLE_RATE)
    : merged;
}

function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

// Cut at the quietest 100 ms between MIN and MAX, so words aren't split
function findCut() {
  const min = MIN_CHUNK_S * SAMPLE_RATE;
  if (buffer.length < min) return 0;
  const max = Math.min(buffer.length, MAX_CHUNK_S * SAMPLE_RATE);
  if (buffer.length < max && buffer.length < min + SAMPLE_RATE) return 0; // wait a little longer
  const win = SAMPLE_RATE / 10;
  let best = max;
  let bestEnergy = Infinity;
  for (let start = min - win; start + win <= max; start += win / 2) {
    const energy = rms(buffer, start, start + win);
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = start + win / 2;
    }
  }
  return Math.floor(best);
}

function clean(text) {
  const t = (text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|♪+|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return '';
  if (HALLUCINATIONS.some(re => re.test(t))) return '';
  return t;
}

async function pump() {
  if (busy || !asr) return;
  const cut = findCut();
  if (!cut) return;
  const chunk = buffer.slice(0, cut);
  buffer = buffer.slice(cut);

  if (rms(chunk) < SILENCE_RMS) {
    self.postMessage({ type: 'text', text: '' });
    pump();
    return;
  }

  busy = true;
  const started = performance.now();
  try {
    const result = await asr(chunk, {
      task: options.task,
      language: options.task === 'translate' ? null : options.language || null,
    });
    self.postMessage({
      type: 'text',
      text: clean(result?.text),
      seconds: chunk.length / SAMPLE_RATE,
      took: (performance.now() - started) / 1000,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  } finally {
    busy = false;
  }
  pump();
}

// ---------------------------------------------------------------------------
// English -> other language translation (used when the browser has no
// built-in Translator). One small Opus-MT model per target language.
// ---------------------------------------------------------------------------
const translators = new Map(); // target -> Promise<pipeline>

function getTranslator(target) {
  if (!translators.has(target)) {
    const files = new Map();
    const progress_callback = (info) => {
      if (info.status === 'progress' && info.total) {
        files.set(info.file, { loaded: info.loaded, total: info.total });
        let loaded = 0;
        let total = 0;
        files.forEach(f => { loaded += f.loaded; total += f.total; });
        self.postMessage({ type: 'mt-progress', target, loaded, total });
      }
    };
    const promise = loadLibrary()
      .then(() => pipeline('translation', `Xenova/opus-mt-en-${target}`, { device: 'wasm', dtype: 'q8', progress_callback }))
      .catch(err => {
        translators.delete(target);
        throw err;
      });
    translators.set(target, promise);
  }
  return translators.get(target);
}

async function translate({ id, text, target }) {
  try {
    const mt = await getTranslator(target);
    const out = await mt(text);
    self.postMessage({ type: 'translated', id, text: (out?.[0]?.translation_text || '').trim() });
  } catch (err) {
    self.postMessage({ type: 'translate-error', id, message: err?.message || String(err) });
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'translate') {
    translate(msg);
    return;
  }
  if (msg.type === 'load') {
    options = { ...options, ...msg.options };
    try {
      if (!asr) await load();
      else self.postMessage({ type: 'ready', device });
    } catch (err) {
      self.postMessage({ type: 'error', fatal: true, message: err?.message || String(err) });
    }
  } else if (msg.type === 'options') {
    options = { ...options, ...msg.options };
  } else if (msg.type === 'audio') {
    append(resample(msg.samples, msg.sampleRate));
    pump();
  } else if (msg.type === 'reset') {
    buffer = new Float32Array(0);
  }
};
