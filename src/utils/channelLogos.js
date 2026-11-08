import { useEffect, useState } from 'preact/hooks';
import * as apiClient from './apiClient';

// Saved channels (history, favorites) often have no logo: they were watched
// from a stream URL, so only the URL and name were stored. Look the logo up in
// iptv-org: stream URL -> channel ID (streams.json) -> logo (logos.json).

let streamIndexPromise = null;

function getStreamIndex() {
  if (!streamIndexPromise) {
    streamIndexPromise = apiClient.getStreams()
      .then(streams => {
        const index = new Map();
        if (Array.isArray(streams)) {
          for (const stream of streams) {
            if (stream?.url && stream.channel && !index.has(stream.url)) index.set(stream.url, stream.channel);
          }
        }
        return index;
      })
      .catch(() => {
        streamIndexPromise = null;
        return new Map();
      });
  }
  return streamIndexPromise;
}

const streamUrlOf = (channel) => [channel?.url, channel?.id].find(v => typeof v === 'string' && /^https?:\/\//i.test(v));

/**
 * The iptv-org channel ID for a saved channel, from its own data or its stream URL
 * @returns {Promise<string|null>}
 */
export async function findChannelId(channel) {
  if (!channel) return null;
  if (channel.channelId) return channel.channelId;
  if (channel.tvgId) return channel.tvgId;
  if (channel.id && !/^https?:\/\//i.test(channel.id) && /\.[a-z]{2}(@|$)/i.test(channel.id)) return channel.id;
  const url = streamUrlOf(channel);
  if (!url) return null;
  return (await getStreamIndex()).get(url) || null;
}

/**
 * Best logo URL for a saved channel, or null
 * @returns {Promise<string|null>}
 */
export async function findChannelLogo(channel) {
  if (!channel) return null;
  if (channel.logo) return channel.logo;
  if (channel.tvgLogo) return channel.tvgLogo;
  const channelId = await findChannelId(channel);
  if (!channelId) return null;
  await apiClient.loadLogos();
  return apiClient.getLogoUrl(channelId.split('@')[0]);
}

/**
 * Logos for a list of saved channels. Returns logoFor(channel), which gives
 * the stored logo right away and the looked-up one once it's known.
 * @param {Array} channels
 * @param {(item:any)=>any} [pick] maps a list item to its channel
 */
export function useChannelLogos(channels, pick = (item) => item) {
  const [found, setFound] = useState(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const missing = (channels || []).map(pick).filter(ch => ch?.id && !ch.logo && !ch.tvgLogo);
    if (missing.length === 0) return undefined;
    Promise.all(missing.map(async ch => [ch.id, await findChannelLogo(ch).catch(() => null)]))
      .then(pairs => {
        if (cancelled) return;
        const next = new Map(pairs.filter(([, logo]) => logo));
        if (next.size) setFound(prev => new Map([...prev, ...next]));
      });
    return () => { cancelled = true; };
  }, [channels]);

  return (channel) => channel?.logo || channel?.tvgLogo || (channel?.id && found.get(channel.id)) || null;
}
