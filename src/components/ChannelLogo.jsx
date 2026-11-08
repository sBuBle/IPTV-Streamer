import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { getChannelGradient, getChannelInitials } from '../utils/logoService';

// Logos come in every shape (wide wordmarks, tall crests, padded squares).
// Always show the whole logo inside its box: never crop (object-cover) or
// stretch, add a little padding and a soft tile so dark logos stay visible.
function fitLogoClass(imgClass = '') {
  let cls = imgClass.replace(/(^|\s)(object-(cover|fill|none|scale-down)|bg-gray-\d+)(?=\s|$)/g, ' ');
  if (!/(^|\s)object-contain(\s|$)/.test(cls)) cls += ' object-contain';
  if (!/(^|\s)p-[\d.]+(\s|$)/.test(cls)) cls += ' p-1';
  if (!/(^|\s)bg-/.test(cls)) cls += ' bg-white/5';
  if (!/(^|\s)rounded/.test(cls)) cls += ' rounded-lg';
  return cls.replace(/\s+/g, ' ').trim();
}

/**
 * Channel logo with a coloured-initials fallback.
 * Falls back when there is no src or the image fails to load, without touching
 * the DOM by hand (and without injecting the channel name as HTML).
 */
export default function ChannelLogo({ src, name, alt, imgClass = '', fallbackClass = '', textClass = 'text-sm', ...rest }) {
  const [failed, setFailed] = useState(false);

  // A new logo URL gets a fresh chance to load
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={alt || name || 'Channel logo'}
        class={fitLogoClass(imgClass)}
        loading="lazy"
        onError={() => setFailed(true)}
        {...rest}
      />
    );
  }

  return (
    <div class={fallbackClass} style={{ backgroundImage: getChannelGradient(name || '') }} aria-hidden="true">
      <div class={`text-white font-bold ${textClass}`}>{getChannelInitials(name || '')}</div>
    </div>
  );
}
