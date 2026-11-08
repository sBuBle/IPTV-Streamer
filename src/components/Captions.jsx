import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Captions, CaptionsOff, Check, Sparkles, Languages, AlertTriangle } from 'lucide-preact';

function formatMB(bytes) {
  return bytes ? `${Math.round(bytes / 1e6)} MB` : '';
}

// Caption text over the video, sized to the player (cqw = % of its width)
export function CaptionOverlay({ lines, isAuto, autoStatus, raised, compact }) {
  let status = null;
  if (isAuto && autoStatus) {
    if (autoStatus.error) {
      status = { tone: 'error', text: autoStatus.error };
    } else if (!autoStatus.modelReady) {
      const pct = Math.round((autoStatus.progress || 0) * 100);
      status = { tone: 'info', text: `Downloading speech model${pct ? ` · ${pct}%` : '…'}` };
    } else if (!lines.length && autoStatus.listening) {
      status = { tone: 'info', text: 'Listening…' };
    }
  }
  if (!lines.length && !status) return null;

  return (
    <div
      className={`absolute inset-x-0 z-20 flex flex-col items-center gap-1 px-[6%] pointer-events-none transition-[bottom] duration-200 ${raised ? (compact ? 'bottom-14' : 'bottom-24 sm:bottom-28') : 'bottom-[6%]'}`}
      aria-live="polite"
    >
      {lines.length > 0 && (
        <div className={`caption-text text-center font-semibold leading-snug ${compact ? 'text-[clamp(0.7rem,3.2cqw,1rem)]' : 'text-[clamp(0.85rem,2.6cqw,2rem)]'}`}>
          {lines.map((line, i) => (
            <div key={`${i}-${line}`}>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
      {status && !compact && (
        <span className={`inline-flex items-center gap-1.5 max-w-full h-7 px-3 rounded-full text-xs font-semibold backdrop-blur-md ring-1 ${status.tone === 'error'
          ? 'bg-rose-950/80 text-rose-200 ring-rose-400/30'
          : 'bg-[rgb(18_17_29/0.78)] text-[var(--color-lilac)] ring-white/10'}`}
        >
          {status.tone === 'error'
            ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            : <Sparkles className="w-3.5 h-3.5 shrink-0 animate-pulse" />}
          <span className="truncate">{status.text}</span>
        </span>
      )}
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
  const { tracks, selected, select, autoStatus, autoSupported, isAuto } = captions;

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
      autoHint = `Running on ${autoStatus.device === 'webgpu' ? 'GPU' : 'CPU'} · a few seconds behind`;
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute bottom-full right-0 mb-2 w-64 max-h-[min(24rem,calc(56cqw-6rem),70vh)] min-h-28 overflow-y-auto overscroll-contain bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl shadow-[var(--shadow-card-hover)] p-1.5 z-40"
    >
      <div className="text-xs text-gray-400 mb-1 px-2 pt-0.5">Subtitles</div>
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
            Auto captions
            <span className="ml-auto text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-violet-500/20 text-[var(--color-lilac)]">Beta</span>
          </div>
          <MenuItem
            active={selected === 'auto'}
            onClick={() => pick('auto')}
            icon={<Sparkles className="w-4 h-4" />}
            hint={selected === 'auto' ? autoHint : 'In the language spoken'}
          >
            Original language
          </MenuItem>
          <MenuItem
            active={selected === 'auto-en'}
            onClick={() => pick('auto-en')}
            icon={<Languages className="w-4 h-4" />}
            hint={selected === 'auto-en' ? autoHint : 'Any language, shown in English'}
          >
            Translate to English
          </MenuItem>
          {isAuto && autoStatus?.error && (
            <p className="px-3 py-1.5 text-xs text-rose-300">{autoStatus.error}</p>
          )}
          {!autoStatus?.modelReady && !isAuto && (
            <p className="px-3 pt-1 pb-1.5 text-[11px] leading-snug text-gray-400">
              First use downloads a speech model (about 40 to 120 MB) that runs in your browser. Audio never leaves your device.
            </p>
          )}
        </>
      )}
    </div>
  );
}
