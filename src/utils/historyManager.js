/**
 * Utility functions to manage browser history state
 * and provide better navigation experience
 */

/**
 * Update the URL without adding to history stack
 * @param {string} path - The path to update to
 * @param {Object} state - State object to store in history
 */
export function updateUrlSilently(path, state = {}) {
  // Preserve existing scroll position when updating URL
  const currentState = window.history.state || {};
  const newState = { ...currentState, ...state };
  
  window.history.replaceState(newState, document.title, path);
}

/**
 * Navigate to a new route with history tracking
 * @param {string} path - Path to navigate to
 * @param {Object} state - State object to store in history
 */
export function navigateTo(path, state = {}) {
  // Automatically save the current scroll position before navigation
  const newState = { ...state, scrollY: window.scrollY };
  window.history.pushState(newState, document.title, path);
}

/**
 * Store current scroll position in history state
 */
export function saveScrollPosition() {
  const currentState = window.history.state || {};
  window.history.replaceState(
    { ...currentState, scrollY: window.scrollY },
    document.title,
    window.location.pathname
  );
}

/**
 * Restore scroll position from history state
 */
export function restoreScrollPosition() {
  const state = window.history.state || {};
  if (state.scrollY !== undefined) {
    window.scrollTo(0, state.scrollY);
  }
}

/**
 * Initialize history listener 
 * (restores scroll position when navigating through history)
 */
export function initHistoryListener() {
  // Listen for popstate events (browser back/forward navigation)
  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.scrollY !== undefined) {
      window.scrollTo(0, event.state.scrollY);
    }
  });
  
  // Also handle initial page load
  if (window.history.state?.scrollY) {
    restoreScrollPosition();
  }
}
