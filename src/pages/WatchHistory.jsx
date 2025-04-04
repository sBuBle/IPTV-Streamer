import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router'; 
import { get, set } from '../utils/idbStorage'; 
import { toggleFavorite as toggleFavoriteUtil } from '../utils/favorites'; // Add favorites utility import
import { History, Search, Trash2, PlayCircle, Calendar, Clock, Heart, AlertCircle, Filter, Grid, List as ListIcon } from 'lucide-preact';
import { getChannelColor, getChannelInitials } from '../utils/logoService';
import * as apiClient from '../utils/apiClient';

export default function WatchHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [isGridView, setIsGridView] = useState(true); 

  useEffect(() => {
    loadHistory();
    loadFavorites();
  }, []);

  async function loadHistory() {
    setLoading(true);
    try {
      const watchHistory = await get('watchHistory') || [];

      const validHistory = watchHistory.filter(item => {
        if (!item || !item.channel || !item.channel.id || !item.timestamp) {
          console.warn('Invalid history item detected and removed:', item);
          return false;
        }
        return true;
      });

      if (validHistory.length !== watchHistory.length) {
        await set('watchHistory', validHistory);
      }

      setHistory(validHistory);
    } catch (err) {
      console.error('Failed to load watch history:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFavorites() {
    try {
      const favs = await get('favorites') || [];
      setFavorites(favs.map(item => item.id));
    } catch (err) {
      console.error('Failed to load favorites:', err);
      setFavorites([]);
    }
  }

  async function clearHistory() {
    await set('watchHistory', []);
    setHistory([]);
    setShowConfirmClear(false);
  }

  async function removeSingleHistoryItem(timestamp, event) {
    event.stopPropagation();
    event.preventDefault();
    
    try {
      const updatedHistory = history.filter(item => item.timestamp !== timestamp);
      await set('watchHistory', updatedHistory);
      setHistory(updatedHistory);
    } catch (err) {
      console.error('Failed to remove history item:', err);
    }
  }

  async function toggleFavorite(channel, event) {
    event.stopPropagation();
    event.preventDefault();
    
    try {
      const newStatus = await toggleFavoriteUtil(channel);
      
      if (newStatus !== null) {
        setFavorites(prevFavs => {
          if (newStatus) {
            return [...prevFavs, channel.id];
          } else {
            return prevFavs.filter(id => id !== channel.id);
          }
        });
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      alert('An error occurred while updating your favorites. Please try again.');
    }
  }

  const getChannelLogo = (channel) => {
    if (channel.logo) return channel.logo;
    return apiClient.getLogoUrl(channel.channelId || channel.name);
  };

  const filteredHistory = history.filter(item => {
    try {
      if (!item || !item.channel || !item.channel.name) return false;
      
      return item.channel.name.toLowerCase().includes(searchQuery.toLowerCase());
    } catch (err) {
      console.error('Error filtering history item:', err);
      return false;
    }
  });

  const groupedHistory = filteredHistory.reduce((groups, item) => {
    const date = new Date(item.timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    let groupKey;
    
    if (date.toDateString() === today.toDateString()) {
      groupKey = 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      groupKey = 'Yesterday';
    } else if (date > new Date(today - 7 * 24 * 60 * 60 * 1000)) {
      groupKey = 'Earlier this week';
    } else if (date > new Date(today - 30 * 24 * 60 * 60 * 1000)) {
      groupKey = 'Earlier this month';
    } else {
      groupKey = 'Older';
    }
    
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    
    groups[groupKey].push(item);
    return groups;
  }, {});

  return (
    <div>
      <div class="mb-8">
        <h2 class="text-3xl font-bold flex items-center gap-3 mb-2">
          <History class="text-blue-500" />
          <span>Watch History</span>
        </h2>
        <p class="text-gray-400">
          Your recently watched channels
        </p>
      </div>
      
      <div class="mb-6 bg-gray-800 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="relative flex-1">
          <input
            type="text"
            placeholder="Search history..."
            class="w-full px-4 py-2 pl-10 bg-gray-700 rounded-lg border border-gray-600"
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
          <Search class="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
        </div>
        
        <div class="flex items-center gap-2">
          <button
            onClick={() => setShowConfirmClear(true)}
            class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            disabled={history.length === 0}
          >
            <Trash2 class="w-5 h-5" />
            Clear History
          </button>
          
          <button
            onClick={() => setIsGridView(!isGridView)}
            class="px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 flex items-center justify-center"
            title={isGridView ? 'Switch to list view' : 'Switch to grid view'}
          >
            {isGridView ? <ListIcon class="w-5 h-5" /> : <Grid class="w-5 h-5" />}
          </button>
        </div>
      </div>
      
      {showConfirmClear && (
        <div class="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
          <div class="bg-gray-800 p-6 rounded-lg max-w-md w-full">
            <h3 class="text-xl font-bold mb-3">Clear Watch History?</h3>
            <p class="mb-6 text-gray-300">
              This will remove all your watch history. This action cannot be undone.
            </p>
            <div class="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmClear(false)}
                class="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={clearHistory}
                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Clear All History
              </button>
            </div>
          </div>
        </div>
      )}
      
      {loading ? (
        <div class="flex items-center justify-center py-16">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : history.length === 0 ? (
        <div class="text-center py-12 bg-gray-800 rounded-lg">
          <History class="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <h3 class="text-xl font-medium mb-2">No watch history</h3>
          <p class="text-gray-400 mb-6">
            Start watching channels to build your history.
          </p>
          <a
            href="/countries"
            class="px-6 py-2 bg-blue-600 text-white rounded-lg inline-flex items-center gap-2 hover:bg-blue-700 transition-colors"
          >
            <PlayCircle class="w-5 h-5" />
            Browse Channels
          </a>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div class="bg-gray-800 rounded-lg p-6 flex items-center gap-4">
          <AlertCircle class="w-8 h-8 text-yellow-500" />
          <div>
            <h3 class="font-medium mb-1">No matching history</h3>
            <p class="text-sm text-gray-400">Try adjusting your search</p>
          </div>
        </div>
      ) : (
        <div class="space-y-6">
          {Object.entries(groupedHistory).map(([date, items]) => (
            <div key={date} class="bg-gray-800 rounded-lg overflow-hidden">
              <div class="bg-gray-700 px-4 py-2 flex items-center gap-2">
                <Calendar class="w-4 h-4 text-gray-400" />
                <h3 class="font-medium">{date}</h3>
              </div>
              
              {isGridView ? (
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-3">
                  {items.map(item => {
                    const isFavorite = favorites.includes(item.channel.id);
                    const watchDate = new Date(item.timestamp);
                    const logoUrl = getChannelLogo(item.channel);
                    
                    return (
                      <a
                        key={item.timestamp}
                        href={`/watch/${encodeURIComponent(item.channel.id)}`}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey || e.button !== 0) return; 
                          e.preventDefault();
                          route(`/watch/${encodeURIComponent(item.channel.id)}`);
                        }}
                        class="bg-gray-700 p-3 rounded-lg hover:bg-gray-600 transition-colors group"
                      >
                        <div class="flex gap-3">
                          {logoUrl ? (
                            <img 
                              src={logoUrl}
                              alt={item.channel.name} 
                              class="w-10 h-10 rounded flex-shrink-0 object-cover bg-gray-900"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.style.display = 'none';
                                e.target.parentNode.innerHTML = `
                                  <div 
                                    class="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center"
                                    style="background-color: ${getChannelColor(item.channel.name)}"
                                  >
                                    <div class="text-white text-sm font-bold">
                                      ${getChannelInitials(item.channel.name)}
                                    </div>
                                  </div>
                                `;
                              }}
                            />
                          ) : (
                            <div 
                              class="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center"
                              style={{ backgroundColor: getChannelColor(item.channel.name) }}
                            >
                              <div class="text-white text-sm font-bold">
                                {getChannelInitials(item.channel.name)}
                              </div>
                            </div>
                          )}
                          <div class="flex-1 min-w-0">
                            <h4 class="font-medium truncate">{item.channel.name}</h4>
                            <p class="text-xs text-gray-400 truncate">{item.channel.group || 'Uncategorized'}</p>
                            <div class="flex items-center gap-1 text-xs text-gray-500 mt-1">
                              <Clock class="w-3 h-3" />
                              {watchDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </div>
                          </div>
                        </div>
                        
                        <div class="mt-2 pt-2 border-t border-gray-600 flex justify-end gap-1">
                          <button
                            onClick={(e) => toggleFavorite(item.channel, e)}
                            class={`p-1.5 rounded-full ${isFavorite ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}
                            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                          >
                            <Heart class={isFavorite ? "w-4 h-4 fill-current" : "w-4 h-4"} />
                          </button>
                          
                          <button
                            onClick={(e) => removeSingleHistoryItem(item.timestamp, e)}
                            class="p-1.5 rounded-full text-gray-400 hover:text-red-500"
                            title="Remove from history"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </div>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <div class="divide-y divide-gray-700">
                  {items.map(item => {
                    const isFavorite = favorites.includes(item.channel.id);
                    const watchDate = new Date(item.timestamp);
                    const logoUrl = getChannelLogo(item.channel);
                    
                    return (
                      <a
                        key={item.timestamp}
                        href={`/watch/${encodeURIComponent(item.channel.id)}`}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey || e.button !== 0) return; 
                          e.preventDefault();
                          route(`/watch/${encodeURIComponent(item.channel.id)}`);
                        }}
                        class="flex items-center p-4 hover:bg-gray-700 transition-colors relative group"
                      >
                        {logoUrl ? (
                          <img 
                            src={logoUrl}
                            alt={item.channel.name} 
                            class="w-12 h-12 rounded-md flex-shrink-0 object-cover bg-gray-900 mr-3"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.style.display = 'none';
                              e.target.parentNode.innerHTML = `
                                <div 
                                  class="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center mr-3"
                                  style="background-color: ${getChannelColor(item.channel.name)}"
                                >
                                  <div class="text-white text-lg font-bold">
                                    ${getChannelInitials(item.channel.name)}
                                  </div>
                                </div>
                              `;
                            }}
                          />
                        ) : (
                          <div 
                            class="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center mr-3"
                            style={{ backgroundColor: getChannelColor(item.channel.name) }}
                          >
                            <div class="text-white text-lg font-bold">
                              {getChannelInitials(item.channel.name)}
                            </div>
                          </div>
                        )}
                        
                        <div class="flex-1">
                          <h4 class="font-medium">{item.channel.name}</h4>
                          <div class="flex items-center gap-3 text-sm text-gray-400 mt-1">
                            <span class="flex items-center gap-1">
                              <Clock class="w-3 h-3" />
                              {watchDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                            {item.channel.group && (
                              <span class="text-gray-500">{item.channel.group}</span>
                            )}
                          </div>
                        </div>
                        
                        <div class="flex items-center gap-2 ml-4">
                          <button
                            onClick={(e) => toggleFavorite(item.channel, e)}
                            class={`p-2 rounded-full transition-colors ${
                              isFavorite ? 'text-red-500' : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500'
                            }`}
                            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                          >
                            <Heart class={isFavorite ? "w-5 h-5 fill-current" : "w-5 h-5"} />
                          </button>
                          
                          <button
                            onClick={(e) => removeSingleHistoryItem(item.timestamp, e)}
                            class="p-2 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-colors"
                            title="Remove from history"
                          >
                            <Trash2 class="w-5 h-5" />
                          </button>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}