import { get as idbGet, set as idbSet, del, keys, clear, createStore } from 'idb-keyval';

// Custom store with increased performance
const store = createStore('iptv-db', 'iptv-store');

// Create a singleton for LZString loading to avoid multiple imports
let lzStringPromise;
const getLZString = () => {
  if (!lzStringPromise) {
    lzStringPromise = import('lz-string').catch(e => {
      console.warn('LZ-String import failed:', e);
      return null;
    });
  }
  return lzStringPromise;
};

// Cache frequently accessed items in memory
const cache = new Map();
const CACHE_TTL = 120000; // 2 minutes
const CACHE_SIZE_LIMIT = 50; // Maximum items in cache

/**
 * Get a value from IndexedDB with caching and decompression
 * @param {string} key - The key to retrieve
 * @param {boolean} skipCache - Skip checking the cache
 * @returns {Promise<any>} - The value or undefined if not found
 */
export async function get(key, skipCache = false) {
  try {
    // Check cache first if not skipping
    if (!skipCache && cache.has(key)) {
      const { value, expires } = cache.get(key);
      if (expires > Date.now()) return value;
      cache.delete(key); // Remove expired item
    }

    const value = await idbGet(key, store);
    if (value === undefined) return undefined;

    // Handle compressed values (strings starting with special marker)
    let result = value;
    if (typeof value === 'string' && value.startsWith('CMPR:')) {
      const lzString = await getLZString();
      try {
        result = lzString
          ? JSON.parse(lzString.decompressFromUTF16(value.slice(5)))
          : JSON.parse(value.slice(5));
      } catch (e) {
        console.warn(`Decompression failed for key ${key}:`, e);
        result = value; // Fallback to raw value
      }
    }

    // Cache the result if it's not too large
    if (typeof result !== 'string' || result.length < 500000) {
      enforceCacheSizeLimit();
      cache.set(key, { value: result, expires: Date.now() + CACHE_TTL });
    }

    return result;
  } catch (err) {
    console.error(`IndexedDB get error for key ${key}:`, err);
    return undefined;
  }
}

/**
 * Store a value in IndexedDB with optional compression
 * @param {string} key - The key to store
 * @param {any} value - The value to store
 * @param {boolean} useCompression - Whether to compress the value
 * @returns {Promise<boolean>} - Success status
 */
export async function set(key, value, useCompression = false) {
  try {
    let storableValue = value;

    // Only compress if requested and value is large or complex
    const valueStr = JSON.stringify(value);
    const isLarge = valueStr.length > 10000;

    if ((useCompression || isLarge) && value !== null && value !== undefined) {
      const lzString = await getLZString();
      try {
        storableValue = lzString
          ? 'CMPR:' + lzString.compressToUTF16(valueStr)
          : valueStr;
      } catch (e) {
        console.warn(`Compression failed for key ${key}:`, e);
        storableValue = valueStr; // Fall back to uncompressed
      }
    }

    await idbSet(key, storableValue, store);

    // Update cache with reasonable size limit
    if (typeof valueStr !== 'string' || valueStr.length < 500000) {
      enforceCacheSizeLimit();
      cache.set(key, { value, expires: Date.now() + CACHE_TTL });
    }

    return true;
  } catch (err) {
    console.error(`IndexedDB set error for key ${key}:`, err);
    return false;
  }
}

/**
 * Remove a value from IndexedDB
 * @param {string} key - The key to remove
 * @returns {Promise<boolean>} - Success status
 */
export async function remove(key) {
  try {
    await del(key, store);
    cache.delete(key);
    return true;
  } catch (err) {
    console.error(`IndexedDB delete error for key ${key}:`, err);
    return false;
  }
}

/**
 * List all keys in the store
 * @returns {Promise<string[]>} - Array of keys
 */
export async function getAllKeys() {
  try {
    return await keys(store);
  } catch (err) {
    console.error('IndexedDB keys error:', err);
    return [];
  }
}

/**
 * Clear all data in the store
 * @returns {Promise<boolean>} - Success status
 */
export async function clearAll() {
  try {
    await clear(store);
    cache.clear();
    return true;
  } catch (err) {
    console.error('IndexedDB clear error:', err);
    return false;
  }
}

/**
 * Store a large object with automatic compression
 * @param {string} key - The key to store
 * @param {any} value - The value to store
 * @returns {Promise<boolean>} - Success status
 */
export async function setLarge(key, value) {
  return set(key, value, true);
}

/**
 * Check if a key exists in the store
 * @param {string} key - The key to check
 * @returns {Promise<boolean>} - True if the key exists
 */
export async function has(key) {
  // First check cache
  if (cache.has(key)) {
    const { expires } = cache.get(key);
    if (expires > Date.now()) return true;
    cache.delete(key); // Remove expired item
  }

  // Then check store
  try {
    const value = await idbGet(key, store);
    return value !== undefined;
  } catch (err) {
    console.error(`IndexedDB has error for key ${key}:`, err);
    return false;
  }
}

/**
 * Batch get multiple keys at once
 * @param {string[]} keyArray - Array of keys to retrieve
 * @returns {Promise<Object>} - Object with key-value pairs
 */
export async function getBatch(keyArray) {
  if (!Array.isArray(keyArray) || keyArray.length === 0) return {};

  const result = {};
  const keysToFetch = [];

  // First check cache
  for (const key of keyArray) {
    if (cache.has(key)) {
      const { value, expires } = cache.get(key);
      if (expires > Date.now()) {
        result[key] = value;
      } else {
        cache.delete(key); // Remove expired item
        keysToFetch.push(key);
      }
    } else {
      keysToFetch.push(key);
    }
  }

  // Fetch remaining keys
  if (keysToFetch.length > 0) {
    const promises = keysToFetch.map(async (key) => {
      try {
        const value = await get(key, true);
        result[key] = value;
      } catch (err) {
        console.error(`Error fetching key ${key} in batch:`, err);
      }
    });

    await Promise.all(promises);
  }

  return result;
}

/**
 * Clear expired cache entries
 */
export function cleanCache() {
  const now = Date.now();
  for (const [key, { expires }] of cache.entries()) {
    if (expires < now) cache.delete(key);
  }
}

/**
 * Enforce cache size limit
 */
function enforceCacheSizeLimit() {
  while (cache.size > CACHE_SIZE_LIMIT) {
    const oldestKey = [...cache.keys()][0];
    cache.delete(oldestKey);
  }
}

// Auto clean cache every two minutes
const cleanupInterval = setInterval(cleanCache, 120000);

// Export the cleanup interval for proper shutdown
export const cleanup = () => {
  clearInterval(cleanupInterval);
  cache.clear();
};

// Export all methods from idb-keyval for direct access if needed
export { keys, clear };

/**
 * Enhanced IndexedDB get with better error handling
 * @param {string} key The key to retrieve
 * @returns {Promise<any>} The stored value or null
 */
export const enhancedGet = async (key) => {
  try {
    const value = await idbGet(key);
    
    // Handle null/undefined case
    if (value === undefined || value === null) {
      return null;
    }
    
    return value;
  } catch (error) {
    console.error(`Error getting ${key} from IndexedDB:`, error);
    // Return null on error instead of throwing
    return null;
  }
};

/**
 * Enhanced IndexedDB set with validation and error handling
 * @param {string} key The key to store
 * @param {any} value The value to store
 * @returns {Promise<boolean>} Success status
 */
export const enhancedSet = async (key, value) => {
  try {
    // Validate key
    if (!key || typeof key !== 'string') {
      console.error('Invalid key for IndexedDB storage:', key);
      return false;
    }
    
    // Store the value
    await idbSet(key, value);
    return true;
  } catch (error) {
    console.error(`Error setting ${key} in IndexedDB:`, error);
    return false;
  }
};

/**
 * Add an item to an array stored in IndexedDB
 * @param {string} key The key of the array
 * @param {any} item The item to add
 * @returns {Promise<boolean>} Success status
 */
export const addToArray = async (key, item) => {
  try {
    // Get current array or default to empty
    const currentArray = await enhancedGet(key) || [];
    
    // Add item if it doesn't already exist (by id)
    if (item.id && currentArray.some(existingItem => existingItem.id === item.id)) {
      // Item already exists, replace it
      const updatedArray = currentArray.map(existingItem => 
        existingItem.id === item.id ? item : existingItem
      );
      return await enhancedSet(key, updatedArray);
    } else {
      // Add new item
      const updatedArray = [...currentArray, item];
      return await enhancedSet(key, updatedArray);
    }
  } catch (error) {
    console.error(`Error adding to array ${key} in IndexedDB:`, error);
    return false;
  }
};

/**
 * Remove an item from an array stored in IndexedDB
 * @param {string} key The key of the array
 * @param {string} itemId The ID of the item to remove
 * @returns {Promise<boolean>} Success status
 */
export const removeFromArray = async (key, itemId) => {
  try {
    // Get current array
    const currentArray = await enhancedGet(key) || [];
    
    // Remove item by id
    const updatedArray = currentArray.filter(item => item.id !== itemId);
    
    // Only update if something was removed
    if (updatedArray.length !== currentArray.length) {
      return await enhancedSet(key, updatedArray);
    }
    return true;
  } catch (error) {
    console.error(`Error removing from array ${key} in IndexedDB:`, error);
    return false;
  }
};
