import { useEffect, useState } from 'preact/hooks';

// App preferences, kept in localStorage so the player can read them
// synchronously when it starts a stream.
const STORAGE_KEY = 'app-settings';
const CHANGE_EVENT = 'app-settings-change';

export const DEFAULT_SETTINGS = {
  startMuted: false,
  lowLatency: true,
  bufferSize: 'balanced', // small | balanced | large
  showUpNext: true,
  recordHistory: true,
  historyLimit: 100,
  autoRefreshDays: 0, // 0 = off, otherwise refresh playlists older than this on start
};

// hls.js buffer settings for each "Buffer size" choice
export const BUFFER_PRESETS = {
  small: { maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 10 },
  balanced: { maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30 },
  large: { maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 60 },
};

export function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function write(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage full or blocked: keep the in-memory value */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }
  return next;
}

export function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  // Only keep known keys
  return write(Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, next[key]])));
}

export function resetSettings() {
  return write({ ...DEFAULT_SETTINGS });
}

// Current settings, updated live when they change anywhere in the app
export function useSettings() {
  const [settings, setSettings] = useState(getSettings);
  useEffect(() => {
    const onChange = () => setSettings(getSettings());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return settings;
}
