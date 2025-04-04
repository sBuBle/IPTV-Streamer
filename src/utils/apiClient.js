import { get, set } from './idbStorage';
import { formatLogoUrl } from './logoService';

// Updated API endpoints based on latest IPTV-org API documentation
const API_ENDPOINTS = {
  // Core data endpoints
  CHANNELS: 'https://iptv-org.github.io/api/channels.json',
  STREAMS: 'https://iptv-org.github.io/api/streams.json',
  GUIDES: 'https://iptv-org.github.io/api/guides.json',
  
  // Classification endpoints
  CATEGORIES: 'https://iptv-org.github.io/api/categories.json',
  LANGUAGES: 'https://iptv-org.github.io/api/languages.json',
  COUNTRIES: 'https://iptv-org.github.io/api/countries.json',
  REGIONS: 'https://iptv-org.github.io/api/regions.json',
  SUBDIVISIONS: 'https://iptv-org.github.io/api/subdivisions.json',
  
  // Logos endpoint (used for channel logos)
  LOGOS: 'https://iptv-org.github.io/api/logos',
  
  // Remove the non-existent endpoint
  // UPDATED: 'https://iptv-org.github.io/api/updated.json'
};

// Cache duration constants (in milliseconds)
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch data from API with caching
 * @param {string} url - API endpoint URL
 * @param {string} cacheKey - Cache key for data
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Fetched data
 */
async function fetchWithCache(url, cacheKey, options = {}) {
  try {
    // Try cache first
    const cached = await get(cacheKey);
    const cacheTimestamp = await get(`${cacheKey}_timestamp`);
    
    if (cached && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION) && !options.forceRefresh) {
      return cached;
    }
    
    // Simplified cache invalidation - just check if cache duration has expired
    // or if forceRefresh is requested
    let shouldUpdate = true;
    
    // If we have a valid cache timestamp and it's not expired, respect it
    if (cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION) && !options.forceRefresh) {
      shouldUpdate = false;
    }
    
    if (!shouldUpdate && cached) {
      return cached;
    }
    
    // Fetch new data
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'IPTV-Viewer-App',
      },
      ...options,
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Update cache
    await set(cacheKey, data);
    await set(`${cacheKey}_timestamp`, Date.now());
    
    return data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    
    // Return cached data even if expired
    const cached = await get(cacheKey);
    if (cached) {
      return cached;
    }
    
    throw error;
  }
}

/**
 * Get logo URL for a channel
 * @param {string} channelName - Channel name
 * @returns {string} URL to channel logo
 */
export function getLogoUrl(channelName) {
  const baseUrl = 'https://example.com/logos/'; // Replace with actual logo API URL
  const encodedName = encodeURIComponent(channelName);
  const url = `${baseUrl}${encodedName}.png`;
  
  return formatLogoUrl(url);
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
    // Load channels, streams, and any needed lookup data
    const [channels, streams] = await Promise.all([
      fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options),
      fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options)
    ]);
    
    // If no channels or streams, return empty array
    if (!channels || !channels.length) {
      return [];
    }
    
    // Create an index of streams by channel ID for faster lookup
    const streamsByChannel = streams ? streams.reduce((acc, stream) => {
      if (!acc[stream.channel]) {
        acc[stream.channel] = [];
      }
      acc[stream.channel].push(stream);
      return acc;
    }, {}) : {};
    
    // Apply filters
    let filteredChannels = [...channels];
    
    // Apply category filter
    if (filters.category) {
      filteredChannels = filteredChannels.filter(channel => 
        channel.categories && 
        Array.isArray(channel.categories) && 
        channel.categories.some(cat => 
          cat.toLowerCase() === filters.category.toLowerCase()
        )
      );
    }
    
    // Apply country filter - updated for current API structure
    if (filters.country) {
      filteredChannels = filteredChannels.filter(channel => {
        // Direct country match
        if (channel.country && channel.country.toLowerCase() === filters.country.toLowerCase()) {
          return true;
        }
        
        // Check broadcast_area for country entries (format: "c.XX")
        if (channel.broadcast_area && Array.isArray(channel.broadcast_area)) {
          return channel.broadcast_area.some(area => 
            area.toLowerCase() === `c.${filters.country.toLowerCase()}` || 
            area.toLowerCase() === filters.country.toLowerCase()
          );
        }
        
        return false;
      });
      
      console.log(`Found ${filteredChannels.length} channels for country ${filters.country}`);
    }
    
    // Apply language filter
    if (filters.language) {
      filteredChannels = filteredChannels.filter(channel => 
        channel.languages && 
        Array.isArray(channel.languages) && 
        channel.languages.some(lang => 
          lang.toLowerCase() === filters.language.toLowerCase()
        )
      );
    }
    
    // Combine channel data with stream URLs
    return filteredChannels.map(channel => {
      const channelStreams = streamsByChannel[channel.id] || [];
      
      // Get the first (or most reliable) stream URL for this channel
      const bestStream = channelStreams.length > 0 ? channelStreams[0] : null;
      
      return {
        ...channel,
        url: bestStream ? bestStream.url : null,
        resolution: bestStream ? bestStream.resolution : null,
        status: bestStream ? bestStream.status : null,
        httpReferrer: bestStream ? bestStream.http_referrer : null,
        userAgent: bestStream ? bestStream.user_agent : null
      };
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
    const channel = channels.find(ch =>
      ch.id?.toLowerCase() === searchTerm ||
      ch.name?.toLowerCase() === searchTerm ||
      ch.name?.toLowerCase().includes(searchTerm)
    );

    if (channel) {
      // Get stream URL for this channel
      try {
        const streams = await fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options);
        const channelStreams = streams.filter(s => s.channel === channel.id);
        
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
 * Get channel details including EPG data if available
 * @param {string} channelId - Channel ID to get details for
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Channel details with EPG data
 */
export async function getChannelDetails(channelId, options = {}) {
  if (!channelId) return null;
  
  try {
    // First, find the channel in the channels database
    const channels = await fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options);
    const channel = channels.find(ch => ch.id === channelId);
    
    if (!channel) return null;
    
    // Find the stream data
    const streams = await fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options);
    const channelStreams = streams.filter(s => s.channel === channelId);
    
    if (channelStreams.length > 0) {
      channel.streams = channelStreams;
      channel.url = channelStreams[0].url; // Use the first stream as default
    }
    
    // Try to get EPG data if available
    try {
      const guides = await fetchWithCache(API_ENDPOINTS.GUIDES, 'api_guides', options);
      const channelGuide = guides.find(g => g.channel === channelId);
      
      if (channelGuide) {
        channel.guide = channelGuide;
      }
    } catch (e) {
      console.warn('Failed to fetch EPG data:', e);
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
  
  try {
    const [channels, streams] = await Promise.all([
      fetchWithCache(API_ENDPOINTS.CHANNELS, 'api_channels', options),
      fetchWithCache(API_ENDPOINTS.STREAMS, 'api_streams', options)
    ]);
    
    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      console.warn('No channels found in API response');
      return [];
    }

    // Debug: Log the structure of the first channel to understand data format
    console.log('Example channel structure:', JSON.stringify(channels[0]));
    
    // According to the API documentation, country is a direct property (not an array)
    // Also check broadcast_area which may contain country codes in format "c.XX"
    const countryChannels = channels.filter(channel => {
      // Direct country match
      if (channel.country && channel.country.toLowerCase() === countryCode.toLowerCase()) {
        return true;
      }
      
      // Check broadcast_area for country entries (format: "c.XX")
      if (channel.broadcast_area && Array.isArray(channel.broadcast_area)) {
        return channel.broadcast_area.some(area => 
          area.toLowerCase() === `c.${countryCode.toLowerCase()}` || 
          area.toLowerCase() === countryCode.toLowerCase()
        );
      }
      
      return false;
    });
    
    console.log(`Found ${countryChannels.length} raw channels for country ${countryCode}`);
    
    // Create an index of streams by channel ID for faster lookup
    const streamsByChannel = {};
    if (streams && Array.isArray(streams)) {
      streams.forEach(stream => {
        if (!stream.channel) return;
        if (!streamsByChannel[stream.channel]) {
          streamsByChannel[stream.channel] = [];
        }
        streamsByChannel[stream.channel].push(stream);
      });
    }
    
    // Combine channel data with stream URLs
    const channelsWithStreams = countryChannels.map(channel => {
      const channelStreams = streamsByChannel[channel.id] || [];
      const bestStream = channelStreams.length > 0 ? channelStreams[0] : null;
      
      return {
        ...channel,
        url: bestStream ? bestStream.url : null,
        logo: channel.logo || `${API_ENDPOINTS.LOGOS}/${channel.id}.png`,
        resolution: bestStream ? bestStream.resolution : null,
        status: bestStream ? bestStream.status : null,
        httpReferrer: bestStream ? bestStream.http_referrer : null,
        userAgent: bestStream ? bestStream.user_agent : null
      };
    });
    
    console.log(`Returning ${channelsWithStreams.length} channels with streams for country ${countryCode}`);
    return channelsWithStreams;
  } catch (err) {
    console.error(`Error getting channels for country ${countryCode}:`, err);
    return [];
  }
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