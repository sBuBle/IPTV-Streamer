import { h } from 'preact';
import { Router } from 'preact-router';
import { useState, useEffect } from 'preact/hooks';
import { MoreHorizontal, Settings as SettingsIcon, Home as HomeIcon, Heart, History, Globe, List, Info } from 'lucide-preact';
import { getPlaylists } from './utils/playlist';
import { PictureInPictureProvider } from './contexts/PictureInPictureContext';
import { PictureInPictureOverlay } from './components/PictureInPictureOverlay';
import { PipAwareAppLayout } from './components/PipAwareAppLayout';
import { initHistoryListener, handleRouteChange as trackRouteChange } from './utils/historyManager';

import { lazyPage } from './components/lazyPage';

// Pages are split into their own chunks and loaded on demand
const Home = lazyPage(() => import('./pages/Home'));
const Player = lazyPage(() => import('./pages/Player'));
const SettingsPage = lazyPage(() => import('./pages/Settings'));
const Favorites = lazyPage(() => import('./pages/Favorites'));
const WatchHistory = lazyPage(() => import('./pages/WatchHistory'));
const CountryBrowser = lazyPage(() => import('./pages/CountryBrowser'));
const PlaylistView = lazyPage(() => import('./pages/PlaylistView'));
const CategoryView = lazyPage(() => import('./pages/CategoryView'));
const About = lazyPage(() => import('./pages/About'));

const MAIN_LINKS = [
  { href: '/', label: 'Home', icon: HomeIcon, page: Home },
  { href: '/favorites', label: 'Favorites', icon: Heart, page: Favorites },
  { href: '/history', label: 'Watch History', icon: History, page: WatchHistory },
  { href: '/countries', label: 'Browse countries', icon: Globe, page: CountryBrowser },
];

// Mobile bottom tab bar (FigCraft "Mobile Home")
const TAB_LINKS = [
  { href: '/', label: 'Home', icon: HomeIcon, page: Home },
  { href: '/countries', label: 'Browse', icon: Globe, page: CountryBrowser },
  { href: '/favorites', label: 'Favorites', icon: Heart, page: Favorites },
  { href: '/history', label: 'History', icon: History, page: WatchHistory },
];

const SYSTEM_LINKS = [
  { href: '/settings', label: 'Settings', icon: SettingsIcon, page: SettingsPage },
  { href: '/about', label: 'About', icon: Info, page: About },
];

const PAGE_TITLES = {
  '/': 'Home',
  '/favorites': 'Favorites',
  '/history': 'Watch History',
  '/countries': 'Browse by Country',
  '/settings': 'Settings',
  '/about': 'About',
  '/watch': 'Now Playing',
  '/playlist': 'Playlist',
  '/category': 'Category',
};

function updateDocumentTitle(url) {
  const path = (url || '/').split('?')[0];
  const section = path === '/' ? '/' : '/' + path.split('/')[1];
  const title = PAGE_TITLES[section];
  document.title = title && section !== '/' ? `${title} · IPTV Streamer` : 'IPTV Streamer';
}

function isActive(href, currentUrl) {
  const path = (currentUrl || '/').split('?')[0];
  if (href === '/') return path === '/';
  return path === href || path.startsWith(href + '/');
}

// Logo mark drawn in VectorCraft (design/brand has the editable source)
function BrandMark({ size = 32 }) {
  return (
    <img
      src="/brand/logo-mark.svg"
      width={size}
      height={size}
      alt=""
      class="shrink-0 rounded-lg shadow-lg shadow-blue-900/40"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

function NavLink({ href, label, icon: Icon, page, iconSize = 18, currentUrl, onClick }) {
  const active = isActive(href, currentUrl);
  const preload = page ? () => page.preload().catch(() => {}) : undefined;
  return (
    <a
      href={href}
      class={`group relative flex items-center gap-3 px-3 h-10 rounded-[10px] text-sm transition-colors ${
        active
          ? 'bg-violet-500/12 text-white font-semibold'
          : 'text-[var(--color-muted)] font-medium hover:bg-white/5 hover:text-[var(--color-text)]'
      }`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onMouseEnter={preload}
      onFocus={preload}
    >
      {active && <span class="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full brand-gradient" aria-hidden="true" />}
      <Icon size={iconSize} class={active ? 'text-white' : 'opacity-55 group-hover:opacity-90'} />
      <span class="truncate">{label}</span>
    </a>
  );
}

// The channel preview in PlaylistView loads /watch/<id>?preview=true in an
// iframe. Render only the player there: no sidebar, no router (so the iframe
// never adds entries to the browser history), no PiP restore.
function getPreviewId() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') !== 'true') return null;
  const match = window.location.pathname.match(/^\/watch\/(.+)$/);
  return match ? match[1] : null;
}

export function App() {
  const previewId = getPreviewId();
  if (previewId) {
    return (
      <div class="w-screen h-screen bg-black text-white">
        <Player id={decodeURIComponent(previewId)} preview />
      </div>
    );
  }
  return <AppShell />;
}

// Main app component with sidebar and routing
function AppShell() {
  const [playlists, setPlaylists] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(typeof window !== 'undefined' ? window.location.pathname : '/');
  
  // Take over scroll restoration and track in-app history (used by the
  // player's Back button and by list pages to restore their state)
  if (typeof window !== 'undefined') {
    initHistoryListener();
  }
  
  // Load playlists for the sidebar (again after each navigation, so playlists
  // added or removed in Settings show up without a page reload)
  const loadPlaylists = async () => {
    try {
      const savedPlaylists = await getPlaylists();
      setPlaylists(savedPlaylists || []);
    } catch (err) {
      console.error('Failed to load playlists for sidebar:', err);
    }
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  // Escape closes the mobile menu
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);
  
  // Enhanced route change handler to preserve PiP state
  const handleRouteChange = (event) => {
    trackRouteChange();
    setSidebarOpen(false);
    setCurrentUrl(event.url);
    updateDocumentTitle(event.url);
    loadPlaylists();
  };

  // Sidebar links: preact-router handles the navigation, just close the drawer
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <PictureInPictureProvider>
      <PipAwareAppLayout>
        <div class="min-h-screen flex text-white">
          {/* Sidebar */}
          <div 
            class={`fixed md:sticky md:top-0 md:h-screen inset-y-0 left-0 z-30 w-60 bg-[var(--color-surface)]/95 backdrop-blur-xl border-r border-[var(--color-hairline)] transform ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
            } transition-transform duration-200 ease-in-out flex flex-col`}
          >
            {/* Sidebar header */}
            <div class="px-4 h-16 flex items-center">
              <a href="/" class="flex items-center gap-3" onClick={closeSidebar}>
                <BrandMark size={34} />
                <span class="leading-tight">
                  <span class="block font-display text-[17px] font-bold tracking-tight">IPTV Streamer</span>
                  <span class="block text-[11px] text-gray-500">Live TV, worldwide</span>
                </span>
              </a>
            </div>
            
            {/* Sidebar navigation */}
            <nav class="flex-1 flex flex-col py-2 overflow-y-auto" aria-label="Main">
              <div class="px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Watch</div>
              <ul class="space-y-1 px-3">
                {MAIN_LINKS.map(link => (
                  <li key={link.href}>
                    <NavLink {...link} currentUrl={currentUrl} onClick={closeSidebar} />
                  </li>
                ))}
              </ul>

              {playlists.length > 0 && (
                <div class="mt-6">
                  <div class="px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Your playlists</div>
                  <ul class="space-y-1 px-3">
                    {playlists.map(playlist => (
                      <li key={playlist.id}>
                        <NavLink
                          href={`/playlist/${encodeURIComponent(playlist.id)}`}
                          label={playlist.name}
                          icon={List}
                          iconSize={16}
                          page={PlaylistView}
                          currentUrl={currentUrl}
                          onClick={closeSidebar}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ul class="mt-auto pt-6 space-y-1 px-3 pb-2">
                {SYSTEM_LINKS.map(link => (
                  <li key={link.href}>
                    <NavLink {...link} currentUrl={currentUrl} onClick={closeSidebar} />
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          
          {/* Sidebar overlay */}
          {sidebarOpen && (
            <div 
              class="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden"
              onClick={() => setSidebarOpen(false)}
            ></div>
          )}
          
          {/* Main content */}
          <div class="flex-1 flex flex-col min-w-0">
            {/* Top bar (mobile only: the sidebar is always visible on larger screens) */}
            <header class="md:hidden sticky top-0 z-10 bg-gray-950/80 backdrop-blur-xl border-b border-white/5 h-14 flex items-center px-4 gap-3">
              <a href="/" class="flex items-center gap-2 font-display font-bold tracking-tight">
                <BrandMark size={26} />
                IPTV Streamer
              </a>
            </header>
            
            {/* Content area */}
            <main class="flex-1 p-4 pb-28 md:p-8 overflow-auto">
              <Router onChange={handleRouteChange}>
                <Home path="/" />
                <Player path="/watch/:id" />
                <SettingsPage path="/settings" />
                <Favorites path="/favorites" />
                <WatchHistory path="/history" />
                <CountryBrowser path="/countries" />
                <PlaylistView path="/playlist/:id" />
                <CategoryView path="/category/:id" />
                <About path="/about" />
              </Router>
            </main>
          </div>

          {/* Bottom tab bar (mobile) */}
          <nav class="md:hidden fixed bottom-0 inset-x-0 z-20 h-[76px] pb-[env(safe-area-inset-bottom)] bg-[var(--color-surface)]/90 backdrop-blur-xl border-t border-[var(--color-hairline)] grid grid-cols-5" aria-label="Tabs">
            {TAB_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, currentUrl);
              return (
                <a key={href} href={href} aria-current={active ? 'page' : undefined}
                  class={`relative flex flex-col items-center justify-center gap-1 text-[11px] ${active ? 'text-white font-semibold' : 'text-[var(--color-subtle)]'}`}>
                  {active && <span class="absolute top-0 h-[3px] w-8 rounded-b-full brand-gradient" aria-hidden="true" />}
                  <Icon size={22} class={active ? '' : 'opacity-60'} />
                  {label}
                </a>
              );
            })}
            <button type="button" onClick={() => setSidebarOpen(true)} aria-expanded={sidebarOpen}
              class="flex flex-col items-center justify-center gap-1 text-[11px] text-[var(--color-subtle)]">
              <MoreHorizontal size={22} class="opacity-60" />
              More
            </button>
          </nav>
        </div>
        
        <PictureInPictureOverlay />
      </PipAwareAppLayout>
    </PictureInPictureProvider>
  );
}

// Also add a default export for backward compatibility
export default App;