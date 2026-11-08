// Subtitles for the player: the channel's own tracks (HLS subtitles, CEA-608
// closed captions, or the browser's native tracks) plus in-browser auto
// captions. Cues are drawn by the player itself, never by the browser.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { startAutoCaptions, setAutoCaptionTask, autoCaptionsSupported } from './autoCaptions';
import { translateCaption, prepareTranslation, onTranslationProgress, baseLanguage } from './captionTranslate';

const PREF_KEY = 'player-captions';
const TARGET_KEY = 'player-captions-target'; // '' = show captions as they are
const AUTO_LINE_MS = 9000; // how long an auto caption stays up without a new one

function readPref() {
  try {
    const pref = JSON.parse(localStorage.getItem(PREF_KEY));
    // "auto-en" was the old "Translate to English" item
    if (pref?.mode === 'auto-en') return { mode: 'auto' };
    if (pref && typeof pref.mode === 'string') return pref;
  } catch {
    // ignore
  }
  return { mode: 'off' };
}

function readTarget() {
  try {
    const value = localStorage.getItem(TARGET_KEY);
    if (value != null) return value;
    // Users of the old "Translate to English" item keep getting English
    return JSON.parse(localStorage.getItem(PREF_KEY))?.mode === 'auto-en' ? 'en' : '';
  } catch {
    return '';
  }
}

function writeTarget(value) {
  try {
    localStorage.setItem(TARGET_KEY, value);
  } catch {
    // ignore
  }
}

function writePref(pref) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    // ignore
  }
}

let languageNames = null;
function languageName(code) {
  if (!code) return '';
  try {
    languageNames = languageNames || new Intl.DisplayNames(['en'], { type: 'language' });
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

// Cue text can carry WebVTT tags (<i>, <c.yellow>, <v Speaker>) and entities
function cueText(cue) {
  return (cue?.text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lrm;|&rlm;/g, '')
    .trim();
}

function trackLabel(label, lang, fallback) {
  const name = languageName(lang);
  // Packagers often name tracks "subtitle_0", "CC1", "sub1"...
  if (name && (!label || /^(subtitles?|subs?|text|cc|captions?)[ _-]?\d*$/i.test(label))) {
    return /^cc\d$/i.test(label || '') ? `${name} (${label.toUpperCase()})` : name;
  }
  if (label && name && !label.toLowerCase().includes(name.toLowerCase()) && label.length <= 4) {
    return `${name} (${label})`;
  }
  return label || name || fallback;
}

/**
 * @param videoRef   ref to the <video>
 * @param hlsRef     ref to the hls.js instance (null when playing natively)
 * @param streamKey  changes whenever a new stream is attached
 * @param ready      true once the stream has loaded
 */
export function useCaptions(videoRef, hlsRef, streamKey, ready) {
  const [tracks, setTracks] = useState([]);
  const [selected, setSelected] = useState('off'); // 'off' | track key | 'auto'
  const [target, setTargetState] = useState(readTarget); // translate into this language ('' = no)
  const [shownLines, setShownLines] = useState([]);
  const [translateStatus, setTranslateStatus] = useState(null); // { progress } | { error }
  const [lines, setLines] = useState([]);
  const [trackTick, setTrackTick] = useState(0); // bumps when text tracks change
  const [autoStatus, setAutoStatus] = useState(null); // { modelReady, device, progress, listening, error }
  const prefRef = useRef(readPref());
  const tracksRef = useRef([]);
  tracksRef.current = tracks;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // ---------------------------------------------------------------------------
  // Track list
  // ---------------------------------------------------------------------------
  const refreshTracks = useCallback(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (!video) return;
    const list = [];
    const hlsTextTracks = new Set();

    if (hls) {
      (hls.subtitleTracks || []).forEach((t, index) => {
        if (t.trackNode?.track) hlsTextTracks.add(t.trackNode.track);
        list.push({
          key: `hls:${index}:${t.lang || ''}:${t.name || ''}`,
          label: trackLabel(t.name, t.lang, `Subtitles ${index + 1}`),
          lang: t.lang || '',
          hlsIndex: index,
        });
      });
    }

    const textTracks = Array.from(video.textTracks || []);
    textTracks.forEach((tt, index) => {
      if (tt.kind !== 'subtitles' && tt.kind !== 'captions') return;
      if (hlsTextTracks.has(tt)) return;
      // With hls.js only its in-band closed captions are separate tracks
      if (hls && tt.kind !== 'captions') return;
      if (hls && (hls.subtitleTracks || []).some(t => t.name === tt.label && (t.lang || '') === (tt.language || ''))) return;
      list.push({
        key: `tt:${tt.kind}:${tt.language || ''}:${tt.label || index}`,
        label: trackLabel(tt.label, tt.language, tt.kind === 'captions' ? 'Closed captions' : `Subtitles ${index + 1}`),
        lang: tt.language || '',
        cc: tt.kind === 'captions',
        track: tt,
      });
    });

    setTracks(prev => {
      const same = prev.length === list.length && prev.every((t, i) => t.key === list[i].key && t.track === list[i].track);
      return same ? prev : list;
    });
  }, [videoRef, hlsRef]);

  // Never let the browser draw cues itself: our overlay does that
  const hideNativeRendering = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks || []).forEach(tt => {
      if (tt.mode === 'showing') tt.mode = 'hidden';
    });
  }, [videoRef]);

  // New stream: forget the old tracks
  useEffect(() => {
    setTracks([]);
    setLines([]);
    setSelected(prev => (prev === 'auto' ? prev : 'off'));
  }, [streamKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready) return undefined;
    const hls = hlsRef.current;
    const onChange = () => {
      hideNativeRendering();
      refreshTracks();
      setTrackTick(n => n + 1);
    };
    const list = video.textTracks;
    list?.addEventListener?.('addtrack', onChange);
    list?.addEventListener?.('removetrack', onChange);
    list?.addEventListener?.('change', onChange);
    const hlsEvents = ['hlsSubtitleTracksUpdated', 'hlsSubtitleTrackSwitch', 'hlsManifestParsed'];
    if (hls) hlsEvents.forEach(ev => hls.on(ev, onChange));
    onChange();
    // Safari adds native tracks a little after loadedmetadata
    const late = setTimeout(onChange, 1500);
    return () => {
      clearTimeout(late);
      list?.removeEventListener?.('addtrack', onChange);
      list?.removeEventListener?.('removetrack', onChange);
      list?.removeEventListener?.('change', onChange);
      if (hls) hlsEvents.forEach(ev => hls.off(ev, onChange));
    };
  }, [videoRef, hlsRef, ready, streamKey, refreshTracks, hideNativeRendering]);

  // ---------------------------------------------------------------------------
  // Apply the selection to hls.js / the text tracks
  // ---------------------------------------------------------------------------
  const activeTrackFor = useCallback((key) => {
    const entry = tracksRef.current.find(t => t.key === key);
    if (!entry) return null;
    if (entry.track) return entry.track;
    const hls = hlsRef.current;
    const hlsTrack = hls?.subtitleTracks?.[entry.hlsIndex];
    if (hlsTrack?.trackNode?.track) return hlsTrack.trackNode.track;
    // Older hls.js: find the text track it created for this subtitle track
    return Array.from(videoRef.current?.textTracks || []).find(tt =>
      tt.kind !== 'metadata' && tt.mode !== 'disabled' && tt.label === (hlsTrack?.name || '')) || null;
  }, [hlsRef, videoRef]);

  const [activeTrack, setActiveTrack] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (!video || !ready) {
      setActiveTrack(null);
      return;
    }
    const entry = tracks.find(t => t.key === selected);

    if (hls) {
      hls.subtitleDisplay = false;
      const wanted = entry && entry.hlsIndex != null ? entry.hlsIndex : -1;
      if (hls.subtitleTrack !== wanted) hls.subtitleTrack = wanted;
    } else {
      // Native playback: only the chosen track loads cues
      tracks.forEach(t => {
        if (t.track) t.track.mode = t.key === selected ? 'hidden' : 'disabled';
      });
    }
    if (entry?.track && entry.track.mode === 'disabled') entry.track.mode = 'hidden';
    hideNativeRendering();
    // hls.js creates the text track for a subtitle track only once it's
    // selected, so this runs again on the next text track change.
    setActiveTrack(entry ? activeTrackFor(entry.key) : null);
  }, [selected, tracks, ready, streamKey, trackTick, videoRef, hlsRef, activeTrackFor, hideNativeRendering]);

  // Draw the active track's cues
  useEffect(() => {
    if (!activeTrack) {
      if (selectedRef.current !== 'auto') setLines([]);
      return undefined;
    }
    const onCueChange = () => {
      const cues = Array.from(activeTrack.activeCues || []);
      const text = cues.map(cueText).filter(Boolean).join('\n');
      setLines(text ? text.split('\n').map(s => s.trim()).filter(Boolean) : []);
    };
    activeTrack.addEventListener('cuechange', onCueChange);
    onCueChange();
    return () => activeTrack.removeEventListener('cuechange', onCueChange);
  }, [activeTrack]);

  // Re-apply the last choice when a stream's tracks show up
  useEffect(() => {
    const pref = prefRef.current;
    if (selected !== 'off' || pref.mode !== 'track' || !tracks.length) return;
    const match = tracks.find(t => pref.lang && t.lang === pref.lang)
      || tracks.find(t => pref.label && t.label === pref.label)
      || (pref.cc ? tracks.find(t => t.cc) : null)
      || tracks[0];
    if (match) setSelected(match.key);
  }, [tracks, selected]);

  // ---------------------------------------------------------------------------
  // Auto captions
  // ---------------------------------------------------------------------------
  const isAuto = selected === 'auto';
  // Whisper itself translates speech into English; other targets go
  // through English and then the caption translator.
  const task = target ? 'translate' : 'transcribe';
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    const video = videoRef.current;
    if (!isAuto || !video || !ready) return undefined;
    if (!hlsRef.current) {
      setAutoStatus({ error: "Auto captions can't hear this stream: it plays without hls.js, so the browser won't share its audio." });
      return undefined;
    }
    let clearTimer = null;
    setLines([]);
    setAutoStatus(prev => ({ modelReady: !!prev?.modelReady, device: prev?.device, progress: prev?.progress || 0, listening: false, error: null }));
    const stop = startAutoCaptions(video, {
      task: taskRef.current,
      onEvent: (msg) => {
        if (msg.type === 'progress') {
          setAutoStatus(prev => ({ ...prev, progress: msg.total ? msg.loaded / msg.total : 0, total: msg.total }));
        } else if (msg.type === 'ready') {
          setAutoStatus(prev => ({ ...prev, modelReady: true, device: msg.device }));
        } else if (msg.type === 'listening') {
          setAutoStatus(prev => ({ ...prev, listening: true }));
        } else if (msg.type === 'text') {
          clearTimeout(clearTimer);
          if (msg.text) {
            setLines(prev => [...prev, msg.text].slice(-2));
            clearTimer = setTimeout(() => setLines([]), AUTO_LINE_MS);
          } else {
            setLines([]);
          }
        } else if (msg.type === 'error') {
          if (msg.fatal) setAutoStatus(prev => ({ ...prev, error: msg.message }));
          else console.warn('Auto captions:', msg.message);
        }
      },
    });
    return () => {
      clearTimeout(clearTimer);
      stop();
    };
  }, [isAuto, ready, streamKey, videoRef, hlsRef]);

  useEffect(() => {
    if (isAuto) setAutoCaptionTask(task);
  }, [isAuto, task]);

  useEffect(() => {
    if (!isAuto) setAutoStatus(prev => prev && { ...prev, listening: false, error: null });
  }, [isAuto]);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  const select = useCallback((key) => {
    setSelected(key);
    setLines([]);
    if (key === 'off') {
      prefRef.current = { mode: 'off' };
    } else if (key === 'auto') {
      prefRef.current = { mode: key };
    } else {
      const entry = tracksRef.current.find(t => t.key === key);
      prefRef.current = { mode: 'track', lang: entry?.lang || '', label: entry?.label || '', cc: !!entry?.cc };
    }
    writePref(prefRef.current);
  }, []);

  // Toggle for the "c" key: last choice, or the first track
  const toggle = useCallback(() => {
    if (selectedRef.current !== 'off') {
      select('off');
      return;
    }
    const pref = readPref();
    const list = tracksRef.current;
    if (list.length) {
      const match = list.find(t => pref.lang && t.lang === pref.lang) || list[0];
      select(match.key);
    } else if (pref.mode === 'auto') {
      select('auto');
    }
  }, [select]);

  // ---------------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------------
  const activeEntry = tracks.find(t => t.key === selected);
  const sourceLang = isAuto ? (task === 'translate' ? 'en' : '') : (activeEntry?.lang || '');

  const setTarget = useCallback((value) => {
    setTargetState(value);
    writeTarget(value);
    setTranslateStatus(null);
    // Runs inside the menu click, so the browser may download the model
    const entry = tracksRef.current.find(t => t.key === selectedRef.current);
    prepareTranslation(value, [entry?.lang, 'en']);
  }, []);

  useEffect(() => onTranslationProgress(({ target: t, loaded, total }) => {
    if (t !== target) return;
    setTranslateStatus(total && loaded >= total ? null : { progress: total ? loaded / total : 0 });
  }), [target]);

  useEffect(() => {
    const needsTranslation = target && lines.length && baseLanguage(sourceLang) !== target;
    if (!needsTranslation) {
      setShownLines(lines);
      return undefined;
    }
    let cancelled = false;
    // A subtitle cue's lines are one sentence; auto captions are separate ones
    const parts = isAuto ? lines : [lines.join(' ')];
    Promise.all(parts.map(text => translateCaption(text, { source: sourceLang, target })))
      .then(result => {
        if (cancelled) return;
        setTranslateStatus(null);
        setShownLines(result.filter(Boolean));
      })
      .catch(err => {
        if (cancelled) return;
        setTranslateStatus({ error: err?.message || String(err) });
        setShownLines(lines); // better the original than nothing
      });
    return () => { cancelled = true; };
  }, [lines, target, sourceLang, isAuto]);

  // Auto captions are not restarted silently on a fresh page load (they
  // download a model and need a click to read audio), but they carry over
  // from channel to channel.
  return {
    tracks,
    selected,
    select,
    toggle,
    lines: shownLines,
    target,
    setTarget,
    translateStatus,
    autoStatus,
    autoSupported: autoCaptionsSupported(),
    isAuto,
  };
}
