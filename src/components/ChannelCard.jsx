import { h } from 'preact';
import { Play, Heart } from 'lucide-preact';
import ChannelLogo from './ChannelLogo';

/**
 * Channel card from the FigCraft design (design/figcraft, ChannelCard):
 * 56px logo tile, name, LIVE badge with "Category · CC", heart; on hover the
 * card lifts, gets a violet edge and a play overlay on the logo.
 */
export default function ChannelCard({ href, name, logo, group, country, live = true, favorite = false, meta }) {
  const subtitle = [group || 'Uncategorized', country].filter(Boolean).join(' · ');
  return (
    <a
      href={href}
      class="channel-card group flex items-center gap-3 p-3 min-h-20 rounded-[14px] border border-[var(--color-hairline)] bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] hover:border-violet-500/40 hover:shadow-[var(--shadow-card-hover)] transition"
    >
      <div class="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden">
        <ChannelLogo
          src={logo}
          name={name}
          alt=""
          imgClass="w-14 h-14 object-contain bg-white/5 p-1.5"
          fallbackClass="w-14 h-14 flex items-center justify-center"
          textClass="text-lg tracking-tight"
        />
        <span class="absolute inset-0 flex items-center justify-center bg-[rgb(18_17_29/0.7)] opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
          <Play size={22} class="text-white fill-white" />
        </span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-[var(--color-text)] truncate">{name || 'Unnamed Channel'}</div>
        <div class="flex items-center gap-2 mt-1.5 min-w-0">
          {live && <span class="live-badge shrink-0">LIVE</span>}
          <span class="text-xs text-[var(--color-muted)] truncate">{subtitle}</span>
        </div>
        {meta && <div class="text-[11px] text-[var(--color-subtle)] mt-1 truncate">{meta}</div>}
      </div>
      <Heart
        size={20}
        class={`shrink-0 transition-opacity ${favorite ? 'text-rose-400 fill-rose-400 opacity-100' : 'text-white opacity-45 group-hover:opacity-100'}`}
        aria-label={favorite ? 'In favorites' : undefined}
        aria-hidden={favorite ? undefined : 'true'}
      />
    </a>
  );
}
