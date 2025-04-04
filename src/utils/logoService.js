import * as apiClient from './apiClient';

/**
 * Generate a color based on a channel name
 * @param {string} name - Channel name
 * @returns {string} - CSS color value
 */
export function getChannelColor(name) {
  // Default color for empty or undefined names
  if (!name) return '#4A5568';
  
  // Use simple hash function to generate consistent color based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate HSL color with good saturation and lightness for visibility
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * Generate initials from a channel name
 * @param {string} name - Channel name
 * @returns {string} - Initials (1-2 characters)
 */
export function getChannelInitials(name) {
  if (!name) return '?';
  
  // Split into words
  const words = name.trim().split(/\s+/);
  
  if (words.length === 1) {
    // If single word, use first character (uppercase)
    return words[0].charAt(0).toUpperCase();
  } else {
    // Use first character of first and last word
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }
}

/**
 * Enhanced function to get channel logo with fallback
 * @param {object} channel - Channel object
 * @returns {string|null} - Logo URL or null
 */
export function getChannelLogo(channel) {
  if (!channel) return null;
  
  // If channel has a logo property, use it
  if (channel.logo) return channel.logo;
  
  // Try to find logo by ID first
  if (channel.id) {
    const logoById = apiClient.getLogoUrl(channel.id);
    if (logoById) return logoById;
  }
  
  // Try by name if ID didn't find anything
  if (channel.name) {
    const logoByName = apiClient.getLogoUrl(channel.name);
    if (logoByName) return logoByName;
  }
  
  // If still no logo, try by channelId if available (used in some APIs)
  if (channel.channelId) {
    const logoByChannelId = apiClient.getLogoUrl(channel.channelId);
    if (logoByChannelId) return logoByChannelId;
  }
  
  // No logo found
  return null;
}

/**
 * Preload channel logos for a batch of channels
 * @param {Array} channels - Array of channel objects
 */
export async function preloadChannelLogos(channels) {
  // Don't block the main thread - use setTimeout
  setTimeout(() => {
    if (!Array.isArray(channels)) return;
    
    const logoCache = JSON.parse(localStorage.getItem('channelLogos') || '{}');
    const updated = { ...logoCache };
    let changed = false;
    
    // Process channels in batches of 20
    const batchSize = 20;
    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      
      setTimeout(() => {
        batch.forEach(channel => {
          // Skip if we already have this channel's logo
          if (channel.id && logoCache[channel.id]) return;
          
          const logo = getChannelLogo(channel);
          if (logo && channel.id) {
            updated[channel.id] = logo;
            changed = true;
          }
        });
        
        // Save updated cache periodically
        if (changed) {
          localStorage.setItem('channelLogos', JSON.stringify(updated));
        }
      }, 100); // Small delay between batches
    }
  }, 0);
}

/**
 * Create a placeholder image for channels without logos
 * @param {string} name - Channel name
 * @returns {string} - Data URL of SVG image
 */
export function createPlaceholderImage(name) {
  const color = getChannelColor(name);
  const initials = getChannelInitials(name);
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="${color}" />
      <text x="50" y="50" font-family="Arial, sans-serif" font-size="40" 
            font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">
        ${initials}
      </text>
    </svg>
  `;
  
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Formats and normalizes a logo URL
 * @param {string} url - The URL to format
 * @returns {string} - Formatted URL or empty string if invalid
 */
export function formatLogoUrl(url) {
  if (!url) return '';
  
  // Handle different URL formats
  try {
    // Clean up the URL
    url = url.trim();
    
    // If it's a data URI, return as is
    if (url.startsWith('data:image/')) {
      return url;
    }
    
    // Ensure URL has a protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url.replace(/^\/\//, '');
    }
    
    // Return the formatted URL
    return url;
  } catch (err) {
    console.error('Error formatting logo URL:', err);
    return '';
  }
}
