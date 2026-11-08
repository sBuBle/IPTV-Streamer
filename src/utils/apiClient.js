import { get, set } from './idbStorage';
import { formatLogoUrl } from './logoService';

// Updated API endpoints based on latest IPTV-org API documentation
const API_ENDPOINTS = {
  // Core data endpoints
  CHANNELS: 'https://iptv-org.github.io/api/channels.json',
  STREAMS: 'https://iptv-org.github.io/api/streams.json',
  // Channel feeds; since 2025 the broadcast languages live here, not on channels
  FEEDS: 'https://iptv-org.github.io/api/feeds.json',
  GUIDES: 'https://iptv-org.github.io/api/guides.json',
  
  // Classification endpoints
  CATEGORIES: 'https://iptv-org.github.io/api/categories.json',
  LANGUAGES: 'https://iptv-org.github.io/api/languages.json',
  COUNTRIES: 'https://iptv-org.github.io/api/countries.json',
  REGIONS: 'https://iptv-org.github.io/api/regions.json',
  SUBDIVISIONS: 'https://iptv-org.github.io/api/subdivisions.json',
  
  // Channel logos ({ channel, feed, url, ... } entries)
  LOGOS: 'https://iptv-org.github.io/api/logos.json',
  
  // Remove the non-existent endpoint
  // UPDATED: 'https://iptv-org.github.io/api/updated.json'
};

// Cache duration constants (in milliseconds)
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Parsed responses kept for the whole session, so pages don't re-read
// multi-megabyte arrays from IndexedDB on every visit.
const memory = new Map(); // cacheKey -> { data, timestamp }
// Requests in flight, so simultaneous callers share one download.
const inflight = new Map(); // cacheKey -> Promise

async function download(url, cacheKey, options) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  const data = await response.json();
  const timestamp = Date.now();
  memory.set(cacheKey, { data, timestamp });
  // Persist without blocking the caller
  set(cacheKey, data).then(() => set(`${cacheKey}_timestamp`, timestamp));
  return data;
}

function downloadOnce(url, cacheKey, options) {
  let promise = inflight.get(cacheKey);
  if (!promise) {
    promise = download(url, cacheKey, options).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, promise);
  }
  return promise;
}

/**
 * Fetch data from API with caching (memory -> IndexedDB -> network).
 * Expired data is returned immediately and refreshed in the background
 * (stale-while-revalidate), so returning visitors never wait on the network.
 * @param {string} url - API endpoint URL
 * @param {string} cacheKey - Cache key for data
 * @param {Object} options - Fetch options ({ forceRefresh, signal })
 * @returns {Promise<Object>} Fetched data
 */
async function fetchWithCache(url, cacheKey, options = {}) {
  if (options.forceRefresh) {
    try {
      return await downloadOnce(url, cacheKey, options);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      const cached = memory.get(cacheKey)?.data ?? (await get(cacheKey));
      if (cached) return cached;
      throw error;
    }
  }

  let entry = memory.get(cacheKey);
  if (!entry) {
    const [data, timestamp] = await Promise.all([get(cacheKey), get(`${cacheKey}_timestamp`)]);
    if (data) {
      entry = { data, timestamp: timestamp || 0 };
      memory.set(cacheKey, entry);
    }
  }

  if (entry) {
    if (Date.now() - entry.timestamp >= CACHE_DURATION && !inflight.has(cacheKey)) {
      downloadOnce(url, cacheKey, {}).catch(err => console.warn(`Background refresh of ${url} failed:`, err));
    }
    return entry.data;
  }

  return downloadOnce(url, cacheKey, options);
}

// Streams grouped by channel ID, rebuilt only when streams.json changes
let streamIndexSource = null;
let streamIndex = null;

function getStreamIndex(streams) {
  if (streams !== streamIndexSource) {
    streamIndex = new Map();
    if (Array.isArray(streams)) {
      for (const stream of streams) {
        if (!stream?.channel) continue;
        const list = streamIndex.get(stream.channel);
        if (list) list.push(stream);
        else streamIndex.set(stream.channel, [stream]);
      }
    }
    streamIndexSource = streams;
  }
  return streamIndex;
}

function withBestStream(channel, index) {
  const bestStream = index.get(channel.id)?.[0] || null;
  return {
    ...channel,
    url: bestStream ? bestStream.url : null,
    logo: channel.logo || getLogoUrl(channel.id),
    resolution: bestStream ? bestStream.resolution : null,
    status: bestStream ? bestStream.status : null,
    httpReferrer: bestStream ? bestStream.http_referrer : null,
    userAgent: bestStream ? bestStream.user_agent : null
  };
}

function matchesCountry(channel, code) {
  if (channel.country && channel.country.toLowerCase() === code) return true;
  if (Array.isArray(channel.broadcast_area)) {
    return channel.broadcast_area.some(area => {
      const a = area.toLowerCase();
      return a === `c.${code}` || a === code;
    });
  }
  return false;
}

/**
 * Raw channels.json entries (no stream/logo merge). Cheap way to count or
 * index channels without building tens of thousands of new objects.
 */
export async function getRawChannels(options = {}) {
  return fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options);
}

// Channel ID -> logo URL, filled from logos.json by loadLogos()
let logoMap = null;
let logoMapPromise = null;

/**
 * Load the iptv-org logo index (once per session)
 * @returns {Promise<Map<string,string>>}
 */
export async function loadLogos(options = {}) {
  if (logoMap) return logoMap;
  if (!logoMapPromise) {
    logoMapPromise = fetchWithCache(API_ENDPOINTS.LOGOS, 'api_logos', options)
      .then((logos) => {
        const map = new Map();
        if (Array.isArray(logos)) {
          for (const logo of logos) {
            if (!logo?.channel || !logo.url) continue;
            // Prefer the channel-wide logo over feed-specific ones
            if (!map.has(logo.channel) || !logo.feed) map.set(logo.channel, logo.url);
          }
        }
        logoMap = map;
        return map;
      })
      .catch((err) => {
        console.warn('Could not load channel logos:', err);
        logoMapPromise = null;
        return new Map();
      });
  }
  return logoMapPromise;
}

/**
 * Get logo URL for a channel
 * @param {string} channelId - iptv-org channel ID (e.g. "CNN.us")
 * @returns {string|null} Logo URL, or null when none is known
 */
export function getLogoUrl(channelId) {
  if (!channelId || !logoMap) return null;
  const url = logoMap.get(channelId);
  return url ? formatLogoUrl(url) : null;
}

/**
 * Get countries list
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of countries
 */
export async function getCountries(options = {}) {
  return fetchWithCache(API_ENDPOINTS.COUNTRIES, 'countries', options);
}

/**
 * Get regions list
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of regions
 */
export async function getRegions(options = {}) {
  return fetchWithCache(API_ENDPOINTS.REGIONS, 'regions', options);
}

/**
 * Get categories list
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of categories
 */
export async function getCategories(options = {}) {
  return fetchWithCache(API_ENDPOINTS.CATEGORIES, 'categories', options);
}

/**
 * Get languages list
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of languages
 */
export async function getLanguages(options = {}) {
  return fetchWithCache(API_ENDPOINTS.LANGUAGES, 'languages', options);
}

/**
 * Get channel feeds (each has `channel` and a `languages` array of ISO 639-3 codes)
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of feeds
 */
export async function getFeeds(options = {}) {
  return fetchWithCache(API_ENDPOINTS.FEEDS, 'api_feeds', options);
}

// Channel ID -> Set of language codes, built from feeds.json
let channelLanguageIndex = null;
let channelLanguageSource = null;

async function getChannelLanguageIndex(options = {}) {
  let feeds = null;
  try {
    feeds = await getFeeds(options);
  } catch (err) {
    console.warn('Could not load feeds (languages):', err);
  }
  if (feeds !== channelLanguageSource || !channelLanguageIndex) {
    channelLanguageIndex = new Map();
    if (Array.isArray(feeds)) {
      for (const feed of feeds) {
        if (!feed?.channel || !Array.isArray(feed.languages)) continue;
        let set = channelLanguageIndex.get(feed.channel);
        if (!set) channelLanguageIndex.set(feed.channel, (set = new Set()));
        for (const lang of feed.languages) set.add(String(lang).toLowerCase());
      }
    }
    channelLanguageSource = feeds;
  }
  return channelLanguageIndex;
}

// Language code -> name, from languages.json
let languageNameMap = null;
async function getLanguageNames(options = {}) {
  if (languageNameMap) return languageNameMap;
  try {
    const languages = await getLanguages(options);
    if (Array.isArray(languages) && languages.length) {
      languageNameMap = new Map(languages.map(lang => [String(lang.code).toLowerCase(), lang.name]));
      return languageNameMap;
    }
  } catch (err) {
    console.warn('Could not load language names:', err);
  }
  return new Map();
}

function channelLanguages(channel, languageIndex) {
  const fromFeeds = languageIndex?.get(channel.id);
  if (fromFeeds && fromFeeds.size) return [...fromFeeds];
  // Older API versions kept the languages on the channel itself
  return Array.isArray(channel.languages) ? channel.languages.map(l => String(l).toLowerCase()) : [];
}

/**
 * Languages that at least one channel with a stream is broadcast in.
 * Falls back to the full languages list if feeds can't be loaded.
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of languages ({ code, name, channelCount })
 */
export async function getLanguagesWithChannels(options = {}) {
  const [languages, channels, streams, languageIndex] = await Promise.all([
    getLanguages(options),
    fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options),
    fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options).catch(() => null),
    getChannelLanguageIndex(options),
  ]);
  if (!Array.isArray(languages)) return [];
  if (!languageIndex.size || !Array.isArray(channels)) return languages;

  const streamIndex = getStreamIndex(streams);
  const counts = new Map();
  for (const channel of channels) {
    if (streamIndex.size && !streamIndex.has(channel.id)) continue;
    for (const code of channelLanguages(channel, languageIndex)) {
      counts.set(code, (counts.get(code) || 0) + 1);
    }
  }
  return languages
    .filter(lang => counts.has(String(lang.code).toLowerCase()))
    .map(lang => ({ ...lang, channelCount: counts.get(String(lang.code).toLowerCase()) }));
}

/**
 * Get streams data
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of streams
 */
export async function getStreams(options = {}) {
  return fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options);
}

/**
 * Get available channels
 * @param {Object} filters - Filter options (category, country, language)
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} Filtered list of channels
 */
export async function getChannels(filters = {}, options = {}) {
  try {
    const [channels, streams] = await Promise.all([
      fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options),
      fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options),
      loadLogos(options)
    ]);

    if (!Array.isArray(channels) || !channels.length) {
      return [];
    }

    const category = filters.category?.toLowerCase();
    const country = filters.country?.toLowerCase();
    const language = filters.language?.toLowerCase();

    // Languages live in feeds.json; attach them to every channel so the
    // cards can show them (not only when filtering by language)
    const [languageIndex, languageNames] = await Promise.all([
      getChannelLanguageIndex(options),
      getLanguageNames(options),
    ]);

    const filtered = (category || country || language)
      ? channels.filter(channel =>
          (!category || (Array.isArray(channel.categories) && channel.categories.some(c => c.toLowerCase() === category))) &&
          (!country || matchesCountry(channel, country)) &&
          (!language || channelLanguages(channel, languageIndex).includes(language))
        )
      : channels;

    const index = getStreamIndex(streams);
    return filtered.map(channel => {
      const result = withBestStream(channel, index);
      const codes = channelLanguages(channel, languageIndex);
      result.languages = codes;
      result.languageNames = codes.map(code => languageNames.get(code) || code.toUpperCase());
      return result;
    });
  } catch (error) {
    console.error('Error getting channels:', error);
    return [];
  }
}

/**
 * Find channel by name or ID
 * @param {string} nameOrId - Channel name or ID to search for
 * @param {Object} options - Fetch options
 * @returns {Promise<Object|null>} Channel details if found
 */
export async function findChannel(nameOrId, options = {}) {
  if (!nameOrId) return null;

  try {
    // Normalize the search term
    const searchTerm = String(nameOrId).toLowerCase().trim();

    // Try to get from cache first
    const cachedChannels = await get('channels_metadata');
    if (cachedChannels && cachedChannels[searchTerm]) {
      return cachedChannels[searchTerm];
    }

    // If not in cache, fetch channels from API
    const channels = await fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options);
    if (!Array.isArray(channels)) return null;

    // Find matching channel
    const found = channels.find(ch =>
      ch.id?.toLowerCase() === searchTerm ||
      ch.name?.toLowerCase() === searchTerm ||
      ch.name?.toLowerCase().includes(searchTerm)
    );
    // Copy so the shared cached array is never modified
    const channel = found ? { ...found } : null;

    if (channel) {
      // Get stream URL for this channel
      try {
        const streams = await fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options);
        const channelStreams = getStreamIndex(streams).get(channel.id) || [];

        if (channelStreams.length > 0) {
          channel.url = channelStreams[0].url;
        }
      } catch (e) {
        console.warn('Could not load stream URL for channel:', e);
      }

      // Enhance with logo if needed
      if (!channel.logo) {
        channel.logo = getLogoUrl(channel.id || channel.name);
      }

      // Save to cache for next time
      const cachedChannels = await get('channels_metadata') || {};
      cachedChannels[searchTerm] = channel;
      await set('channels_metadata', cachedChannels);

      return channel;
    }

    return null;
  } catch (error) {
    console.error('Error finding channel:', error);
    return null;
  }
}

/**
 * Get channel details (with EPG guide info when options.includeGuide is set)
 * @param {string} channelId - Channel ID to get details for
 * @param {Object} options - Fetch options ({ includeGuide, forceRefresh, signal })
 * @returns {Promise<Object>} Channel details with EPG data
 */
export async function getChannelDetails(channelId, options = {}) {
  if (!channelId) return null;
  
  try {
    // First, find the channel in the channels database
    const channels = await fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options);
    const found = Array.isArray(channels) ? channels.find(ch => ch.id === channelId) : null;
    const channel = found ? { ...found } : null;
    
    if (!channel) return null;
    
    // Find the stream data
    const streams = await fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options);
    const channelStreams = getStreamIndex(streams).get(channelId) || [];
    
    if (channelStreams.length > 0) {
      channel.streams = channelStreams;
      channel.url = channelStreams[0].url; // Use the first stream as default
    }
    
    // EPG guides.json is large; only download it when asked for
    if (options.includeGuide) {
      try {
        const guides = await fetchWithCache(API_ENDPOINTS.GUIDES, 'api_guides', options);
        const channelGuide = guides.find(g => g.channel === channelId);
        if (channelGuide) {
          channel.guide = channelGuide;
        }
      } catch (e) {
        console.warn('Failed to fetch EPG data:', e);
      }
    }
    
    return channel;
  } catch (err) {
    console.error('Error getting channel details:', err);
    return null;
  }
}

/**
 * Get channels by country
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of channels for the country
 */
export async function getChannelsByCountry(countryCode, options = {}) {
  if (!countryCode) return [];
  return getChannels({ country: countryCode }, options);
}

/**
 * Get available countries with channel counts
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} List of countries with counts
 */
export async function getCountriesWithCounts(options = {}) {
  try {
    const [countries, channels] = await Promise.all([
      fetchWithCache(API_ENDPOINTS.COUNTRIES, 'api_countries', options),
      fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options)
    ]);
    
    // Calculate channel counts per country
    const countryCounts = channels.reduce((counts, channel) => {
      if (channel.country) {
        if (!counts[channel.country]) {
          counts[channel.country] = 0;
        }
        counts[channel.country]++;
      }
      return counts;
    }, {});
    
    // Add counts to country objects
    return countries.map(country => ({
      ...country,
      channelCount: countryCounts[country.code] || 0
    }));
  } catch (err) {
    console.error('Error getting countries with counts:', err);
    return [];
  }
}