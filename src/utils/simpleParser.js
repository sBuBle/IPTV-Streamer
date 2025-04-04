import * as apiClient from './apiClient';

/**
 * Parse M3U8 content into a structured format
 * @param {string} content - Raw M3U8 content as text
 * @returns {Object} Parsed manifest with headers and segments
 */
export function parseM3U8(content) {
  if (!content || typeof content !== 'string') {
    console.error('Invalid content provided to parseM3U8:', content);
    return { header: {}, segments: [] };
  }

  // Trim content and log some info for debugging
  content = content.trim();
  console.log(`Parsing ${content.length} bytes, starts with: ${content.substring(0, 50)}...`);
  
  // Check if this looks like an M3U file by searching for key indicators
  const hasExtM3u = content.includes('#EXTM3U');
  const hasExtInf = content.includes('#EXTINF');
  const hasHttpUrls = content.includes('http://') || content.includes('https://');
  
  console.log('Content indicators:', { hasExtM3u, hasExtInf, hasHttpUrls });
  
  const manifest = { header: {}, segments: [] };

  try {
    // Normalize line endings - some files might use \r\n or just \r
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // More flexible check - if it doesn't have #EXTM3U, add it for local files
    if (!hasExtM3u && hasExtInf) {
      console.log('Adding missing #EXTM3U header');
      content = '#EXTM3U\n' + content;
    }
    
    // Split into lines - this is crucial for correct parsing
    const lines = content.split('\n');
    console.log(`File contains ${lines.length} lines`);
    
    let currentSegment = null;
    let hasExtInfFound = false;
    
    // First pass - try standard M3U8 parsing
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        hasExtInfFound = true;
        currentSegment = { attributes: {} };
        
        // Try to extract duration
        const durationMatch = line.match(/#EXTINF:(-?\d+(\.\d+)?)/);
        currentSegment.duration = durationMatch ? parseFloat(durationMatch[1]) : 0;

        // Extract title (everything after comma)
        const commaIndex = line.indexOf(',');
        currentSegment.title = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : '';

        // Extract attributes like tvg-id, tvg-logo, etc.
        const attributes = {};
        const attrMatches = [...line.matchAll(/([a-zA-Z0-9-_]+)="([^"]*)"/g)];
        for (const match of attrMatches) {
          attributes[match[1]] = match[2];
        }
        currentSegment.attributes = attributes;
      } 
      // If we have a current segment and this line is not a comment, it's the URL
      else if (currentSegment && !line.startsWith('#')) {
        currentSegment.uri = line;
        manifest.segments.push(currentSegment);
        currentSegment = null;
      }
    }

    // If we couldn't find segments with #EXTINF tags, try a more lenient approach
    if (!hasExtInfFound || manifest.segments.length === 0) {
      console.log('No standard segments found, trying alternative parsing approaches');
      
      // Look for plain URLs
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines and comments (unless this is a channel name)
        if (!line || (line.startsWith('#') && !line.startsWith('#EXTINF'))) {
          continue;
        }
        
        // If it's a URL, add it as a segment
        if (line.match(/^https?:\/\//i) || line.match(/^rtmp:\/\//i) || 
            line.match(/^rtsp:\/\//i) || line.match(/^udp:\/\//i)) {
          
          // Try to find a name in the previous line if it was a comment
          let title = `Channel ${manifest.segments.length + 1}`;
          if (i > 0 && lines[i-1].startsWith('#') && !lines[i-1].startsWith('#EXTINF')) {
            title = lines[i-1].substring(1).trim();
          }
          
          manifest.segments.push({
            uri: line,
            title: title,
            attributes: {},
            duration: 0
          });
        }
      }
    }
    
    // If we still have no segments, make one last attempt to extract anything that looks like a URL
    if (manifest.segments.length === 0) {
      console.log('Still no segments found, looking for any URLs in content');
      const urlRegex = /(https?:\/\/[^\s\n\r]+)/g;
      const matches = content.match(urlRegex);
      
      if (matches && matches.length > 0) {
        console.log(`Found ${matches.length} URLs`);
        matches.forEach((url, index) => {
          manifest.segments.push({
            uri: url,
            title: `Channel ${index + 1}`,
            attributes: {},
            duration: 0
          });
        });
      }
    }
    
    console.log(`Parsing complete: found ${manifest.segments.length} segments`);
    return manifest;
  } catch (error) {
    console.error('Error parsing M3U8:', error);
    return { header: {}, segments: [] };
  }
}

/**
 * Extract channels from parsed manifest
 * @param {Object} manifest - Parsed manifest
 * @param {string} playlistId - Optional playlist ID to associate with channels
 * @returns {Array} Array of channel objects
 */
export function extractChannels(manifest, playlistId = null) {
  if (!manifest || !manifest.segments || !Array.isArray(manifest.segments)) {
    return [];
  }
  
  return manifest.segments.map((segment, index) => {
    const channel = {
      id: `channel_${index}`,
      name: segment.title || `Channel ${index + 1}`,
      url: segment.uri,
      duration: segment.duration,
      attributes: segment.attributes || {}
    };
    
    if (playlistId) {
      channel.playlistId = playlistId;
    }
    
    // Extract metadata from attributes
    if (channel.attributes) {
      channel.tvgId = channel.attributes['tvg-id'];
      channel.logo = channel.attributes['tvg-logo'];
      channel.group = channel.attributes['group-title'] || 'Uncategorized';
      channel.tvgCountry = channel.attributes['tvg-country'];
      channel.tvgLanguage = channel.attributes['tvg-language'];
    }
    
    return channel;
  });
}

/**
 * Format and standardize logo URL 
 * @param {string} url - Raw logo URL 
 * @returns {string} - Formatted logo URL 
 */
export function formatLogoUrl(url) {
  if (!url) return null;
  
  try {
    // Remove whitespace
    url = url.trim();
    
    // Handle data URLs directly
    if (url.startsWith('data:image/')) {
      return url;
    }
    
    // Some logos in m3u files are stored without proper protocol
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }

    // If it's already a valid URL with http/https protocol, return it
    if (url.match(/^https?:\/\//i)) {
      return url;
    }
    
    // Try to get the logo from the API client
    return apiClient.getLogoUrl(url);
  } catch (error) {
    return url; // Return original as fallback
  }
}

/**
 * Fetch a playlist from the given URL
 * @param {string} url - URL of the playlist
 * @returns {Promise<Object>} - Parsed playlist data
 */
export async function fetchPlaylist(url) {
  try {
    console.log(`Fetching playlist from: ${url}`);
    
    // Add a timeout to prevent hanging on non-responsive URLs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for slower proxies
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    // Handle different HTTP status codes
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Playlist not found (404). Please verify the URL is correct.`);
      } else if (response.status === 403) {
        throw new Error(`Access forbidden (403). This playlist may require authorization.`);
      } else if (response.status === 429) {
        throw new Error(`Too many requests (429). Please try again later.`);
      } else {
        throw new Error(`Server returned ${response.status} ${response.statusText}`);
      }
    }
    
    const text = await response.text();

    // More flexible M3U8 validation - some files don't have perfect formatting
    if (!text || text.length < 10) {
      throw new Error('Playlist content is empty or too short');
    }
    
    // Check if it contains key M3U8 indicators even if not at the very beginning
    const isM3U8 = text.includes('#EXTM3U') || 
                   (text.includes('#EXTINF') && text.includes('http'));
                   
    if (!isM3U8) {
      // Try to detect if it's HTML or other format and give appropriate error
      if (text.includes('<html') || text.includes('<!DOCTYPE')) {
        throw new Error('URL returned an HTML page instead of an M3U8 playlist. Try using the raw file URL.');
      } else if (text.includes('<?xml')) {
        throw new Error('URL returned XML data instead of an M3U8 playlist.');
      } else {
        throw new Error('Response is not a valid M3U8 playlist');
      }
    }
    
    // Fix common formatting issues before parsing
    const cleanedText = text
      .replace(/^[\r\n\s]+#EXTM3U/, '#EXTM3U') // Remove whitespace before header
      .replace(/[\r\n]+/g, '\n')               // Normalize line endings
      .replace(/\n{3,}/g, '\n\n');             // Reduce excessive blank lines
    
    return parseM3U8(cleanedText);
  } catch (error) {
    // Format the error message more clearly
    let errorMsg = "Failed to fetch playlist";
    
    if (error.name === 'AbortError') {
      errorMsg = "Request timed out. The server might be unresponsive.";
    } else if (error.message) {
      errorMsg = error.message;
    }
    
    console.error(`Error fetching playlist: ${errorMsg}`);
    throw new Error(errorMsg);
  }
}
