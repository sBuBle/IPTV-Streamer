import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { usePictureInPicture } from '../contexts/PictureInPictureContext';
import { X, AlertTriangle, PictureInPicture2, Loader, Play } from 'lucide-preact';
import { watchPathForStream } from '../utils/watchLinks';

const BUSY = ['initializing', 'loading', 'restoring', 'activating'];
const NEEDS_CLICK = ['pending', 'needsActivation'];

/** True while there is something to show about picture-in-picture */
export function usePipVisible() {
  const { pipVideo, pipChannel, pipStatus } = usePictureInPicture();
  const on = !!(pipVideo || pipChannel || (pipStatus && pipStatus !== 'inactive'));
  const [visible, setVisible] = useState(on);
  useEffect(() => {
    if (on) {
      setVisible(true);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(false), 300);
    return () => clearTimeout(timer);
  }, [on]);
  return visible;
}

/**
 * Picture-in-picture status, shown as a card in the side menu (it used to
 * float in the bottom-right corner). `collapsed` renders the icon-rail form.
 */
export function PipNavStatus({ collapsed = false, onNavigate }) {
  const { pipChannel, pipStreamUrl, pipError, exitPiP, activatePendingPiP, pipStatus, isSupported } = usePictureInPicture();
  const visible = usePipVisible();
  if (!visible) return null;

  const needsClick = NEEDS_CLICK.includes(pipStatus);
  const busy = BUSY.includes(pipStatus);
  const failed = !isSupported || pipStatus === 'error';
  const name = pipChannel?.name || 'Picture in picture';
  const message = !isSupported
    ? 'Not supported in this browser'
    : needsClick ? 'Click to start picture in picture'
    : busy ? 'Starting…'
    : failed ? (pipError || 'Picture in picture stopped')
    : 'Playing in picture in picture';
  const backHref = pipStreamUrl ? watchPathForStream(pipStreamUrl, pipChannel?.name) : null;

  const icon = failed
    ? <AlertTriangle size={16} class="text-amber-300" />
    : busy ? <Loader size={16} class="text-[var(--color-lilac)] animate-spin" />
    : <PictureInPicture2 size={16} class="text-[var(--color-lilac)]" />;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={needsClick ? activatePendingPiP : exitPiP}
        title={`${name}: ${message}${needsClick ? '' : ' (click to close)'}`}
        aria-label={needsClick ? 'Start picture in picture' : 'Close picture in picture'}
        class={`relative mx-auto w-10 h-10 flex items-center justify-center rounded-[10px] bg-violet-500/12 hover:bg-violet-500/20 transition-colors ${needsClick ? 'animate-pulse' : ''}`}
      >
        {icon}
        {!failed && !busy && <span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-live)] shadow-[0_0_6px_rgb(251_113_133/0.7)]" />}
      </button>
    );
  }

  return (
    <div
      class={`mx-3 p-3 rounded-xl border transition-colors ${
        failed ? 'bg-amber-500/8 border-amber-400/25' : 'bg-violet-500/10 border-violet-400/25'
      }`}
      role="status"
    >
      <div class="flex items-center gap-2 min-w-0">
        {icon}
        {!failed && !busy && !needsClick && <span class="live-badge shrink-0">LIVE</span>}
        <span class="flex-1" />
        {(pipChannel || pipStatus !== 'inactive') && (
          <button
            type="button"
            onClick={exitPiP}
            class="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-subtle)] hover:text-white hover:bg-white/10 transition-colors"
            title="Close picture in picture"
            aria-label="Close picture in picture"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div class="mt-2 text-sm font-semibold text-[var(--color-text)] truncate">{name}</div>
      <div class="text-[11px] text-[var(--color-muted)] truncate" title={message}>{message}</div>
      {needsClick ? (
        <button type="button" onClick={activatePendingPiP} class="mt-2.5 w-full h-8 rounded-lg text-xs font-semibold text-white bg-[linear-gradient(135deg,#8b5cf6,#f43f5e)]">
          Start picture in picture
        </button>
      ) : backHref && !failed ? (
        <a href={backHref} onClick={onNavigate} class="see-all mt-2 text-xs">
          <Play size={12} class="fill-current" /> Back to player
        </a>
      ) : null}
    </div>
  );
}
