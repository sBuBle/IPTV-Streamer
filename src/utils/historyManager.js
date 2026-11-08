/**
 * In-app navigation history helpers.
 *
 * preact-router pushes history entries with a `null` state, so on every route
 * change we tag the current entry with a `navKey` (unique per entry) and a
 * `navIndex` (its depth inside this app). That lets us:
 *  - know whether "Back" can go to a previous page of the app or must go Home,
 *  - remember the scroll position of each entry and restore it on back/forward,
 *  - keep per-entry page state (selected country, filters, page number...) so a
 *    list looks the same when you come back to it from the player.
 */
import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';

const SCROLL_KEY = 'iptv_nav_scroll';
const STATE_PREFIX = 'iptv_nav_state:';

let lastNavIndex = -1;
let isPopNavigation = false;
let restoreCancel = null;
let initialized = false;
let scrollPositions = {};

try {
  scrollPositions = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}') || {};
} catch {
  scrollPositions = {};
}

function newKey() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Make sure the current history entry carries a navKey/navIndex. */
function ensureEntryState() {
  const state = window.history.state;
  if (state && state.navKey) {
    return state;
  }
  const tagged = {
    ...(state && typeof state === 'object' ? state : {}),
    navKey: newKey(),
    navIndex: lastNavIndex + 1,
  };
  try {
    window.history.replaceState(tagged, document.title);
  } catch {
    // ignore (e.g. sandboxed iframe)
  }
  return tagged;
}

/** Key of the current history entry (creates one if needed). */
export function getNavKey() {
  return ensureEntryState().navKey;
}

/** True if there is a previous page of this app in the history stack. */
export function canGoBack() {
  const state = window.history.state;
  return !!(state && typeof state.navIndex === 'number' && state.navIndex > 0);
}

/**
 * Go back to the previous page of the app, like the browser Back button.
 * Falls back to `fallback` (Home by default) when the player was opened
 * directly (new tab, bookmark, reload as first page).
 */
export function goBack(fallback = '/') {
  if (canGoBack()) {
    window.history.back();
  } else {
    route(fallback, true);
  }
}

function saveScrollPositions() {
  try {
    const keys = Object.keys(scrollPositions);
    // keep the store small
    if (keys.length > 200) {
      keys.slice(0, keys.length - 200).forEach(k => delete scrollPositions[k]);
    }
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions));
  } catch {
    // storage full or unavailable - not critical
  }
}

let saveTimer = null;
function recordScroll() {
  const state = window.history.state;
  if (!state || !state.navKey) return;
  scrollPositions[state.navKey] = window.scrollY;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveScrollPositions, 250);
}

function cancelRestore() {
  if (restoreCancel) {
    restoreCancel();
    restoreCancel = null;
  }
}

/**
 * Scroll back to `target`. Pages load their data asynchronously, so keep
 * trying for a few seconds until the page is tall enough, and stop as soon as
 * the user scrolls on their own.
 */
function restoreScroll(target) {
  cancelRestore();
  if (!target) {
    window.scrollTo(0, 0);
    return;
  }

  let frame = null;
  const started = performance.now();

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('keydown', stop);
    window.removeEventListener('mousedown', stop);
  };

  const tick = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(target, Math.max(0, maxScroll)));
    if (maxScroll >= target || performance.now() - started > 4000) {
      stop();
      restoreCancel = null;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('keydown', stop);
  window.addEventListener('mousedown', stop);
  restoreCancel = stop;
  frame = requestAnimationFrame(tick);
}

/**
 * Call once at startup. Takes over scroll restoration from the browser and
 * starts recording scroll positions per history entry.
 */
export function initHistoryListener() {
  if (initialized) return;
  initialized = true;

  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  // Tag every history entry when it is created, and never stack two entries
  // for the same URL (a link that is handled twice, or clicking the link of
  // the page you're on). A duplicate entry made "Back" look like it did
  // nothing on the first press.
  const history = window.history;
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);

  history.pushState = (state, title, url) => {
    const current = history.state;
    const target = url == null ? null : new URL(url, window.location.href);
    if (target && target.pathname + target.search === window.location.pathname + window.location.search) {
      return history.replaceState(state, title, url);
    }
    const index = current && typeof current.navIndex === 'number' ? current.navIndex : lastNavIndex;
    return nativePush({
      ...(state && typeof state === 'object' ? state : {}),
      navKey: newKey(),
      navIndex: index + 1,
    }, title, url);
  };

  history.replaceState = (state, title, url) => {
    const current = history.state;
    let keep = {};
    if (current && current.navKey) {
      const target = url == null ? null : new URL(url, window.location.href);
      const samePage = !target || target.pathname === window.location.pathname;
      // Same page: keep its key (and saved state). Another page replacing
      // this entry gets a fresh key but keeps the position in the stack.
      keep = { navKey: samePage ? current.navKey : newKey(), navIndex: current.navIndex };
    }
    return nativeReplace({
      ...keep,
      ...(state && typeof state === 'object' ? state : {}),
    }, title, url);
  };

  window.addEventListener('popstate', () => {
    isPopNavigation = true;
  });

  window.addEventListener('scroll', recordScroll, { passive: true });
  window.addEventListener('pagehide', saveScrollPositions);
}

/**
 * Call from the Router's onChange. Tags the new entry and either restores the
 * scroll position (back/forward) or scrolls to the top (new page).
 */
export function handleRouteChange() {
  const wasPop = isPopNavigation;
  isPopNavigation = false;

  const state = ensureEntryState();
  lastNavIndex = state.navIndex;

  if (wasPop) {
    restoreScroll(scrollPositions[state.navKey] || 0);
  } else {
    cancelRestore();
    window.scrollTo(0, 0);
  }
}

/**
 * Like useState, but the value is remembered for the current history entry.
 * When the user leaves the page (e.g. opens the player) and comes back with
 * Back, the page starts with the same value again. Opening the page fresh from
 * a link starts with `initialValue`.
 */
export function useNavState(name, initialValue) {
  const [storageKey] = useState(() => `${STATE_PREFIX}${getNavKey()}:${name}`);

  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved !== null) return JSON.parse(saved);
    } catch {
      // fall through to the initial value
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  useEffect(() => {
    try {
      if (value === undefined) {
        sessionStorage.removeItem(storageKey);
      } else {
        sessionStorage.setItem(storageKey, JSON.stringify(value));
      }
    } catch {
      // storage full or value not serializable - not critical
    }
  }, [storageKey, value]);

  return [value, setValue];
}

/** True if useNavState has a saved value for `name` on the current entry. */
export function hasNavState(name) {
  try {
    return sessionStorage.getItem(`${STATE_PREFIX}${getNavKey()}:${name}`) !== null;
  } catch {
    return false;
  }
}
