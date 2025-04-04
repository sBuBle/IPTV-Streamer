import { h } from 'preact';
import { Router, route } from 'preact-router';
import { useState, useEffect } from 'preact/hooks';
import { Tv2, Settings as SettingsIcon, Home as HomeIcon, Heart, History, Globe, List, Info } from 'lucide-preact';
import { get } from './utils/idbStorage';
import { getPlaylists } from './utils/playlist';
import { PictureInPictureProvider } from './contexts/PictureInPictureContext';
import { PictureInPictureOverlay } from './components/PictureInPictureOverlay';
import { PipAwareAppLayout } from './components/PipAwareAppLayout';
import { initHistoryListener } from './utils/historyManager';

import Home from './pages/Home';
import Player from './pages/Player';
import SettingsPage from './pages/Settings';
import Favorites from './pages/Favorites';
import WatchHistory from './pages/WatchHistory';
import CountryBrowser from './pages/CountryBrowser';
import PlaylistView from './pages/PlaylistView';
import CategoryView from './pages/CategoryView';
import About from './pages/About';

// Main app component with sidebar and routing
export function App() {
  const [playlists, setPlaylists] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(typeof window !== 'undefined' ? window.location.pathname : '/');
  
  // Initialize history listener for scroll restoration on navigation
  useEffect(() => {
    initHistoryListener();
  }, []);
  
  // Load playlists for the sidebar
  useEffect(() => {
    async function loadPlaylists() {
      try {
        const savedPlaylists = await getPlaylists();
        setPlaylists(savedPlaylists);
      } catch (err) {
        console.error('Failed to load playlists for sidebar:', err);
      }
    }
    
    loadPlaylists();
  }, []);
  
  // Enhanced route change handler to preserve PiP state
  const handleRouteChange = (event) => {
    setSidebarOpen(false);
    setCurrentUrl(event.url);
    
    // We don't need to do anything special with PiP here
    // since we're using sessionStorage for persistence
  };

  return (
    <PictureInPictureProvider>
      <PipAwareAppLayout>
        <div class="min-h-screen flex bg-gray-900 text-white">
          {/* Sidebar */}
          <div 
            class={`fixed md:static inset-y-0 left-0 z-30 w-64 bg-gray-800 transform ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
            } transition-transform duration-200 ease-in-out flex flex-col`}
          >
            {/* Sidebar header */}
            <div class="p-4 border-b border-gray-700">
              <div class="flex items-center gap-2">
                <Tv2 class="text-blue-500" size={24} />
                <span class="text-xl font-bold">IPTV Streamer</span>
              </div>
            </div>
            
            {/* Sidebar navigation */}
            <nav class="flex-1 py-4 overflow-y-auto">
              <ul class="space-y-1 px-2">
                {/* Main navigation items */}
                <li>
                  <a 
                    href="/" 
                    class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    onClick={handleRouteChange}
                  >
                    <HomeIcon size={18} />
                    <span>Home</span>
                  </a>
                </li>
                
                <li>
                  <a 
                    href="/favorites" 
                    class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    onClick={handleRouteChange}
                  >
                    <Heart size={18} />
                    <span>Favorites</span>
                  </a>
                </li>
                
                <li>
                  <a 
                    href="/history" 
                    class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    onClick={handleRouteChange}
                  >
                    <History size={18} />
                    <span>Watch History</span>
                  </a>
                </li>
                
                <li>
                  <a 
                    href="/countries" 
                    class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    onClick={handleRouteChange}
                  >
                    <Globe size={18} />
                    <span>Browse by Country</span>
                  </a>
                </li>
                
                {/* Playlists section */}
                {playlists.length > 0 && (
                  <li class="mt-4">
                    <div class="px-3 py-1 text-xs text-gray-400">Your Playlists</div>
                    <ul class="mt-1 space-y-1">
                      {playlists.map(playlist => (
                        <li key={playlist.id}>
                          <a 
                            href={`/playlist/${playlist.id}`}
                            class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                            onClick={handleRouteChange}
                          >
                            <List size={16} />
                            <span class="truncate">{playlist.name}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
                
                {/* System section */}
                <li class="mt-4">
                  <div class="px-3 py-1 text-xs text-gray-400">System</div>
                  <ul class="mt-1 space-y-1">
                    <li>
                      <a 
                        href="/settings" 
                        class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                        onClick={handleRouteChange}
                      >
                        <SettingsIcon size={18} />
                        <span>Settings</span>
                      </a>
                    </li>
                    <li>
                      <a 
                        href="/about" 
                        class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                        onClick={handleRouteChange}
                      >
                        <Info size={18} />
                        <span>About</span>
                      </a>
                    </li>
                  </ul>
                </li>
              </ul>
            </nav>
          </div>
          
          {/* Sidebar overlay */}
          {sidebarOpen && (
            <div 
              class="fixed inset-0 bg-black/50 z-20 md:hidden"
              onClick={() => setSidebarOpen(false)}
            ></div>
          )}
          
          {/* Main content */}
          <div class="flex-1 flex flex-col">
            {/* Top bar */}
            <header class="bg-gray-800 h-16 flex items-center px-4 md:px-6">
              <button 
                class="md:hidden mr-4"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <List size={24} />
              </button>
              
              {/* You can add a search bar or other top bar content here */}
            </header>
            
            {/* Content area */}
            <main class="flex-1 p-4 md:p-6 overflow-auto">
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
        </div>
        
        <PictureInPictureOverlay />
      </PipAwareAppLayout>
    </PictureInPictureProvider>
  );
}

// Also add a default export for backward compatibility
export default App;