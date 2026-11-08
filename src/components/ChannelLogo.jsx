import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { getChannelGradient, getChannelInitials } from '../utils/logoService';

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
        class={imgClass}
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
