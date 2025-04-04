import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { get, set } from '../utils/idbStorage'; // Use consistent storage utilities
import { getFavorites, removeFavorite } from '../utils/favorites'; // Import favorites utilities
import { Heart, Search, Trash2, PlayCircle, Grid, List as ListIcon, AlertCircle } from 'lucide-preact';
import { getChannelColor, getChannelInitials, getChannelLogo } from '../utils/logoService';
import * as apiClient from '../utils/apiClient';

export default function Favorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [groups, setGroups] = useState([]);
  const [sortBy, setSortBy] = useState('name'); // 'name', 'group', 'date'
  const [isGridView, setIsGridView] = useState(true);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  useEffect(() => {
    loadFavorites();
  }, []);

  async function loadFavorites() {
    setLoading(true);
    try {
      // Use the favorites utility for consistency
      const favs = await getFavorites();
      setFavorites(favs);
      updateGroups(favs);
    } catch (err) {
      console.error('Failed to load favorites:', err);
      setFavorites([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }

  function updateGroups(favorites) {
    try {
      // Make sure favorites is an array before processing
      const favsArray = Array.isArray(favorites) ? favorites : [];
      const uniqueGroups = [...new Set(favsArray.map(item => item?.group || ''))]
        .filter(Boolean)
        .sort();
      console.log('Updated groups:', uniqueGroups);
      setGroups(uniqueGroups);
    } catch (error) {
      console.error('Error updating groups:', error);
      setGroups([]);
    }
  }

  async function handleRemoveFavorite(id, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (!id) {
      console.error('Cannot remove favorite: Missing channel ID');
      return;
    }

    try {
      console.log('Removing favorite with ID:', id);
      
      // Use the favorites utility for removal
      const success = await removeFavorite(id);
      
      if (success) {
        // Update local state only if storage was updated successfully
        const updatedFavorites = favorites.filter(fav => fav.id !== id);
        setFavorites(updatedFavorites);
        updateGroups(updatedFavorites);
        console.log('Favorite removed successfully');
      } else {
        console.warn('Failed to remove favorite, ID not found or storage error');
      }
    } catch (err) {
      console.error('Failed to remove favorite:', err);
      alert('Failed to remove from favorites. Please try again.');
    }
  }

  async function clearAllFavorites() {
    try {
      console.log('Clearing all favorites');
      // Use consistent storage pattern
      await set('favorites', []);
      setFavorites([]);
      setGroups([]);
      setShowConfirmClear(false);
      console.log('All favorites cleared successfully');
    } catch (err) {
      console.error('Failed to clear favorites:', err);
      alert('Failed to clear favorites. Please try again.');
    }
  }

  // Try to get channel logo
  const getChannelLogoUrl = (channel) => {
    if (channel.logo) return channel.logo;
    return apiClient.getLogoUrl(channel.channelId || channel.name);
  };

  // Filter favorites based on search query and group filter
  const filteredFavorites = favorites.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGroup = filterGroup ? item.group === filterGroup : true;
    return matchesSearch && matchesGroup;
  });

  // Sort favorites based on selected sort option
  const sortedFavorites = [...filteredFavorites].sort((a, b) => {
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    } else if (sortBy === 'group') {
      return (a.group || 'Uncategorized').localeCompare(b.group || 'Uncategorized');
    } else if (sortBy === 'date') {
      // Assuming each favorite has a dateAdded property
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    }
    return 0;
  });

  return (
    <div>
      <div class="mb-8">
        <h2 class="text-3xl font-bold flex items-center gap-3 mb-2">
          <Heart class="text-red-500" />
          <span>My Favorites</span>
        </h2>
        <p class="text-gray-400">
          Your favorite channels for quick access
        </p>
      </div>
      
      {/* Filters and Search */}
      <div class="mb-6 bg-gray-800 p-4 rounded-lg">
        <div class="flex flex-col md:flex-row gap-4">
          <div class="relative flex-1">
            <input
              type="text"
              placeholder="Search favorites..."
              class="w-full px-4 py-2 pl-10 bg-gray-700 rounded-lg border border-gray-600"
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.target.value)}
            />
            <Search class="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          </div>
          
          <div class="flex flex-wrap gap-2">
            <select
              class="px-4 py-2 bg-gray-700 rounded-lg border border-gray-600 appearance-none pr-10"
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
            >
              <option value="">All Groups</option>
              {groups.map(group => (
                <option key={group} value={group}>{group || 'Uncategorized'}</option>
              ))}
            </select>
            
            <select
              class="px-4 py-2 bg-gray-700 rounded-lg border border-gray-600 appearance-none pr-10"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="name">Sort by Name</option>
              <option value="group">Sort by Group</option>
              <option value="date">Sort by Date Added</option>
            </select>
            
            <button
              onClick={() => setIsGridView(!isGridView)}
              class="px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 flex items-center justify-center"
              title={isGridView ? 'Switch to list view' : 'Switch to grid view'}
            >
              {isGridView ? <ListIcon class="w-5 h-5" /> : <Grid class="w-5 h-5" />}
            </button>
          </div>
        </div>
        
        {favorites.length > 0 && (
          <div class="mt-4 flex justify-end">
            <button
              onClick={() => setShowConfirmClear(true)}
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <Trash2 class="w-5 h-5" />
              Clear All Favorites
            </button>
          </div>
        )}
      </div>
      
      {/* Confirmation Dialog */}
      {showConfirmClear && (
        <div class="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
          <div class="bg-gray-800 p-6 rounded-lg max-w-md w-full">
            <h3 class="text-xl font-bold mb-3">Clear All Favorites?</h3>
            <p class="mb-6 text-gray-300">
              This will remove all your favorite channels. This action cannot be undone.
            </p>
            <div class="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmClear(false)}
                class="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={clearAllFavorites}
                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Clear All Favorites
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Content */}
      {loading ? (
        <div class="flex items-center justify-center py-16">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : favorites.length === 0 ? (
        <div class="text-center py-12 bg-gray-800 rounded-lg">
          <Heart class="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <h3 class="text-xl font-medium mb-2">No favorites yet</h3>
          <p class="text-gray-400 mb-6">
            Add favorites by clicking the heart icon while watching channels.
          </p>
          <a
            href="/countries"
            class="px-6 py-2 bg-blue-600 text-white rounded-lg inline-flex items-center gap-2 hover:bg-blue-700 transition-colors"
          >
            <PlayCircle class="w-5 h-5" />
            Browse Channels
          </a>
        </div>
      ) : filteredFavorites.length === 0 ? (
        <div class="bg-gray-800 rounded-lg p-6 flex items-center gap-4">
          <AlertCircle class="w-8 h-8 text-yellow-500" />
          <div>
            <h3 class="font-medium mb-1">No matching favorites</h3>
            <p class="text-sm text-gray-400">Try adjusting your search or filters</p>
          </div>
        </div>
      ) : (
        <div>
          {isGridView ? (
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {sortedFavorites.map(channel => {
                const logoUrl = getChannelLogoUrl(channel);
                
                return (
                  <div key={channel.id} class="relative group">
                    <a
                      href={`/watch/${encodeURIComponent(channel.id)}`}
                      class="block bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition-colors"
                    >
                      <div class="p-4">
                        <div class="flex items-center gap-3 mb-3">
                          {logoUrl ? (
                            <img 
                              src={logoUrl}
                              alt={channel.name} 
                              class="w-12 h-12 rounded flex-shrink-0 object-cover bg-gray-900"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.style.display = 'none';
                                e.target.parentNode.innerHTML = `
                                  <div 
                                    class="w-12 h-12 rounded flex-shrink-0 flex items-center justify-center"
                                    style="background-color: ${getChannelColor(channel.name)}"
                                  >
                                    <div class="text-white text-sm font-bold">
                                      ${getChannelInitials(channel.name)}
                                    </div>
                                  </div>
                                `;
                              }}
                            />
                          ) : (
                            <div 
                              class="w-12 h-12 rounded flex-shrink-0 flex items-center justify-center"
                              style={{ backgroundColor: getChannelColor(channel.name) }}
                            >
                              <div class="text-white text-sm font-bold">
                                {getChannelInitials(channel.name)}
                              </div>
                            </div>
                          )}
                          <div class="flex-1 min-w-0">
                            <h3 class="font-medium truncate">{channel.name}</h3>
                            <p class="text-xs text-gray-400 truncate">{channel.group || 'Uncategorized'}</p>
                          </div>
                        </div>
                        
                        {channel.languages && (
                          <div class="flex flex-wrap gap-1 mt-2">
                            {Array.isArray(channel.languages) ? 
                              channel.languages.slice(0, 2).map(lang => (
                                <span key={lang} class="text-xs bg-gray-700 px-2 py-0.5 rounded-full text-gray-300">
                                  {lang}
                                </span>
                              ))
                              : 
                              <span class="text-xs bg-gray-700 px-2 py-0.5 rounded-full text-gray-300">
                                {channel.languages}
                              </span>
                            }
                          </div>
                        )}
                        
                        {channel.categories && Array.isArray(channel.categories) && channel.categories.length > 0 && (
                          <div class="flex flex-wrap gap-1 mt-2">
                            {channel.categories.slice(0, 1).map(category => (
                              <span key={category} class="text-xs bg-blue-900/40 px-2 py-0.5 rounded-full text-blue-300">
                                {category}
                              </span>
                            ))}
                            {channel.categories.length > 1 && (
                              <span class="text-xs bg-blue-900/40 px-2 py-0.5 rounded-full text-blue-300">
                                +{channel.categories.length - 1} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </a>
                    
                    <button
                      onClick={(e) => handleRemoveFavorite(channel.id, e)}
                      class="absolute top-2 right-2 p-2 rounded-full bg-gray-900/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                      title="Remove from favorites"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div class="bg-gray-800 rounded-lg overflow-hidden">
              <div class="divide-y divide-gray-700">
                {sortedFavorites.map(channel => {
                  const logoUrl = getChannelLogoUrl(channel);
                  
                  return (
                    <div key={channel.id} class="relative group">
                      <a
                        href={`/watch/${encodeURIComponent(channel.id)}`}
                        class="flex items-center p-4 hover:bg-gray-700 transition-colors"
                      >
                        {logoUrl ? (
                          <img 
                            src={logoUrl}
                            alt={channel.name} 
                            class="w-12 h-12 rounded-md flex-shrink-0 object-cover bg-gray-900 mr-3"
                            data-channel={channel.id}
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.style.display = 'none';
                              e.target.parentNode.innerHTML = `
                                <div 
                                  class="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center mr-3"
                                  style="background-color: ${getChannelColor(channel.name)}"
                                >
                                  <div class="text-white text-lg font-bold">
                                    ${getChannelInitials(channel.name)}
                                  </div>
                                </div>
                              `;
                            }}
                          />
                        ) : (
                          <div 
                            class="w-12 h-12 rounded-md flex-shrink-0 flex items-center justify-center mr-3"
                            style={{ backgroundColor: getChannelColor(channel.name) }}
                          >
                            <div class="text-white text-lg font-bold">
                              {getChannelInitials(channel.name)}
                            </div>
                          </div>
                        )}
                        
                        <div class="flex-1">
                          <h3 class="font-medium">{channel.name}</h3>
                          <div class="flex items-center gap-3 text-sm text-gray-400 mt-1">
                            {channel.group && (
                              <span>{channel.group}</span>
                            )}
                            
                            {channel.languages && Array.isArray(channel.languages) && channel.languages.length > 0 && (
                              <span class="text-gray-500">
                                {channel.languages.slice(0, 2).join(', ')}
                                {channel.languages.length > 2 && ' + more'}
                              </span>
                            )}
                          </div>
                          
                          {channel.categories && Array.isArray(channel.categories) && channel.categories.length > 0 && (
                            <div class="flex flex-wrap gap-1 mt-1.5">
                              {channel.categories.slice(0, 2).map(category => (
                                <span key={category} class="text-xs bg-gray-700 px-1.5 py-0.5 rounded-full text-gray-300">
                                  {category}
                                </span>
                              ))}
                              {channel.categories.length > 2 && (
                                <span class="text-xs bg-gray-700 px-1.5 py-0.5 rounded-full text-gray-300">
                                  +{channel.categories.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <Heart class="w-5 h-5 text-red-500 fill-current flex-shrink-0 mr-2" />
                      </a>
                      
                      <button
                        onClick={(e) => handleRemoveFavorite(channel.id, e)}
                        class="absolute right-4 top-1/2 transform -translate-y-1/2 p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all"
                        title="Remove from favorites"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}