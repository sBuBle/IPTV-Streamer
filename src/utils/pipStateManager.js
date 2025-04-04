/**
 * Utility for managing Picture-in-Picture state across route navigation
 */

// Constants
const PIP_STATE_KEY = 'iptv_pip_state';
const PIP_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
const DEBUG_PIP = true;

const debugLog = (...args) => {
  if (DEBUG_PIP) {
    console.log('[PiP State]', ...args);
  }
};

/**
 * Save PiP state to sessionStorage
 * @param {Object} channel - Channel data
 * @param {string} streamUrl - Stream URL
 * @param {Object} options - PiP options
 */
export const savePipState = (channel, streamUrl, options = {}) => {
  try {
    if (!channel || !streamUrl) {
      debugLog('Invalid PiP state data - missing channel or URL');
      return false;
    }
    
    // Clone and clean up the channel object to ensure it's serializable
    const cleanedChannel = {
      id: channel.id || null,
      name: channel.name || 'Unknown Channel',
      logo: channel.logo || null,
      group: channel.group || null,
      channelId: channel.channelId || channel.id || null,
      // Only include what we need and ensure no circular structures
    };
    
    // Sanitize options to ensure they're serializable
    const sanitizedOptions = { ...options };
    // Remove any circular references or functions
    Object.keys(sanitizedOptions).forEach(key => {
      if (typeof sanitizedOptions[key] === 'function' ||
          (typeof sanitizedOptions[key] === 'object' && sanitizedOptions[key] !== null && 
           !(sanitizedOptions[key] instanceof Array))) {
        delete sanitizedOptions[key];
      }
    });
    
    const state = {
      channel: cleanedChannel,
      streamUrl,
      options: sanitizedOptions,
      timestamp: Date.now(),
      version: '1.0' // Add version for potential future compatibility
    };
    
    const stateJson = JSON.stringify(state);
    sessionStorage.setItem(PIP_STATE_KEY, stateJson);
    debugLog('PiP state saved:', cleanedChannel.name, 'Size:', stateJson.length, 'bytes');
    
    return true;
  } catch (e) {
    console.warn('Failed to save PiP state:', e);
    // Try clearing the state to prevent issues with corrupt data
    try {
      sessionStorage.removeItem(PIP_STATE_KEY);
    } catch (clearErr) {
      console.error('Also failed to clear PiP state:', clearErr);
    }
    return false;
  }
};

/**
 * Validates if a loaded PiP state is complete and usable
 * @param {Object} state - The PiP state to validate
 * @returns {boolean} True if state is valid
 */
const isValidPipState = (state) => {
  if (!state) return false;
  
  // Check required properties
  const hasChannel = state.channel && typeof state.channel === 'object';
  const hasName = hasChannel && typeof state.channel.name === 'string';
  const hasStreamUrl = typeof state.streamUrl === 'string' && state.streamUrl.length > 5;
  const hasTimestamp = typeof state.timestamp === 'number';

  return hasChannel && hasName && hasStreamUrl && hasTimestamp;
};

/**
 * Load PiP state from sessionStorage
 * @returns {Object|null} The PiP state or null if not found/expired
 */
export const loadPipState = () => {
  try {
    const stateJson = sessionStorage.getItem(PIP_STATE_KEY);
    if (!stateJson) {
      debugLog('No PiP state found in storage');
      return null;
    }
    
    const state = JSON.parse(stateJson);
    
    // Validate the state
    if (!isValidPipState(state)) {
      debugLog('Invalid PiP state data structure');
      clearPipState();
      return null;
    }
    
    // Check if state is still valid (not expired)
    if (Date.now() - state.timestamp > PIP_EXPIRY_TIME) {
      debugLog('PiP state expired:', Math.round((Date.now() - state.timestamp) / 1000 / 60), 'minutes old');
      clearPipState();
      return null;
    }
    
    debugLog('PiP state loaded:', state.channel.name);
    return state;
  } catch (e) {
    console.warn('Failed to load PiP state:', e);
    // Try to clear corrupt data
    try {
      sessionStorage.removeItem(PIP_STATE_KEY);
    } catch (clearErr) {
      console.error('Also failed to clear corrupt PiP state:', clearErr);
    }
    return null;
  }
};

/**
 * Clear the stored PiP state
 */
export const clearPipState = () => {
  try {
    sessionStorage.removeItem(PIP_STATE_KEY);
    debugLog('PiP state cleared');
    return true;
  } catch (e) {
    console.warn('Failed to clear PiP state:', e);
    return false;
  }
};

/**
 * Check if browser supports PiP
 * @returns {boolean} True if PiP is supported
 */
export const isPipSupported = () => {
  try {
    return document && 
      document.pictureInPictureEnabled && 
      typeof HTMLVideoElement !== 'undefined' && 
      HTMLVideoElement.prototype.requestPictureInPicture;
  } catch (e) {
    return false;
  }
};

/**
 * Check if PiP is currently active
 * @returns {boolean} True if PiP is currently active
 */
export const isPipActive = () => {
  try {
    return document && !!document.pictureInPictureElement;
  } catch (e) {
    return false;
  }
};

/**
 * Check if we have a pending PiP activation in storage
 * @returns {boolean} True if there's a pending activation
 */
export const hasPendingPip = () => {
  try {
    const state = loadPipState();
    return state && (state.options?.pendingPiP || state.options?.needsActivation);
  } catch (e) {
    return false;
  }
};

/**
 * Diagnostic function that returns current PiP state
 * @returns {Object} Current PiP state info
 */
export const getPipDiagnostics = () => {
  try {
    const state = loadPipState();
    return {
      isSupported: isPipSupported(),
      isActive: isPipActive(),
      hasSavedState: !!state,
      isPending: state?.options?.pendingPiP || state?.options?.needsActivation,
      stateAge: state ? Math.round((Date.now() - state.timestamp) / 1000) : null,
      channelName: state?.channel?.name || null
    };
  } catch (e) {
    return {
      error: e.message,
      isSupported: false,
      isActive: false,
      hasSavedState: false
    };
  }
};
