import { get, set } from './idbStorage';
import { parseM3U8, extractChannels as extractChannelsBasic, fetchPlaylist as fetchAndParsePlaylist } from './simpleParser';
import { getChannelColor, getChannelInitials, formatLogoUrl } from './logoService';

/**
 * Fetch a playlist from URL
 * @param {string} url - URL of the playlist
 * @returns {Promise<Object>} Parsed playlist data
 */
export async function fetchPlaylist(url) {
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL');
    }

    const manifest = await fetchAndParsePlaylist(url);

    return {
      segments: manifest?.segments?.map(segment => ({
        uri: segment.uri,
        title: segment.title,
        attributes: segment.attributes || {},
        duration: segment.duration,
      })) || [],
      headers: manifest?.header || {},
    };
  } catch (error) {
    console.error(`Error fetching playlist from ${url}:`, error);
    return { segments: [], headers: {} };
  }
}

/**
 * Save a playlist to storage
 * @param {string} url - URL of the playlist
 * @param {string} name - Name of the playlist
 * @param {boolean} useProxy - Whether to use a CORS proxy
 * @returns {Promise<Object>} Saved playlist object
 */
export async function savePlaylist(url, name, useProxy = false) {
  try {
    console.log(`Saving playlist: ${name} (${url}) with proxy: ${useProxy}`);
    
    const urlHash = btoa(url).replace(/[=+/]/g, '').substring(0, 16);
    const stableId = `playlist_${urlHash}`;

    const playlists = (await get('playlists')) || [];
    if (playlists.some(p => p.url === url)) {
      throw new Error('Playlist already exists');
    }

    const newPlaylist = { 
      id: stableId, 
      url, 
      name, 
      addedAt: new Date().toISOString(),
      useProxy 
    };
    
    // Save the playlist info first
    await set('playlists', [...playlists, newPlaylist]);
    console.log(`Playlist metadata saved with ID: ${stableId}`);

    // Now fetch the content (with proxy if needed)
    let manifest;
    try {
      const fetchUrl = useProxy ? `https://corsproxy.io/?${encodeURIComponent(url)}` : url;
      console.log(`Fetching playlist content from: ${fetchUrl}`);
      manifest = await fetchAndParsePlaylist(fetchUrl);
      
      if (!manifest || !manifest.segments || manifest.segments.length === 0) {
        console.error('Failed to get segments from playlist, will try alternative method');
        throw new Error('No channels found in playlist');
      }
    } catch (fetchError) {
      console.error('Error fetching playlist:', fetchError);
      // Try with CORS proxy as fallback if not already using it
      if (!useProxy) {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        console.log(`Retrying with CORS proxy: ${proxyUrl}`);
        manifest = await fetchAndParsePlaylist(proxyUrl);
        
        // Update the playlist to indicate it needs proxy
        const updatedPlaylists = playlists.map(p => 
          p.id === stableId ? { ...p, useProxy: true } : p
        );
        await set('playlists', [...updatedPlaylists, newPlaylist]);
      }
      
      if (!manifest || !manifest.segments || manifest.segments.length === 0) {
        throw new Error('Failed to fetch playlist content, even with proxy');
      }
    }
    
    console.log(`Extracted ${manifest.segments?.length || 0} segments from playlist`);

    // Process and save channels
    const channels = processChannelsFromManifest(manifest, stableId);
    
    if (channels.length === 0) {
      console.error('No channels extracted from playlist');
    } else {
      console.log(`Processed ${channels.length} channels from playlist`);
    }
    
    const allChannels = (await get('channels')) || {};
    allChannels[stableId] = channels;
    await set('channels', allChannels);
    
    // Save raw playlist data for reference
    const rawPlaylists = (await get('rawPlaylists')) || {};
    rawPlaylists[stableId] = manifest;
    await set('rawPlaylists', rawPlaylists);
    
    console.log(`Saved ${channels.length} channels for playlist ${stableId}`);

    return newPlaylist;
  } catch (error) {
    console.error('Failed to save playlist:', error);
    throw error;
  }
}

/**
 * Get all saved playlists
 * @returns {Promise<Array>} List of saved playlists
 */
export async function getPlaylists() {
  const playlists = await get('playlists') || [];
  return playlists;
}

/**
 * Remove a playlist
 * @param {string} id - ID of the playlist to remove
 * @returns {Promise<boolean>} Success status
 */
export async function removePlaylist(id) {
  try {
    const playlists = await getPlaylists();
    await set('playlists', playlists.filter(p => p.id !== id));
    
    // Clean up associated data
    const allChannels = await get('channels') || {};
    delete allChannels[id];
    await set('channels', allChannels);
    
    return true;
  } catch (error) {
    console.error('Error removing playlist:', error);
    return false;
  }
}

/**
 * Get channel metadata 
 * @param {string} channelId - Channel ID or URL
 * @returns {Object} Basic channel metadata
 */
export function getChannelMetadata(channelId) {
  try {
    // Extract channel name from URL or ID
    const parts = channelId.split('/');
    const potentialChannelName = parts[parts.length - 1]
      .replace(/\.m3u8$/, '')        // Remove extension
      .replace(/\.[^.]+$/, '')       // Remove any extension
      .replace(/[_-]/g, ' ');        // Replace underscores and dashes with spaces
    
    return {
      id: channelId,
      name: potentialChannelName,
      logo: null,
      categories: [],
      languages: []
    };
  } catch (err) {
    return {
      id: channelId,
      name: 'Unknown Channel'
    };
  }
}

/**
 * Format logo URL helper 
 * @param {string} url - Raw logo URL
 * @returns {string} Formatted URL
 */
export { formatLogoUrl } from './simpleParser';

/**
 * Get a suitable logo URL from a stream/channel object
 * @param {Object} stream - Stream or channel object
 * @returns {string|null} Best available logo URL
 */
export function getLogoFromStream(stream) {
  if (!stream) return null;
  
  // Try direct logo from the stream object
  if (stream.logo) return stream.logo;
  
  // Try to get logo from tvgLogo if available
  if (stream.tvgLogo) return formatLogoUrl(stream.tvgLogo);
  
  // Try API client's logo resolution with various identifiers
  if (stream.channelId || stream.tvgId || stream.name) {
    // Using dynamic import to avoid circular dependencies
    const apiClient = require('./apiClient');
    
    // Try with channelId first (most specific)
    if (stream.channelId) {
      return apiClient.getLogoUrl(stream.channelId);
    }
    
    // Try with tvgId next
    if (stream.tvgId) {
      return apiClient.getLogoUrl(stream.tvgId);
    }
    
    // Finally try with name
    if (stream.name) {
      return apiClient.getLogoUrl(stream.name);
    }
  }
  
  return null;
}

/**
 * Refresh a playlist by fetching the latest version and updating the channels
 * @param {string} playlistId - ID of the playlist to refresh
 * @returns {Promise<Object>} Updated playlist details
 */
export async function refreshPlaylist(playlistId) {
  try {
    console.log(`Starting refresh for playlist: ${playlistId}`);
    // Get the playlist info
    const playlists = await get('playlists') || [];
    const playlist = playlists.find(p => p.id === playlistId);
    
    if (!playlist) {
      console.error(`Playlist not found with ID: ${playlistId}`);
      throw new Error('Playlist not found');
    }
    
    console.log(`Fetching playlist from URL: ${playlist.url}`);
    // Fetch the updated playlist content with better error handling
    let manifest;
    try {
      manifest = await fetchAndParsePlaylist(playlist.url);
      if (!manifest || !manifest.segments) {
        throw new Error('Received empty or invalid playlist content');
      }
    } catch (fetchError) {
      console.error(`Error fetching playlist content: ${fetchError.message}`);
      // Try with a CORS proxy if direct fetch fails
      console.log('Attempting fetch with CORS proxy...');
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(playlist.url)}`;
      manifest = await fetchAndParsePlaylist(proxyUrl);
      
      if (!manifest || !manifest.segments) {
        throw new Error(`Failed to fetch playlist content, even with proxy: ${fetchError.message}`);
      }
    }
    
    console.log(`Extracted ${manifest.segments?.length || 0} segments from playlist`);
    
    // Extract channels from the updated manifest
    const updatedChannels = processChannelsFromManifest(manifest, playlistId);
    console.log(`Processed ${updatedChannels.length} channels from playlist`);
    
    // Save the updated channels
    const allChannels = await get('channels') || {};
    allChannels[playlistId] = updatedChannels;
    await set('channels', allChannels);
    
    // Make an explicit commit to ensure IndexedDB has saved our changes
    // This might help in cases where the channel data is large
    try {
      // Verify the data was written
      const verifyChannels = await get('channels');
      const verifyCount = (verifyChannels[playlistId] || []).length;
      console.log(`Verified channels saved to IndexedDB: ${verifyCount}`);
      
      if (verifyCount !== updatedChannels.length) {
        console.warn(`Channel count mismatch! Expected ${updatedChannels.length}, got ${verifyCount}`);
      }
    } catch (verifyErr) {
      console.error('Failed to verify channel storage:', verifyErr);
    }
    
    // Save raw playlist data for future reference
    const rawPlaylists = await get('rawPlaylists') || {};
    rawPlaylists[playlistId] = manifest;
    await set('rawPlaylists', rawPlaylists);
    
    // Update playlist metadata
    const updatedPlaylists = playlists.map(p => {
      if (p.id === playlistId) {
        return {
          ...p,
          lastRefreshed: new Date().toISOString(),
          channelCount: updatedChannels.length
        };
      }
      return p;
    });
    
    // Save updated playlists
    await set('playlists', updatedPlaylists);
    
    console.log(`Refresh complete for ${playlistId}, saved ${updatedChannels.length} channels`);
    
    // Return the updated playlist with stats AND the actual channels
    return {
      id: playlistId,
      name: playlist.name,
      url: playlist.url,
      lastRefreshed: new Date().toISOString(),
      channelCount: updatedChannels.length,
      channels: updatedChannels // Return the channels directly in the result
    };
  } catch (error) {
    console.error('Error refreshing playlist:', error);
    throw error;
  }
}

/**
 * Find a playlist by partial ID with enhanced matching
 * @param {string} partialId - The ID or partial ID to search for
 * @returns {Promise<Object|null>} - The found playlist or null
 */
export const findPlaylistByPartialId = async (partialId) => {
  try {
    const playlists = await get('playlists') || [];
    
    if (!partialId || playlists.length === 0) {
      return null;
    }
    
    // Method 1: Direct match
    const exactMatch = playlists.find(playlist => playlist.id === partialId);
    if (exactMatch) {
      return exactMatch;
    }
    
    // Method 2: Prefix match (when ID starts with the partial ID)
    const prefixMatch = playlists.find(playlist => 
      playlist.id.startsWith(partialId) || partialId.startsWith(playlist.id)
    );
    if (prefixMatch) {
      return prefixMatch;
    }
    
    // Method 3: Contains match
    const containsMatch = playlists.find(playlist => 
      playlist.id.includes(partialId) || partialId.includes(playlist.id)
    );
    if (containsMatch) {
      return containsMatch;
    }
    
    // Method 4: Base64 handling for URLs
    if (partialId.includes('aHR0')) {
      // This looks like a base64-encoded URL
      try {
        const encodedPart = partialId.split('playlist_')[1] || partialId;
        const decodedUrl = atob(encodedPart);
        
        // Try to match by URL
        const urlMatch = playlists.find(playlist => 
          playlist.url === decodedUrl || 
          generateStablePlaylistId(playlist.url) === partialId
        );
        
        if (urlMatch) {
          return urlMatch;
        }
      } catch (e) {
        console.error('Base64 decoding failed:', e);
      }
    }
    
    // No match found
    return null;
  } catch (err) {
    console.error('Error in findPlaylistByPartialId:', err);
    return null;
  }
};

/**
 * Generate a stable ID for a playlist based on its URL
 * @param {string} url - Playlist URL
 * @returns {string} Stable ID
 */
export function generateStablePlaylistId(url) {
  try {
    return `playlist_${btoa(url).replace(/[=+/]/g, '').substring(0, 16)}`;
  } catch (error) {
    // Fallback if URL encoding fails
    return `playlist_${Math.random().toString(36).substring(2, 10)}`;
  }
}

/**
 * Get a comprehensive channel logo from multiple sources
 * @param {Object} channel - Channel object
 * @returns {Promise<string|null>} Best available logo URL
 */
export async function getComprehensiveChannelLogo(channel) {
  // Try to get logo from existing sources
  let logo = '';
  
  // If channel already has a logo, format it
  if (channel.logo && !channel.logo.startsWith('error:')) {
    logo = formatLogoUrl(channel.logo);
    if (logo) return logo;
  }
  
  // Try to get logo from tvg-logo attribute
  if (channel.attributes && channel.attributes['tvg-logo']) {
    logo = formatLogoUrl(channel.attributes['tvg-logo']);
    if (logo) return logo;
  }
  
  // Try to get logo from api
  try {
    logo = await getLogoFromStream(channel.name);
    if (logo) return formatLogoUrl(logo);
  } catch (err) {
    console.warn(`Failed to get logo for ${channel.name}:`, err);
  }
  
  // Return empty string if no logo found
  return '';
}

/**
 * Get all channels from all playlists
 * @param {Object} options - Optional filtering options
 * @returns {Promise<Array>} All channels flattened into a single array
 */
export async function getAllChannels(options = {}) {
  try {
    // Get all channels from storage
    const allChannelsObj = await get('channels') || {};
    
    // Flatten channels into a single array
    let channels = Object.values(allChannelsObj).flat();
    
    // Apply filters if provided
    if (options.category) {
      channels = channels.filter(channel => 
        channel.categories && 
        channel.categories.some(cat => 
          cat.toLowerCase() === options.category.toLowerCase()
        )
      );
    }
    
    if (options.group) {
      channels = channels.filter(channel => 
        channel.group && channel.group.toLowerCase() === options.group.toLowerCase()
      );
    }
    
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      channels = channels.filter(channel => 
        channel.name && channel.name.toLowerCase().includes(searchLower)
      );
    }
    
    // Deduplicate channels if requested
    if (options.deduplicate) {
      const uniqueMap = new Map();
      channels.forEach(channel => {
        // Use channel name as key for deduplication
        if (!uniqueMap.has(channel.name)) {
          uniqueMap.set(channel.name, channel);
        }
      });
      channels = Array.from(uniqueMap.values());
    }
    
    // Sort channels if requested
    if (options.sortBy) {
      channels.sort((a, b) => {
        switch (options.sortBy) {
          case 'name':
            return (a.name || '').localeCompare(b.name || '');
          case 'group':
            return (a.group || '').localeCompare(b.group || '');
          default:
            return 0;
        }
      });
    }
    
    return channels;
  } catch (error) {
    console.error('Error getting all channels:', error);
    return [];
  }
}

/**
 * Get all unique categories from all channels
 * @returns {Promise<Array>} List of category objects
 */
export async function getCategories() {
  try {
    // First try to get from API client
    let categories = [];
    try {
      // Use dynamic import to avoid circular dependencies
      const apiClient = await import('./apiClient');
      categories = await apiClient.getCategories();
      
      // If we got categories from the API, return them
      if (categories && Array.isArray(categories) && categories.length > 0) {
        return categories;
      }
    } catch (apiError) {
      console.warn('Failed to get categories from API, falling back to local data', apiError);
    }
    
    // If API call failed or returned empty, extract from local channels
    const channels = await getAllChannels();
    
    // Create a map to store unique categories with count
    const categoryMap = new Map();
    
    // Process each channel
    channels.forEach(channel => {
      // Check for categories array
      if (channel.categories && Array.isArray(channel.categories)) {
        channel.categories.forEach(category => {
          if (category && typeof category === 'string') {
            const normalizedCategory = category.trim().toLowerCase();
            if (normalizedCategory) {
              const count = categoryMap.get(normalizedCategory)?.count || 0;
              categoryMap.set(normalizedCategory, {
                id: normalizedCategory.replace(/\s+/g, '-'),
                name: category.trim(),
                count: count + 1
              });
            }
          }
        });
      }
      
      // Also check for group attribute which is often used as category
      if (channel.group && typeof channel.group === 'string') {
        const normalizedGroup = channel.group.trim().toLowerCase();
        if (normalizedGroup && normalizedGroup !== 'uncategorized') {
          const count = categoryMap.get(normalizedGroup)?.count || 0;
          categoryMap.set(normalizedGroup, {
            id: normalizedGroup.replace(/\s+/g, '-'),
            name: channel.group.trim(),
            count: count + 1
          });
        }
      }
    });
    
    // Convert map to array and sort by count (most common first)
    return Array.from(categoryMap.values())
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Error getting categories:', error);
    return [];
  }
}

/**
 * Mark a stream URL as invalid in the database
 * @param {string} streamUrl - The URL of the invalid stream
 * @param {string} reason - Optional reason why the stream is invalid
 * @returns {Promise<boolean>} Success status
 */
export async function markStreamAsInvalid(streamUrl, reason = 'Unknown error') {
  try {
    if (!streamUrl) return false;
    
    // Get the current invalid streams list or create a new one
    const invalidStreams = await get('invalid_streams') || {};
    
    // Add or update the stream in the invalid list with timestamp and reason
    invalidStreams[streamUrl] = {
      timestamp: Date.now(),
      reason: reason,
      attempts: (invalidStreams[streamUrl]?.attempts || 0) + 1
    };
    
    // Save the updated list
    await set('invalid_streams', invalidStreams);
    
    console.log(`Marked stream as invalid: ${streamUrl} - ${reason}`);
    return true;
  } catch (error) {
    console.error('Error marking stream as invalid:', error);
    return false;
  }
}

/**
 * Helper function to generate unique channel IDs
 * @param {string} url - Channel URL
 * @param {number} index - Channel index in playlist
 * @param {string} playlistId - Parent playlist ID
 * @returns {string} Unique channel ID
 */
function generateUniqueChannelId(url, index, playlistId) {
  // Extract the last part of the URL path
  const pathPart = url.split('/').pop() || `channel_${index}`;
  
  // Create a simple hash from the full URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  hash = Math.abs(hash % 10000);
  
  // Combine all parts to create a unique ID
  return `${playlistId}_${pathPart.replace(/[^a-zA-Z0-9]/g, '_')}_${index}_${hash}`;
}

// Update the extractChannels function to be more resilient
function processChannelsFromManifest(manifest, playlistId) {
  console.log('Extracting channels for playlist:', playlistId);
  
  if (!manifest) {
    console.error('No manifest provided');
    return [];
  }
  
  if (!manifest.segments || !Array.isArray(manifest.segments)) {
    console.error('No segments found in manifest:', manifest);
    return [];
  }
  
  console.log(`Processing ${manifest.segments.length} segments`);
  
  // Filter out segments without URI and log issues
  const validSegments = manifest.segments.filter(segment => {
    if (!segment.uri) {
      console.warn('Found segment without URI:', segment);
      return false;
    }
    return true;
  });
  
  console.log(`Found ${validSegments.length} valid segments with URIs`);
  
  return validSegments
    .map((segment, index) => {
      try {
        const channelId = generateUniqueChannelId(segment.uri, index, playlistId);
        
        // Create the channel object
        return {
          id: channelId,
          name: segment.title || 'Unnamed Channel',
          url: segment.uri,
          group: segment.attributes?.['group-title'] || 'Uncategorized',
          playlistId: playlistId,
          attributes: segment.attributes || {},
          // Add other properties from the segment as needed
          tvgId: segment.attributes?.['tvg-id'],
          tvgName: segment.attributes?.['tvg-name'],
          tvgLogo: segment.attributes?.['tvg-logo'],
          categories: segment.attributes?.['tvg-category'] 
            ? segment.attributes['tvg-category'].split(',').map(cat => cat.trim())
            : []
        };
      } catch (err) {
        console.error(`Error processing segment ${index}:`, err, segment);
        return null;
      }
    })
    .filter(Boolean); // Filter out any null entries from errors
}

// Export the processChannelsFromManifest function for use in local file handling
export { processChannelsFromManifest };