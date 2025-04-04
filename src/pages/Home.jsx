import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { get } from '../utils/idbStorage';
import { Tv2, Clock, Heart, List, Globe, Film, Music, Trophy } from 'lucide-preact';
import { getPlaylists } from '../utils/playlist';
import { getChannelColor, getChannelInitials } from '../utils/logoService';
import * as apiClient from '../utils/apiClient';
import { Link } from 'preact-router';
import { History, Settings as SettingsIcon } from 'lucide-preact';

export default function Home() {
  const [playlists, setPlaylists] = useState([]);
  const [recentlyWatched, setRecentlyWatched] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalChannels: 0,
    totalPlaylists: 0,
    countriesCount: 0,
    categoriesCount: 0
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Load playlists
        const savedPlaylists = await getPlaylists();
        setPlaylists(savedPlaylists);
        
        // Load recently watched channels
        const history = await get('watchHistory') || [];
        
        // Filter out any entries that don't have a valid channel object
        const validHistory = history.filter(item => item && item.channel && item.channel.id);
        setRecentlyWatched(validHistory.slice(0, 10)); // Show top 10 recently watched
        
        // Load favorites
        const favs = await get('favorites') || [];
        
        // Filter out any invalid favorites
        const validFavs = favs.filter(item => item && item.id);
        setFavorites(validFavs.slice(0, 10)); // Show top 10 favorites
        
        // Calculate stats
        const uniqueChannels = new Set([
          ...validHistory.filter(item => item.channel).map(item => item.channel.id),
          ...validFavs.map(item => item.id)
        ]);
        
        // Get country and category counts from localStorage if available
        const countriesCount = localStorage.getItem('countriesCount') || 0;
        const categoriesCount = localStorage.getItem('categoriesCount') || 0;
        
        setStats({
          totalChannels: uniqueChannels.size,
          totalPlaylists: savedPlaylists.length,
          countriesCount: parseInt(countriesCount, 10),
          categoriesCount: parseInt(categoriesCount, 10)
        });
      } catch (error) {
        console.error('Failed to load home page data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  // Featured categories - static list for quick access
  const featuredCategories = [
    { id: 'news', name: 'News', icon: <Globe className="w-6 h-6" /> },
    { id: 'sports', name: 'Sports', icon: <Trophy className="w-6 h-6" /> },
    { id: 'movies', name: 'Movies', icon: <Film className="w-6 h-6" /> },
    { id: 'music', name: 'Music', icon: <Music className="w-6 h-6" /> },
  ];

  // Recently Watched section rendering
  const renderChannelItem = (item, showTimestamp = false) => {
    if (!item || !item.id) {
      console.warn('Invalid channel item:', item);
      return null; // Skip rendering invalid items
    }
    
    // Try to get logo from API client if available
    const logoUrl = item.logo || (item.name && apiClient.getLogoUrl(item.name));
    
    return (
      <a
        key={item.id}
        href={`/watch/${encodeURIComponent(item.id)}`}
        className="bg-gray-800 p-4 rounded-lg flex items-center gap-3 hover:bg-gray-700 transition-colors"
      >
        {logoUrl ? (
          <img 
            src={logoUrl}
            alt={item.name || 'Channel logo'}
            className="w-12 h-12 rounded-md flex-shrink-0 object-cover bg-gray-900"
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              e.target.style.display = 'none';
              e.target.parentNode.innerHTML = 
                `<div class="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center" style="background-color: ${getChannelColor(item.name)}">
                  <div class="text-white text-sm font-bold">${getChannelInitials(item.name)}</div>
                </div>`;
            }}
          />
        ) : (
          <div 
            className="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: getChannelColor(item.name) }}
          >
            <div className="text-white text-sm font-bold">
              {getChannelInitials(item.name)}
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">
            {item.name || 'Unnamed Channel'}
          </h3>
          <p className="text-xs text-gray-400 truncate">{item.group || 'Uncategorized'}</p>
          {showTimestamp && item.timestamp && (
            <p className="text-xs text-gray-500 mt-1">
              {new Date(item.timestamp).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short'
              })}
            </p>
          )}
        </div>
      </a>
    );
  };

  return (
    <div>
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Welcome to IPTV Streamer</h1>
        <p className="text-gray-400">
          Your personal streaming hub for managing and watching IPTV channels
        </p>
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-lg flex items-center gap-4">
          <div className="bg-blue-900/50 p-3 rounded-lg">
            <Tv2 className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.totalChannels}</div>
            <div className="text-xs text-gray-400">Channels</div>
          </div>
        </div>
        
        <div className="bg-gray-800 p-4 rounded-lg flex items-center gap-4">
          <div className="bg-purple-900/50 p-3 rounded-lg">
            <List className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.totalPlaylists}</div>
            <div className="text-xs text-gray-400">Playlists</div>
          </div>
        </div>
        
        <div className="bg-gray-800 p-4 rounded-lg flex items-center gap-4">
          <div className="bg-green-900/50 p-3 rounded-lg">
            <Globe className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.countriesCount}</div>
            <div className="text-xs text-gray-400">Countries</div>
          </div>
        </div>
        
        <div className="bg-gray-800 p-4 rounded-lg flex items-center gap-4">
          <div className="bg-orange-900/50 p-3 rounded-lg">
            <Film className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.categoriesCount}</div>
            <div className="text-xs text-gray-400">Categories</div>
          </div>
        </div>
      </div>
      
      {/* Quick Access Buttons */}
      <div className="flex flex-wrap gap-4 mb-8">
        <a
          href="/countries"
          className="bg-blue-600 hover:bg-blue-700 text-white py-3 px-5 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Globe className="w-5 h-5" />
          Browse All Channels
        </a>
        
        <a
          href="/settings"
          className="bg-gray-700 hover:bg-gray-600 text-white py-3 px-5 rounded-lg flex items-center gap-2 transition-colors"
        >
          <List className="w-5 h-5" />
          Manage Playlists
        </a>
      </div>
      
      {/* Featured Categories */}
      <div className="mb-10">
        <h2 className="text-xl font-bold mb-4">Featured Categories</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {featuredCategories.map(category => (
            <a
              key={category.id}
              href={`/category/${category.id}`}
              className="bg-gray-800 p-6 rounded-lg text-center hover:bg-gray-700 transition-colors"
            >
              <div className="flex justify-center mb-2">
                {category.icon}
              </div>
              <div className="font-medium">{category.name}</div>
            </a>
          ))}
        </div>
      </div>
      
      {/* Recently Watched */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Recently Watched</h2>
          <a href="/history" className="text-blue-400 hover:underline flex items-center gap-1">
            <Clock className="w-4 h-4" />
            View All
          </a>
        </div>
        
        {loading ? (
          <div className="bg-gray-800 p-6 rounded-lg text-center text-gray-400">
            <p>Loading recently watched channels...</p>
          </div>
        ) : recentlyWatched.length === 0 ? (
          <div className="bg-gray-800 p-6 rounded-lg text-center text-gray-400">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No recently watched channels</p>
            <a href="/countries" className="text-blue-400 hover:underline text-sm">
              Browse channels to get started
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentlyWatched.slice(0, 6).map((item, index) => 
              item && item.channel ? renderChannelItem(item.channel, true) : (
                <div key={`error-${index}`} className="bg-gray-800 p-4 rounded-lg text-red-400">
                  Invalid channel data
                </div>
              )
            )}
          </div>
        )}
      </div>
      
      {/* Favorites */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Favorites</h2>
          <a href="/favorites" className="text-blue-400 hover:underline flex items-center gap-1">
            <Heart className="w-4 h-4" />
            View All
          </a>
        </div>
        
        {loading ? (
          <div className="bg-gray-800 p-6 rounded-lg text-center text-gray-400">
            <p>Loading favorite channels...</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="bg-gray-800 p-6 rounded-lg text-center text-gray-400">
            <Heart className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No favorite channels yet</p>
            <p className="text-sm mt-1">
              Add favorites by clicking the heart icon while watching a channel
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {favorites.slice(0, 6).map((channel, index) => 
              channel ? renderChannelItem(channel) : (
                <div key={`error-${index}`} className="bg-gray-800 p-4 rounded-lg text-red-400">
                  Invalid channel data
                </div>
              )
            )}
          </div>
        )}
      </div>
      
      {/* Your Playlists */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Your Playlists</h2>
          <a href="/settings" className="text-blue-400 hover:underline flex items-center gap-1">
            <List className="w-4 h-4" />
            Manage
          </a>
        </div>
        
        {playlists.length === 0 ? (
          <div className="bg-gray-800 p-6 rounded-lg text-center text-gray-400">
            <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No playlists added yet</p>
            <a href="/settings" className="text-blue-400 hover:underline text-sm">
              Add your first playlist
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {playlists.map(playlist => (
              <div
                key={playlist.id}
                className="bg-gray-800 p-4 rounded-lg"
              >
                <h3 className="font-medium">{playlist.name}</h3>
                <p className="text-sm text-gray-400 truncate mt-1">{playlist.url}</p>
                <div className="flex justify-between items-center mt-3">
                  <span className="text-xs text-gray-500">
                    Added {new Date(playlist.addedAt).toLocaleDateString()}
                  </span>
                  <a 
                    href={`/playlist/${playlist.id}`}
                    className="text-sm text-blue-400 hover:underline"
                  >
                    View channels
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}