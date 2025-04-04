import { get, set } from './idbStorage';

/**
 * Toggle favorite status of a channel
 * @param {Object} channel The channel object to toggle
 * @returns {Promise<boolean|null>} New favorite status or null on error
 */
export const toggleFavorite = async (channel) => {
  if (!channel || !channel.id) {
    console.error('Invalid channel object for toggling favorite', channel);
    return null;
  }
  
  try {
    const favorites = await get('favorites') || [];
    
    // Make sure favorites is an array
    if (!Array.isArray(favorites)) {
      console.warn('Favorites is not an array, resetting it');
      await set('favorites', []);
      return toggleFavorite(channel); // Try again with empty array
    }
    
    const isCurrentlyFavorite = favorites.some(fav => fav.id === channel.id);
    
    let updatedFavorites;
    
    if (isCurrentlyFavorite) {
      // Remove from favorites
      updatedFavorites = favorites.filter(fav => fav.id !== channel.id);
      console.log(`Removed ${channel.name || channel.id} from favorites`);
    } else {
      // Add to favorites with timestamp
      const favoriteChannel = {
        ...channel,
        addedToFavoritesAt: new Date().toISOString()
      };
      updatedFavorites = [...favorites, favoriteChannel];
      console.log(`Added ${channel.name || channel.id} to favorites`);
    }
    
    // Update storage
    const success = await set('favorites', updatedFavorites);
    
    if (!success) {
      console.error('Failed to update favorites in storage');
      return null;
    }
    
    return !isCurrentlyFavorite; // Return new favorite status
  } catch (err) {
    console.error('Error toggling favorite:', err);
    return null;
  }
};

/**
 * Check if a channel is in favorites
 * @param {string} channelId The channel ID to check
 * @returns {Promise<boolean>} Whether the channel is a favorite
 */
export const isFavorite = async (channelId) => {
  if (!channelId) return false;
  
  try {
    const favorites = await get('favorites') || [];
    
    // Make sure favorites is an array
    if (!Array.isArray(favorites)) {
      console.warn('Favorites is not an array');
      return false;
    }
    
    return favorites.some(fav => fav.id === channelId);
  } catch (err) {
    console.error('Error checking favorite status:', err);
    return false;
  }
};

/**
 * Get all favorites
 * @returns {Promise<Array>} Array of favorite channels
 */
export const getFavorites = async () => {
  try {
    const favorites = await get('favorites');
    
    // Make sure favorites is an array
    if (!Array.isArray(favorites)) {
      console.warn('Favorites is not an array, resetting');
      await set('favorites', []);
      return [];
    }
    
    return favorites;
  } catch (err) {
    console.error('Error getting favorites:', err);
    return [];
  }
};

/**
 * Remove a channel from favorites
 * @param {string} channelId The ID of the channel to remove
 * @returns {Promise<boolean>} Success status
 */
export const removeFavorite = async (channelId) => {
  if (!channelId) return false;
  
  try {
    const favorites = await get('favorites') || [];
    
    // Make sure favorites is an array
    if (!Array.isArray(favorites)) {
      console.warn('Favorites is not an array, resetting');
      await set('favorites', []);
      return false;
    }
    
    const updatedFavorites = favorites.filter(fav => fav.id !== channelId);
    
    if (updatedFavorites.length === favorites.length) {
      // Nothing changed
      return false;
    }
    
    return await set('favorites', updatedFavorites);
  } catch (err) {
    console.error('Error removing favorite:', err);
    return false;
  }
};

/**
 * Clear all favorites
 * @returns {Promise<boolean>} Success status
 */
export const clearFavorites = async () => {
  try {
    return await set('favorites', []);
  } catch (err) {
    console.error('Error clearing favorites:', err);
    return false;
  }
};
