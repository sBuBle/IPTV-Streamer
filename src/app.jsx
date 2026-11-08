import { h } from 'preact';
import { Router } from 'preact-router';
import { useState, useEffect } from 'preact/hooks';
import { MoreHorizontal, Settings as SettingsIcon, Home as HomeIcon, Heart, History, Globe, List, Info, PanelLeftClose, PanelLeftOpen, ListVideo } from 'lucide-preact';
import { get } from './utils/idbStorage';
import { getSettings } from './utils/settings';
import { PictureInPictureProvider } from './contexts/PictureInPictureContext';
import { PipNavStatus, usePipVisible } from './components/PictureInPictureOverlay';
import { PipAwareAppLayout } from './components/PipAwareAppLayout';
import { initHistoryListener, handleRouteChange as trackRouteChange } from './utils/historyManager';

import { lazyPage } from './components/lazyPage';

// Pages are split into their own chunks and loaded on demand
const Home = lazyPage(() => import('./pages/Home'));
const Player = lazyPage(() => import('./pages/Player'));
const SettingsPage = lazyPage(() => import('./pages/Settings'));
const Playlists = lazyPage(() => import('./pages/Playlists'));
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
  { href: '/playlists', label: 'Playlists', icon: ListVideo, page: Playlists },
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
  '/playlists': 'Playlists',
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

function samePlaylistLinks(a, b) {
  return a.length === b.length && a.every((p, i) => p.id === b[i]?.id && p.name === b[i]?.name);
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

function NavLink({ href, label, icon: Icon, page, iconSize = 18, currentUrl, onClick, collapsed = false }) {
  const active = isActive(href, currentUrl);
  const preload = page ? () => page.preload().catch(() => {}) : undefined;
  return (
    <a
      href={href}
      title={collapsed ? label : undefined}
      class={`group relative flex items-center gap-3 px-3 h-10 rounded-[10px] text-sm transition-colors ${collapsed ? 'md:justify-center md:px-0' : ''} ${
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
      <Icon size={iconSize} class={`shrink-0 ${active ? 'text-white' : 'opacity-55 group-hover:opacity-90'}`} />
      <span class={`truncate ${collapsed ? 'md:sr-only' : ''}`}>{label}</span>
    </a>
  );
}

// Red dot on the mobile "More" tab while picture-in-picture is on (its card is in the menu)
function PipDot() {
  if (!usePipVisible()) return null;
  return <span class="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[var(--color-live)]" aria-label="Picture in picture is on" />;
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
  // Desktop: the sidebar can slide down to a slim icon rail (remembered)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(value => {
    const next = !value;
    try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0'); } catch { /* not critical */ }
    return next;
  });
  const [currentUrl, setCurrentUrl] = useState(typeof window !== 'undefined' ? window.location.pathname : '/');
  
  // Take over scroll restoration and track in-app history (used by the
  // player's Back button and by list pages to restore their state)
  if (typeof window !== 'undefined') {
    initHistoryListener();
  }
  
  // Load playlists for the sidebar (again after each navigation, so playlists
  // added or removed on the Playlists page show up without a page reload)
  const loadPlaylists = async () => {
    try {
      // Read the list straight from storage: importing utils/playlist here
      // would pull the M3U parser and the iptv-org client into the first load
      const savedPlaylists = (await get('playlists')) || [];
      // Only re-render the sidebar when the list actually changed
      setPlaylists(prev => samePlaylistLinks(prev, savedPlaylists) ? prev : savedPlaylists);
    } catch (err) {
      console.error('Failed to load playlists for sidebar:', err);
    }
  };

  useEffect(() => {
    loadPlaylists();
    // Playlists > "Update automatically": update old playlists in the background
    const days = Number(getSettings().autoRefreshDays) || 0;
    if (days > 0) {
      const timer = setTimeout(() => {
        import('./utils/playlist')
          .then(({ refreshStalePlaylists }) => refreshStalePlaylists(days))
          .then(count => { if (count > 0) loadPlaylists(); })
          .catch(() => {});
      }, 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
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
            class={`fixed md:sticky md:top-0 md:h-screen inset-y-0 left-0 z-30 w-60 ${collapsed ? 'md:w-[72px]' : 'md:w-60'} shrink-0 overflow-hidden bg-[var(--color-surface)]/95 backdrop-blur-xl border-r border-[var(--color-hairline)] transform ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
            } transition-[transform,width] duration-200 ease-in-out flex flex-col`}
          >
            {/* Sidebar header */}
            <div class={`px-4 h-16 flex items-center gap-2 ${collapsed ? 'md:px-0 md:justify-center' : ''}`}>
              <a href="/" class="flex items-center gap-3 min-w-0" onClick={closeSidebar} title="IPTV Streamer">
                <BrandMark size={34} />
                <span class={`leading-tight whitespace-nowrap ${collapsed ? 'md:hidden' : ''}`}>
                  <span class="block font-display text-[17px] font-bold tracking-tight">IPTV Streamer</span>
                  <span class="block text-[11px] text-gray-500">Live TV, worldwide</span>
                </span>
              </a>
              {!collapsed && (
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  class="hidden md:flex ml-auto w-8 h-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-subtle)] hover:text-white hover:bg-white/6 transition-colors"
                  title="Collapse menu"
                  aria-label="Collapse menu"
                  aria-expanded="true"
                >
                  <PanelLeftClose size={18} />
                </button>
              )}
            </div>
            {collapsed && (
              <div class="hidden md:flex justify-center pb-2">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  class="w-10 h-10 flex items-center justify-center rounded-[10px] text-[var(--color-subtle)] hover:text-white hover:bg-white/6 transition-colors"
                  title="Expand menu"
                  aria-label="Expand menu"
                  aria-expanded="false"
                >
                  <PanelLeftOpen size={18} />
                </button>
              </div>
            )}
            
            {/* Sidebar navigation */}
            <nav class="flex-1 flex flex-col py-2 overflow-y-auto" aria-label="Main">
              <div class={`px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-subtle)] ${collapsed ? 'md:hidden' : ''}`}>Watch</div>
              <ul class="space-y-1 px-3">
                {MAIN_LINKS.map(link => (
                  <li key={link.href}>
                    <NavLink {...link} currentUrl={currentUrl} onClick={closeSidebar} collapsed={collapsed} />
                  </li>
                ))}
              </ul>

              {playlists.length > 0 && (
                <div class={`mt-6 ${collapsed ? 'md:mt-4 md:pt-4 md:border-t md:border-[var(--color-hairline)] md:mx-3' : ''}`}>
                  <div class={`px-5 pb-2 ${collapsed ? 'md:hidden' : ''} text-[11px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]`}>Your playlists</div>
                  <ul class={`space-y-1 px-3 ${collapsed ? 'md:px-0' : ''}`}>
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
                          collapsed={collapsed}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div class="mt-auto pt-6">
                <PipNavStatus collapsed={collapsed} onNavigate={closeSidebar} />
              </div>
              <ul class="pt-3 space-y-1 px-3 pb-2">
                {SYSTEM_LINKS.map(link => (
                  <li key={link.href}>
                    <NavLink {...link} currentUrl={currentUrl} onClick={closeSidebar} collapsed={collapsed} />
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
                <Playlists path="/playlists" />
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
              <span class="relative">
                <MoreHorizontal size={22} class="opacity-60" />
                <PipDot />
              </span>
              More
            </button>
          </nav>
        </div>
        
      </PipAwareAppLayout>
    </PictureInPictureProvider>
  );
}

// Also add a default export for backward compatibility
export default App;