import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Loader, AlertCircle } from 'lucide-preact';

/**
 * Route-level code splitting. Each page is loaded on first visit (or earlier
 * via `.preload()`, e.g. when a nav link is hovered), so the first paint only
 * downloads the app shell instead of every page and hls.js.
 */
export function lazyPage(load) {
  let Component = null;
  let promise = null;

  const preload = () => {
    if (!promise) {
      promise = load()
        .then((mod) => {
          Component = mod.default;
          return Component;
        })
        .catch((err) => {
          promise = null; // allow a retry
          throw err;
        });
    }
    return promise;
  };

  function LazyPage(props) {
    const [Loaded, setLoaded] = useState(() => Component);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (Loaded) return;
      let alive = true;
      preload()
        .then((C) => alive && setLoaded(() => C))
        .catch((err) => {
          console.error('Failed to load page:', err);
          if (alive) setFailed(true);
        });
      return () => {
        alive = false;
      };
    }, [Loaded]);

    if (Loaded) return h(Loaded, props);
    if (failed) {
      return (
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle class="w-10 h-10 text-red-400 mb-3" />
          <p class="text-gray-300 mb-4">This page could not be loaded. You may be offline, or the app was updated.</p>
          <button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return <PageSpinner />;
  }

  LazyPage.preload = preload;
  return LazyPage;
}

export function PageSpinner() {
  return (
    <div class="flex items-center justify-center py-20" role="status" aria-label="Loading">
      <Loader class="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
}
