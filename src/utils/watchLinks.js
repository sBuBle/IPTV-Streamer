// Short, readable player URLs.
//
// A stream URL becomes /watch/<channel-name-slug>-<key>, where <key> is an
// 8-character hash of the stream URL (e.g. /watch/bbc-one-1a2b3c4d). The
// player turns the key back into the stream URL by looking it up in the links
// opened before, the user's playlists, favorites, history and the iptv-org
// streams list. iptv-org channel IDs (/watch/CNN.us) and old links that carry
// the full stream URL keep working.

const STORAGE_KEY = 'watch-links';
const MAX_LINKS = 500;
const KEY_PATTERN = /^(?:(.*)-)?([0-9a-f]{8})$/;

let links = null; // key -> stream URL
let saveTimer = null;

function load() {
  if (links) return links;
  links = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (Array.isArray(entry) && entry.length === 2) links.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Storage unavailable or corrupt: start empty
  }
  return links;
}

function scheduleSave() {
  if (saveTimer || typeof window === 'undefined') return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const entries = [...load()].slice(-MAX_LINKS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore quota errors: links still resolve from playlists and history
    }
  }, 500);
}

export function isHttpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// FNV-1a, 32 bit, as 8 hex characters
export function streamKey(url) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Drop playlist noise such as "(1080p)" or "[Geo-blocked]"
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

function remember(key, url) {
  const map = load();
  if (map.get(key) === url) return;
  map.delete(key);
  map.set(key, url);
  scheduleSave();
}

/**
 * Player path for a channel or a stream.
 * @param {Object} channel - { url?, id?, name? }; `id` may be an iptv-org
 *   channel ID or (for history/favorites) the stream URL itself
 * @param {Object} [options] - { preferId: link by iptv-org ID when there is one }
 */
export function watchPath(channel, options = {}) {
  if (!channel) return '/';
  const { url, id, name } = channel;
  if (options.preferId && id && !isHttpUrl(id)) {
    return `/watch/${encodeURIComponent(id)}`;
  }
  const stream = isHttpUrl(url) ? url : isHttpUrl(id) ? id : null;
  if (stream) {
    const key = streamKey(stream);
    remember(key, stream);
    const slug = slugify(name);
    return `/watch/${slug ? `${slug}-` : ''}${key}`;
  }
  if (id) return `/watch/${encodeURIComponent(id)}`;
  return '/';
}

export function watchPathForStream(url, name) {
  return watchPath({ url, name });
}

/** The key part of a short watch path segment, or null */
export function parseWatchKey(segment) {
  if (!segment || isHttpUrl(segment)) return null;
  const match = String(segment).match(KEY_PATTERN);
  return match ? match[2] : null;
}

/**
 * Find the stream URL for a key, searching the given candidate URLs.
 * @param {string} key
 * @param {Array<() => Promise<Iterable<string>>>} sources - tried in order
 */
export async function resolveWatchKey(key, sources = []) {
  const known = load().get(key);
  if (known) return known;
  for (const source of sources) {
    let urls;
    try {
      urls = await source();
    } catch {
      continue;
    }
    if (!urls) continue;
    for (const url of urls) {
      if (url && streamKey(url) === key) {
        remember(key, url);
        return url;
      }
    }
  }
  return null;
}
