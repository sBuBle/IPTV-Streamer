import { get, set, setLarge } from '../utils/idbStorage';
import crypto from 'crypto';

/**
 * Save channels for a specific playlist to IndexedDB
 * @param {string} playlistId - The playlist ID
 * @param {Array} channels - Array of channel objects to save
 */
export async function savePlaylistChannels(playlistId, channels) {
  if (!playlistId || !Array.isArray(channels)) {
    console.error('Invalid arguments for savePlaylistChannels');
    return false;
  }

  try {
    const enhancedChannels = channels.map(channel => ({
      ...channel,
      id: channel.id || generateChannelId(channel),
    }));

    const allChannels = (await get('channels')) || {};
    allChannels[playlistId] = enhancedChannels;

    await setLarge('channels', allChannels);
    return true;
  } catch (error) {
    console.error('Error saving playlist channels:', error);
    return false;
  }
}

/**
 * Generate a consistent, unique ID for a channel
 * @param {Object} channel - Channel object with url and name
 * @returns {string} A unique ID for the channel
 */
export function generateChannelId(channel) {
  const hash = crypto.createHash('md5');
  hash.update(`${channel.url || ''}${channel.name || ''}`);
  return hash.digest('hex').substring(0, 16);
}

/**
 * Parse M3U8 content and extract channel information
 * @param {string} content - M3U8 file content as text
 * @param {string} playlistId - ID of the playlist this content belongs to
 */
export function parseM3U8Content(content, playlistId) {
  const lines = content.split('\n');
  const channels = [];
  let currentChannel = null;

  for (const line of lines.map(l => l.trim())) {
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentChannel = { playlistId };
      const durationMatch = line.match(/#EXTINF:(-?\d+(\.\d+)?)/);
      currentChannel.duration = durationMatch ? parseFloat(durationMatch[1]) : null;

      const commaIndex = line.indexOf(',');
      currentChannel.name = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Unnamed Channel';

      const attributes = Object.fromEntries(
        [...line.matchAll(/([a-zA-Z0-9-_]+)="([^"]*)"/g)].map(match => [match[1], match[2]])
      );

      currentChannel = {
        ...currentChannel,
        tvgId: attributes['tvg-id'],
        logo: attributes['tvg-logo'],
        group: attributes['group-title'] || 'Uncategorized',
      };
    } else if (currentChannel && !line.startsWith('#')) {
      currentChannel.url = line;
      currentChannel.id = generateChannelId(currentChannel);
      channels.push(currentChannel);
      currentChannel = null;
    }
  }

  return channels;
}
