import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
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

// Logo URLs this session has already loaded or seen fail. Lists remount their
// rows while scrolling, so without this a broken logo would be requested again
// every time its row came back, and a loaded one would flash its placeholder.
const loaded = new Set();
const failed = new Set();
const pending = new Map(); // url -> Promise<boolean>

function preload(url) {
  if (loaded.has(url)) return Promise.resolve(true);
  if (failed.has(url)) return Promise.resolve(false);
  let promise = pending.get(url);
  if (!promise) {
    promise = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { loaded.add(url); resolve(true); };
      img.onerror = () => { failed.add(url); resolve(false); };
      img.src = url;
    }).finally(() => pending.delete(url));
    pending.set(url, promise);
  }
  return promise;
}

// One observer for every logo on the page. Logos start loading a little
// before they scroll into view, not the 1-2 screens ahead that the browser's
// own loading="lazy" uses, so fast scrolling through a long list doesn't
// fire hundreds of requests for logos that are never seen.
const callbacks = new WeakMap();
let observer = null;

function observe(element, onVisible) {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => {};
  }
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        observer.unobserve(entry.target);
        callbacks.delete(entry.target);
        callback?.();
      }
    }, { rootMargin: '300px 0px' });
  }
  callbacks.set(element, onVisible);
  observer.observe(element);
  return () => {
    callbacks.delete(element);
    observer.unobserve(element);
  };
}

/**
 * Channel logo with a coloured-initials placeholder.
 * The initials show until the logo has scrolled near the screen and finished
 * downloading, then the logo fades in; they stay when there is no logo or it
 * fails to load. Never touches the DOM by hand or injects the name as HTML.
 */
export default function ChannelLogo({ src, name, alt, imgClass = '', fallbackClass = '', textClass = 'text-sm', ...rest }) {
  // 'ready': already loaded this session, show at once (no fade)
  const [state, setState] = useState(() => (src && loaded.has(src) ? 'ready' : 'waiting'));
  const placeholderRef = useRef(null);

  // A new logo URL: start over from the placeholder (or show it at once)
  useEffect(() => {
    if (!src || failed.has(src)) setState('failed');
    else if (loaded.has(src)) setState(current => (current === 'shown' ? current : 'ready'));
    else setState('waiting');
  }, [src]);

  // While waiting, load the logo once its placeholder nears the viewport
  const waiting = state === 'waiting';
  useEffect(() => {
    const element = placeholderRef.current;
    if (!waiting || !src || !element) return undefined;
    let cancelled = false;
    const stop = observe(element, () => {
      preload(src).then(ok => { if (!cancelled) setState(ok ? 'shown' : 'failed'); });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [src, waiting]);

  if (src && (state === 'ready' || state === 'shown')) {
    return (
      <img
        src={src}
        alt={alt || name || 'Channel logo'}
        class={`${fitLogoClass(imgClass)}${state === 'shown' ? ' logo-fade-in' : ''}`}
        decoding="async"
        onError={() => { failed.add(src); setState('failed'); }}
        {...rest}
      />
    );
  }

  return (
    <div ref={placeholderRef} class={fallbackClass} style={{ backgroundImage: getChannelGradient(name || '') }} aria-hidden="true">
      <div class={`text-white font-bold ${textClass}`}>{getChannelInitials(name || '')}</div>
    </div>
  );
}
