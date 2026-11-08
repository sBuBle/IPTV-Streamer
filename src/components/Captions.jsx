import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Captions, CaptionsOff, Check, Sparkles, Languages, AlertTriangle, ChevronDown } from 'lucide-preact';
import { TARGET_LANGUAGES } from '../utils/captionTranslate';

function languageLabel(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function formatMB(bytes) {
  return bytes ? `${Math.round(bytes / 1e6)} MB` : '';
}

// Where the picture actually is inside the <video> box (object-contain leaves
// black bars when the shapes differ, e.g. 4:3 channels or ultrawide screens)
function usePictureRect(videoRef) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const update = () => {
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!cw || !ch) return;
      if (!vw || !vh) {
        setRect({ left: 0, top: 0, width: cw, height: ch, boxHeight: ch });
        return;
      }
      const scale = Math.min(cw / vw, ch / vh);
      const width = vw * scale;
      const height = vh * scale;
      setRect(prev => {
        const next = { left: (cw - width) / 2, top: (ch - height) / 2, width, height, boxHeight: ch };
        return prev && ['left', 'top', 'width', 'height', 'boxHeight'].every(k => Math.abs(prev[k] - next[k]) < 0.5) ? prev : next;
      });
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(video);
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, [videoRef]);
  return rect;
}

// Caption text drawn on the picture itself, the way TV subtitles look:
// white lettering with a dark outline, sized to the picture (cqw = % of its
// width), sitting in the lower part of the image.
export function CaptionOverlay({ videoRef, lines, isAuto, autoStatus, translateStatus, targetLabel, raised, compact }) {
  const rect = usePictureRect(videoRef);

  let status = null;
  if (isAuto && autoStatus?.error) {
    status = { tone: 'error', text: autoStatus.error };
  } else if (translateStatus?.error) {
    status = { tone: 'error', text: translateStatus.error };
  } else if (isAuto && autoStatus && !autoStatus.modelReady) {
    const pct = Math.round((autoStatus.progress || 0) * 100);
    status = { tone: 'info', text: `Downloading speech model${pct ? ` · ${pct}%` : '…'}` };
  } else if (translateStatus && 'progress' in translateStatus) {
    const pct = Math.round((translateStatus.progress || 0) * 100);
    status = { tone: 'info', text: `Downloading ${targetLabel || 'translation'}${pct ? ` · ${pct}%` : '…'}` };
  } else if (isAuto && !lines.length && autoStatus?.listening) {
    status = { tone: 'info', text: 'Listening…' };
  }
  if ((!lines.length && !status) || !rect) return null;

  // Keep clear of the control bar when it shows (it covers ~6rem of the box)
  const barBelowPicture = rect.boxHeight - (rect.top + rect.height);
  const controls = raised ? (compact ? 56 : 104) : 0;
  const bottom = Math.max(rect.height * 0.07, controls - barBelowPicture);

  return (
    <div
      className="absolute z-20 pointer-events-none @container"
      style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
    >
      <div
        className="absolute inset-x-0 flex flex-col items-center gap-2 px-[8%] transition-[bottom] duration-200"
        style={{ bottom: `${bottom}px` }}
        aria-live="polite"
      >
        {lines.length > 0 && (
          <div className={`caption-text text-center ${compact ? 'text-[clamp(0.75rem,3.8cqw,1.1rem)]' : 'text-[clamp(0.95rem,3.3cqw,2.6rem)]'}`}>
            {lines.map((line, i) => (
              <div key={`${i}-${line}`}>{line}</div>
            ))}
          </div>
        )}
        {status && !compact && (
          <span className={`inline-flex items-center gap-1.5 max-w-full h-7 px-3 rounded-full text-xs font-semibold backdrop-blur-md ring-1 ${status.tone === 'error'
            ? 'bg-rose-950/80 text-rose-200 ring-rose-400/30'
            : 'bg-[rgb(18_17_29/0.7)] text-[var(--color-lilac)] ring-white/10'}`}
          >
            {status.tone === 'error'
              ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              : <Sparkles className="w-3.5 h-3.5 shrink-0 animate-pulse" />}
            <span className="truncate">{status.text}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function MenuItem({ active, onClick, icon, children, hint }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-violet-500/25 text-white' : 'text-gray-200 hover:bg-white/10'}`}
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center text-[var(--color-lilac)]">
        {active ? <Check className="w-4 h-4" /> : icon}
      </span>
      <span className="min-w-0 grow">
        <span className="block truncate">{children}</span>
        {hint && <span className="block text-[11px] text-gray-400 truncate">{hint}</span>}
      </span>
    </button>
  );
}

// Track picker for the control bar
export function CaptionMenu({ captions, onClose }) {
  const ref = useRef(null);
  const { tracks, selected, select, autoStatus, autoSupported, isAuto, target, setTarget, spoken, setSpoken } = captions;

  // Close on outside click / Escape
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[aria-label="Subtitles"]')) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (key) => {
    select(key);
    onClose();
  };

  let autoHint = 'Speech to text on this device';
  if (isAuto && autoStatus) {
    if (autoStatus.error) autoHint = null;
    else if (!autoStatus.modelReady) {
      autoHint = `Downloading model ${Math.round((autoStatus.progress || 0) * 100)}%${autoStatus.total ? ` of ${formatMB(autoStatus.total)}` : ''}`;
    } else {
      const heard = autoStatus.detected ? `Hearing ${languageLabel(autoStatus.detected)}` : 'Listening';
      autoHint = `${heard} · ${autoStatus.device === 'webgpu' ? 'GPU' : 'CPU'}`;
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute bottom-full right-0 mb-2 w-64 max-h-[min(24rem,calc(56cqw-6rem),70vh)] min-h-28 overflow-y-auto overscroll-contain bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl shadow-[var(--shadow-card-hover)] p-1.5 z-40"
    >
      <div className="text-xs text-gray-400 mb-1 px-2 pt-0.5">Subtitles</div>
      <label className="flex items-center gap-2 px-2 pb-1.5 mb-1 border-b border-white/10" title="Translated on this device">
        <Languages className="w-4 h-4 shrink-0 text-[var(--color-lilac)]" />
        <span className="text-sm text-gray-200 shrink-0">Show in</span>
        <span className="relative grow min-w-0">
          <select
            value={target}
            onChange={(e) => setTarget(e.currentTarget.value)}
            aria-label="Subtitle language"
            className="w-full appearance-none h-8 pl-2.5 pr-7 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 focus:ring-[var(--color-lilac)] outline-none text-sm text-white cursor-pointer truncate"
          >
            <option value="">Original language</option>
            {TARGET_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </span>
      </label>
      <MenuItem active={selected === 'off'} onClick={() => pick('off')} icon={<CaptionsOff className="w-4 h-4" />}>
        Off
      </MenuItem>
      {tracks.map(track => (
        <MenuItem key={track.key} active={selected === track.key} onClick={() => pick(track.key)} icon={<Captions className="w-4 h-4" />}>
          {track.label}
        </MenuItem>
      ))}
      {tracks.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-gray-400">This channel doesn't send subtitles.</p>
      )}

      {autoSupported && (
        <>
          <div className="mt-1.5 pt-2 border-t border-white/10 px-2 mb-1 flex items-center gap-1.5 text-xs text-gray-400">
            <Sparkles className="w-3.5 h-3.5 text-[var(--color-lilac)]" />
            No subtitles? Generate them
            <span className="ml-auto text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-violet-500/20 text-[var(--color-lilac)]">Beta</span>
          </div>
          <MenuItem
            active={isAuto}
            onClick={() => pick('auto')}
            icon={<Sparkles className="w-4 h-4" />}
            hint={isAuto ? autoHint : 'Speech to text on this device'}
          >
            Auto captions
          </MenuItem>
          {isAuto && (
            <label className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-xs text-gray-400 shrink-0">Spoken</span>
              <span className="relative grow min-w-0">
                <select
                  value={spoken}
                  onChange={(e) => setSpoken(e.currentTarget.value)}
                  aria-label="Spoken language"
                  className="w-full appearance-none h-7 pl-2 pr-6 rounded-md bg-white/5 hover:bg-white/10 ring-1 ring-white/10 focus:ring-[var(--color-lilac)] outline-none text-xs text-white cursor-pointer truncate"
                >
                  <option value="">Detect automatically</option>
                  {TARGET_LANGUAGES.map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </span>
            </label>
          )}
          {isAuto && autoStatus?.error && (
            <p className="px-3 py-1.5 text-xs text-rose-300">{autoStatus.error}</p>
          )}
          {!autoStatus?.modelReady && !isAuto && (
            <p className="px-3 pt-1 pb-1.5 text-[11px] leading-snug text-gray-400">
              First use downloads a 40 to 120 MB speech model. Audio stays on your device.
            </p>
          )}
        </>
      )}

    </div>
  );
}
