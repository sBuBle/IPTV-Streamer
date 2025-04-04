import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { get, set, keys } from 'idb-keyval'; // Add keys import
import { 
  ArrowLeft, Loader, Search, RefreshCw, List, Grid as GridIcon, 
  AlertCircle, PlusCircle, Settings as SettingsIcon,
  Globe, PlayCircle, Heart, BarChart2, Download, // Add new icons for features
  Star, Share2, ArrowDownUp, Filter, X, Clock, Info // Additional icons
} from 'lucide-preact';
import { route } from 'preact-router';
import { getChannelColor, getChannelInitials, formatLogoUrl } from '../utils/logoService';
import { fetchPlaylist, refreshPlaylist, getLogoFromStream, savePlaylist } from '../utils/playlist';
import * as apiClient from '../utils/apiClient';

export default function PlaylistView(props) {
  // Get id from props instead of wouter's useRoute
  const playlistId = props.id;
  
  const [playlist, setPlaylist] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGridView, setIsGridView] = useState(true);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [noPlaylistsFound, setNoPlaylistsFound] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [storageInfo, setStorageInfo] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [logs, setLogs] = useState([]);
  const debugRef = useRef(null);
  
  // New state variables for additional features
  const [favorites, setFavorites] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [categories, setCategories] = useState([]);
  const [sortOption, setSortOption] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [previewChannel, setPreviewChannel] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [playlistStats, setPlaylistStats] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [showPlaylistInfo, setShowPlaylistInfo] = useState(false);
  
  // Enhanced logging function that both logs to console AND stores in component state
  const logMessage = (message, type = 'info', data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const logItem = { timestamp, message, type, data };
    
    // Log to console with colors based on type
    const styles = {
      info: 'color: #29b6f6; font-weight: bold;',
      error: 'color: #f44336; font-weight: bold;',
      success: 'color: #66bb6a; font-weight: bold;',
      warning: 'color: #ffa726; font-weight: bold;'
    };
    
    console.log(`%c[${timestamp}] ${message}`, styles[type] || styles.info);
    if (data) console.log(data);
    
    // Add to component state for UI display
    setLogs(prev => [...prev, logItem].slice(-100)); // Keep last 100 logs only
    
    // Auto-scroll debug panel to bottom if visible
    if (debugRef.current && showDebugPanel) {
      setTimeout(() => {
        debugRef.current.scrollTop = debugRef.current.scrollHeight;
      }, 10);
    }
  };

  // Reposition the logPlaylistData function BEFORE it's used
  const logPlaylistData = async (id) => {
    // ...existing code...
  };

  // Add a function to diagnose storage issues
  const diagnoseStorage = async () => {
    // ...existing code...
  };

  useEffect(() => {
    logMessage(`PlaylistView initialized with ID: ${playlistId || 'none'}`);
    diagnoseStorage();
    
    // Load user favorites from IndexedDB using favorites utility
    const loadFavorites = async () => {
      try {
        // Import favorites utility to ensure consistent handling
        const { getFavorites } = await import('../utils/favorites');
        const favs = await getFavorites();
        setFavorites(favs);
        logMessage(`Loaded ${favs.length} favorites`);
      } catch (err) {
        logMessage(`Error loading favorites: ${err.message}`, 'error');
      }
    };
    
    // Load recently played channels
    const loadRecentlyPlayed = async () => {
      try {
        const recent = await get('recentlyPlayed') || [];
        setRecentlyPlayed(recent);
        logMessage(`Loaded ${recent.length} recently played channels`);
      } catch (err) {
        logMessage(`Error loading recently played channels: ${err.message}`, 'error');
      }
    };
    
    loadFavorites();
    loadRecentlyPlayed();
    
    return () => {
      logMessage('PlaylistView unmounting');
    };
  }, []);

  useEffect(() => {
    logMessage(`Loading playlist with ID: ${playlistId}`);
    if (playlistId) {
      loadPlaylist(true);
    } else {
      findAndNavigateToPlaylist();
    }
    
    return () => {
      logMessage('Cleaning up playlist loader');
    };
  }, [playlistId]);

  // Updated helper function to find and navigate to an available playlist
  const findAndNavigateToPlaylist = async () => {
    // ...existing code...
  };

  // Extract unique categories from channels
  const extractCategories = (channels) => {
    const categorySet = new Set(['all']);
    channels.forEach(channel => {
      if (channel.group && channel.group !== 'Uncategorized') {
        categorySet.add(channel.group);
      }
      if (channel.categories && Array.isArray(channel.categories)) {
        channel.categories.forEach(cat => categorySet.add(cat));
      }
    });
    return Array.from(categorySet);
  };
  
  // Calculate playlist statistics
  const calculatePlaylistStats = (channels) => {
    const stats = {
      totalChannels: channels.length,
      categoriesCount: new Set(channels.map(ch => ch.group)).size,
      countriesCount: new Set(channels.filter(ch => ch.country).map(ch => ch.country)).size,
      qualityBreakdown: {
        hd: channels.filter(ch => ch.quality && ch.quality.toLowerCase().includes('hd')).length,
        sd: channels.filter(ch => ch.quality && !ch.quality.toLowerCase().includes('hd')).length,
        unknown: channels.filter(ch => !ch.quality).length
      }
    };
    setPlaylistStats(stats);
    return stats;
  };

  // Update loadPlaylist to ensure loading state is properly managed
  const loadPlaylist = async (isMounted = true) => {
    logMessage(`Starting playlist load for ID: ${playlistId}`);
    setLoading(true);
    setError(null);
    setNoPlaylistsFound(false);
    
    try {
      // First check if IndexedDB is working
      // SECTION: Database Validation
      try {
        await testIndexedDB();
        logMessage('IndexedDB connection validated successfully');
      } catch (dbError) {
        logMessage(`IndexedDB access error: ${dbError.message}`, 'error', { stack: dbError.stack });
        setError(`Database access error: ${dbError.message}. Please try clearing your browser cache or using a different browser.`);
        setLoading(false);
        return;
      }
      
      // SECTION: Diagnostic Information
      await diagnoseStorage();
      const debugData = await logPlaylistData(playlistId);
      
      // SECTION: Playlist Retrieval
      const playlists = await get('playlists') || [];
      
      if (playlists.length === 0) {
        logMessage('No playlists available in storage', 'warning');
        setNoPlaylistsFound(true);
        setLoading(false);
        return;
      }
      
      // SECTION: Playlist Matching Strategy
      // Implementing a multi-stage matching algorithm to find the correct playlist
      let currentPlaylist = null;
      logMessage(`Attempting to find playlist with ID: ${playlistId}`, 'info', { playlistCount: playlists.length });
      
      // Strategy 1: Direct ID match (most reliable)
      currentPlaylist = playlists.find(p => p.id === playlistId);
      logMessage(`Direct ID match result: ${currentPlaylist ? 'SUCCESS' : 'FAILED'}`);
      
      // Strategy 2: Decode and match potential base64-encoded URLs
      if (!currentPlaylist) {
        try {
          if (playlistId.includes('aHR0')) {
            const decodedId = atob(playlistId.replace('playlist_', ''));
            currentPlaylist = playlists.find(p => p.url === decodedId || p.id.includes(decodedId));
            logMessage(`Base64 URL match result: ${currentPlaylist ? 'SUCCESS' : 'FAILED'}`, 'info', { decodedId });
          }
        } catch (e) {
          logMessage('Base64 decoding failed', 'warning', { error: e.message });
        }
      }
      
      // Strategy 3: Flexible matching using partial ID
      if (!currentPlaylist) {
        const { findPlaylistByPartialId } = await import('../utils/playlist');
        currentPlaylist = await findPlaylistByPartialId(playlistId);
        logMessage(`Flexible matching result: ${currentPlaylist ? 'SUCCESS' : 'FAILED'}`);
      }
      
      // Strategy 4: Substring match in ID or URL
      if (!currentPlaylist) {
        currentPlaylist = playlists.find(p => 
          p.id.includes(playlistId) || 
          playlistId.includes(p.id) || 
          p.url.includes(playlistId)
        );
        logMessage(`Substring match result: ${currentPlaylist ? 'SUCCESS' : 'FAILED'}`);
      }
      
      // Strategy 5: Use alternate match from debug data
      if (!currentPlaylist && debugData?.alternateMatch) {
        currentPlaylist = debugData.alternateMatch;
        logMessage(`Alternate match from debug data result: ${currentPlaylist ? 'SUCCESS' : 'FAILED'}`);
      }

      // Handle case where playlist is not found
      if (!currentPlaylist) {
        setDebugInfo({
          error: 'Playlist not found',
          requestedId: playlistId,
          possibleEncoding: playlistId.includes('aHR0') ? 'base64' : 'unknown',
          availablePlaylists: playlists.map(p => ({ id: p.id, name: p.name }))
        });
        setError(`Playlist "${playlistId}" not found. This might be due to a corrupted link or the playlist may have been deleted.`);
        setLoading(false);
        return;
      }
      
      // Successfully found the playlist
      logMessage(`Successfully found playlist: ${currentPlaylist.name} (${currentPlaylist.id})`, 'success');
      setPlaylist(currentPlaylist);
      
      // Get channels for this playlist using currentPlaylist.id
      const allChannels = await get('channels') || {};
      let playlistChannels = allChannels[currentPlaylist.id] || [];
      
      logMessage(`Channel data for playlist ${currentPlaylist.id}: ${playlistChannels.length} channels`);
      setDebugInfo({
        playlistId: currentPlaylist.id,
        playlistName: currentPlaylist.name,
        channelCount: playlistChannels.length,
        allChannelsKeys: Object.keys(allChannels)
      });
      
      if (playlistChannels.length > 0) {
        logMessage('Channels loaded successfully', 'success');
        
        // Enhance channels with logos if needed
        const { getComprehensiveChannelLogo } = await import('../utils/playlist');
        
        const enhancedChannels = await Promise.all(
          playlistChannels.map(async channel => {
            if (!channel.logo || channel.logo.startsWith('error:')) {
              channel.logo = await getComprehensiveChannelLogo(channel);
            }
            return channel;
          })
        );
        
        setChannels(enhancedChannels);
        
        // Extract categories from channels
        const extractedCategories = extractCategories(enhancedChannels);
        setCategories(extractedCategories);
        logMessage(`Extracted ${extractedCategories.length} categories`, 'info');
        
        // Calculate playlist statistics
        calculatePlaylistStats(enhancedChannels);
        
        setLoading(false); // Set loading to false here
      } else {
        // If no channels found, try to auto-refresh the playlist
        logMessage('No channels found for playlist, attempting auto-refresh...', 'warning');
        
        try {
          // Auto-refresh the playlist to get channels
          const { refreshPlaylist } = await import('../utils/playlist');
          const refreshResult = await refreshPlaylist(currentPlaylist.id);
          
          logMessage(`Refresh completed with result:`, 'info', {
            playlistId: refreshResult.id,
            channelCount: refreshResult.channelCount,
            hasChannels: Array.isArray(refreshResult.channels)
          });
          
          // Get the refreshed channels directly from the refresh result
          // instead of querying storage again which may have timing issues
          const autoRefreshedChannels = refreshResult.channels || [];
          
          if (autoRefreshedChannels.length > 0) {
            logMessage(`Auto-refresh successful: loaded ${autoRefreshedChannels.length} channels`, 'success');
            
            // Enhance channels with logos if needed
            const { getComprehensiveChannelLogo } = await import('../utils/playlist');
            
            const enhancedChannels = await Promise.all(
              autoRefreshedChannels.map(async channel => {
                if (!channel.logo || channel.logo.startsWith('error:')) {
                  channel.logo = await getComprehensiveChannelLogo(channel);
                }
                return channel;
              })
            );
            
            setChannels(enhancedChannels);
            
            // Extract categories from channels
            const extractedCategories = extractCategories(enhancedChannels);
            setCategories(extractedCategories);
            logMessage(`Extracted ${extractedCategories.length} categories`, 'info');
            
            // Calculate playlist statistics
            calculatePlaylistStats(enhancedChannels);
          } else {
            logMessage('No channels returned directly, checking storage with timeout...', 'warning');
            
            // Add a small timeout to ensure IndexedDB has completed all transactions
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Double check storage one more time - the refresh might have saved to storage but not returned the channels
            const doubleCheckChannels = await get('channels') || {};
            
            logMessage(`Storage check result:`, 'info', {
              availableIds: Object.keys(doubleCheckChannels),
              currentPlaylistId: currentPlaylist.id,
              channelsFoundForCurrentId: (doubleCheckChannels[currentPlaylist.id] || []).length
            });
            
            const lastResortChannels = doubleCheckChannels[currentPlaylist.id] || [];
            
            if (lastResortChannels.length > 0) {
              logMessage(`Found ${lastResortChannels.length} channels in storage after refresh`, 'success');
              
              setChannels(lastResortChannels);
              
              // Extract categories from channels
              const extractedCategories = extractCategories(lastResortChannels);
              setCategories(extractedCategories);
              logMessage(`Extracted ${extractedCategories.length} categories`, 'info');
              
              // Calculate playlist statistics
              calculatePlaylistStats(lastResortChannels);
            } else {
              logMessage('Auto-refresh completed but no channels found', 'warning');
              setError('No channels found in this playlist. Try refreshing manually or check the playlist URL.');
            }
          }
        } catch (refreshError) {
          logMessage(`Auto-refresh failed: ${refreshError.message}`, 'error');
          setError(`Could not load channels. Error: ${refreshError.message}`);
        }
        
        // Set loading to false regardless of refresh outcome
        setLoading(false);
      }
    } catch (err) {
      if (!isMounted) return;
      logMessage(`Error in loadPlaylist: ${err.message}`, 'error');
      setError(`Error loading playlist: ${err.message}`);
      setLoading(false); // Set loading to false on error
    }
  };

  // Test if IndexedDB is working
  const testIndexedDB = () => {
    // ...existing code...
  };

  // Helper function to add logos to channels
  const enhanceChannelsWithLogo = async (channels) => {
    // ...existing code...
  };

  // Update the handleRefreshPlaylist function to properly maintain the view state
  const handleRefreshPlaylist = async () => {
    // ...existing code...
  };

  // Toggle favorite status of a channel
  const toggleFavorite = async (channel, event) => {
    // Stop event propagation to prevent navigation
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    
    try {
      // Import favorites utility for consistent handling
      const { toggleFavorite: toggleFav } = await import('../utils/favorites');
      const newStatus = await toggleFav(channel);
      
      if (newStatus !== null) {
        // Update local state to reflect changes
        setFavorites(prev => {
          if (newStatus) {
            // Add to favorites
            return [...prev, {...channel, addedToFavoritesAt: new Date().toISOString()}];
          } else {
            // Remove from favorites
            return prev.filter(fav => fav.id !== channel.id);
          }
        });
        logMessage(`${newStatus ? 'Added' : 'Removed'} ${channel.name} ${newStatus ? 'to' : 'from'} favorites`);
      }
      
      return newStatus;
    } catch (err) {
      logMessage(`Error toggling favorite: ${err.message}`, 'error');
      return null;
    }
  };
  
  // Fix the isFavorite function to handle array properly
  const isFavorite = (channelId) => {
    if (!channelId || !Array.isArray(favorites)) return false;
    return favorites.some(fav => fav.id === channelId);
  };

  // Track recently played channels
  const trackChannelPlay = async (channel) => {
    try {
      const recent = await get('recentlyPlayed') || [];
      
      // Remove this channel if it already exists in the list
      const withoutCurrent = recent.filter(item => item.id !== channel.id);
      
      // Add channel to the beginning with timestamp
      const updatedRecent = [
        {
          ...channel,
          playedAt: new Date().toISOString()
        },
        ...withoutCurrent
      ].slice(0, 20); // Keep only 20 most recent
      
      // Update storage and state
      await set('recentlyPlayed', updatedRecent);
      setRecentlyPlayed(updatedRecent);
      
      logMessage(`Updated recently played: ${channel.name}`);
    } catch (err) {
      logMessage(`Error updating recently played: ${err.message}`, 'error');
    }
  };

  // Redirect to settings page with focus on adding playlist
  const goToAddPlaylist = () => {
    route('/settings');
  };

  // Export playlist to M3U file
  const exportPlaylist = async () => {
    try {
      if (!playlist || !channels || channels.length === 0) {
        logMessage('No playlist or channels to export', 'warning');
        return;
      }
      
      logMessage('Creating M3U export...', 'info');
      
      // Create M3U header
      let m3uContent = '#EXTM3U\n';
      
      // Add each channel to the playlist
      channels.forEach(channel => {
        // Add extended info
        m3uContent += `#EXTINF:-1 tvg-id="${channel.tvgId || ''}" tvg-name="${channel.tvgName || channel.name}" tvg-logo="${channel.logo || ''}" group-title="${channel.group || 'Uncategorized'}",${channel.name}\n`;
        
        // Add channel URL
        m3uContent += `${channel.url}\n`;
      });
      
      // Create blob and download link
      const blob = new Blob([m3uContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${playlist.name || 'playlist'}.m3u`;
      
      // Trigger download and cleanup
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      logMessage('Playlist exported successfully', 'success');
    } catch (err) {
      logMessage(`Error exporting playlist: ${err.message}`, 'error');
    }
  };

  // Handle sorting change
  const handleSortChange = (option) => {
    if (sortOption === option) {
      // Toggle direction if same option
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new option with default ascending direction
      setSortOption(option);
      setSortDirection('asc');
    }
  };

  // Update the addSamplePlaylist function to ensure unique channel IDs
  const addSamplePlaylist = async () => {
    // ...existing code...
  };
  
  // Start channel preview
  const handleShowPreview = (channel, event) => {
    if (event) {
      event.stopPropagation();
    }
    setPreviewChannel(channel);
    setShowPreview(true);
  };

  // Close channel preview
  const closePreview = () => {
    // Create a local reference to avoid state closure issues
    const previewFrame = document.getElementById('preview-iframe');
    if (previewFrame) {
      // Pause video by setting src to empty before removing
      previewFrame.src = '';
    }
    
    setShowPreview(false);
    setTimeout(() => setPreviewChannel(null), 300); // Clear after animation
  };

  // Filter channels based on search query, category, and sort
  const getFilteredAndSortedChannels = () => {
    // First filter by search query
    let filtered = channels.filter(channel => 
      channel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (channel.group && channel.group.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (channel.country && channel.country.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (channel.tvgId && channel.tvgId.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    
    // Then filter by active category if not 'all'
    if (activeCategory && activeCategory !== 'all') {
      filtered = filtered.filter(channel => {
        // Check group
        if (channel.group === activeCategory) return true;
        
        // Check categories array
        if (channel.categories && Array.isArray(channel.categories)) {
          return channel.categories.includes(activeCategory);
        }
        
        return false;
      });
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortOption) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'group':
          comparison = (a.group || 'Uncategorized').localeCompare(b.group || 'Uncategorized');
          break;
        case 'recent':
          // Find timestamps from recently played
          const aTimestamp = recentlyPlayed.find(r => r.id === a.id)?.playedAt || '0';
          const bTimestamp = recentlyPlayed.find(r => r.id === b.id)?.playedAt || '0';
          comparison = bTimestamp.localeCompare(aTimestamp); // Default to newest first
          break;
        default:
          comparison = a.name.localeCompare(b.name);
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  };

  // Group channels by their group property
  const groupChannels = (filteredChannels) => {
    return filteredChannels.reduce((acc, channel) => {
      const group = channel.group || 'Uncategorized';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(channel);
      return acc;
    }, {});
  };

  const navigateToChannel = (channel) => {
    try {
      // Track channel play
      trackChannelPlay(channel);
      
      // Use consistent approach for navigation - prefer URL, fall back to ID
      const navTarget = channel.url || channel.id;
      logMessage(`Navigating to channel: ${channel.name}, URL: ${navTarget.substring(0, 50)}...`);
      route(`/watch/${encodeURIComponent(navTarget)}`);
    } catch (err) {
      logMessage('Navigation error:', 'error', { err, channel });
      // Fallback if something goes wrong with URL encoding
      route(`/watch/${encodeURIComponent(channel.id || '')}`);
    }
  };

  // Debug function to reset storage (for troubleshooting)
  const resetStorage = async () => {
    // ...existing code...
  };

  // Extract the logo error handler into a reusable function
  const handleLogoError = (e, channelName) => {
    // ...existing code...
  };

  // Apply our filters and sorting
  const filteredChannels = getFilteredAndSortedChannels();
  const groupedChannels = groupChannels(filteredChannels);

  // If we're redirecting, show a loading indicator
  if (redirecting) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2">Redirecting to playlist...</span>
      </div>
    );
  }

  // Render no playlists found state
  if (noPlaylistsFound) {
    // ...existing code...
  }

  // Add debug panel toggle button
  const toggleDebugPanel = () => {
    setShowDebugPanel(prev => !prev);
    logMessage('Debug panel toggled');
  };

  // Fix for the "Cannot read properties of null" error
  useEffect(() => {
    // Fix dropdown click handling
    const handleClickOutside = (event) => {
      const dropdown = document.getElementById('sort-dropdown');
      const sortButton = event.target.closest('button[aria-label*="Sort"]');
      
      if (dropdown && !dropdown.classList.contains('hidden') && !sortButton) {
        dropdown.classList.add('hidden');
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  return (
    <div className="pb-16 max-w-screen-2xl mx-auto overflow-hidden">
      {/* Header - Improved desktop layout with overflow handling */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 sm:gap-3">
          <div className="max-w-full overflow-hidden">
            <a 
              href="/settings" 
              className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-1 sm:mb-2 text-sm sm:text-base"
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="truncate">Back to playlists</span>
            </a>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold truncate max-w-full">
              {playlist?.name || 'Loading...'}
            </h2>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 mt-2 sm:mt-0 flex-shrink-0">
            <button
              onClick={() => setShowPlaylistInfo(!showPlaylistInfo)}
              className="p-1.5 sm:p-2 text-gray-300 hover:text-white bg-gray-700 rounded-lg"
              title="Playlist Information"
              aria-label="Playlist Information"
            >
              <Info className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            
            <button
              onClick={exportPlaylist}
              className="p-1.5 sm:p-2 text-gray-300 hover:text-white bg-gray-700 rounded-lg"
              title="Export Playlist"
              aria-label="Export Playlist"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            
            <button
              onClick={handleRefreshPlaylist}
              disabled={refreshing}
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 sm:gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
        
        <p className="text-gray-400 mt-1 sm:mt-2 text-xs sm:text-sm line-clamp-2 hover:line-clamp-none focus:line-clamp-none break-all overflow-hidden">
          {playlist?.url ? playlist.url : 'Loading playlist URL...'}
        </p>
        
        {/* Playlist Information Panel - Improved with overflow handling */}
        {showPlaylistInfo && playlistStats && (
          <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-gray-800 rounded-lg overflow-hidden">
            {/* ...existing content... */}
          </div>
        )}
      </div>

      {/* Categories tabs - Improved scrolling with fixed width items */}
      {!loading && !error && categories.length > 0 && (
        <div className="mb-3 sm:mb-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1.5 sm:gap-2 pb-1 flex-wrap md:flex-nowrap min-w-min">
            {categories.slice(0, 12).map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-lg whitespace-nowrap ${
                  activeCategory === category 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                } mb-1 md:mb-0 max-w-[200px] truncate`}
                title={category}
              >
                {category === 'all' ? 'All Channels' : category}
              </button>
            ))}
            
            {categories.length > 12 && (
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-lg flex items-center gap-1 whitespace-nowrap text-xs sm:text-sm mb-1 md:mb-0 flex-shrink-0"
              >
                <Filter className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span>More</span>
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Extended filter panel - Improved with truncated text */}
      {isFilterOpen && (
        <div className="mb-3 sm:mb-4 p-3 sm:p-4 bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h3 className="font-medium text-sm sm:text-base">Advanced Filters</h3>
            <button
              onClick={() => setIsFilterOpen(false)}
              className="text-gray-400 hover:text-white"
              aria-label="Close filters"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto pr-1">
            {categories.slice(1).map((category) => (
              <label 
                key={category}
                className="flex items-center p-1.5 sm:p-2 rounded hover:bg-gray-700 cursor-pointer text-xs sm:text-sm"
                title={category}
              >
                <input 
                  type="radio" 
                  name="category" 
                  checked={activeCategory === category}
                  onChange={() => setActiveCategory(category)}
                  className="mr-1.5 sm:mr-2 flex-shrink-0"
                />
                <span className="truncate">{category}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Search and view toggles - Unchanged */}
      <div className="mb-4 sm:mb-6 bg-gray-800 p-3 sm:p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <div className="relative flex-1 max-w-full sm:max-w-md md:max-w-lg">
          <input
            type="text"
            placeholder="Search channels..."
            className="w-full px-3 sm:px-4 py-2 pl-9 sm:pl-10 bg-gray-700 rounded-lg border border-gray-600 text-sm"
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-3 top-2.5 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            onClick={() => setIsGridView(!isGridView)}
            className="p-1.5 sm:p-2 text-gray-300 hover:text-white bg-gray-700 rounded-lg"
            title={isGridView ? "Switch to List View" : "Switch to Grid View"}
            aria-label={isGridView ? "Switch to List View" : "Switch to Grid View"}
          >
            {isGridView ? <List className="w-4 h-4 sm:w-5 sm:h-5" /> : <GridIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
          
          <div className="relative">
            <button
              onClick={() => document.getElementById('sort-dropdown').classList.toggle('hidden')}
              className="p-1.5 sm:p-2 text-gray-300 hover:text-white bg-gray-700 rounded-lg"
              title="Sort Channels"
              aria-label="Sort Channels"
            >
              <ArrowDownUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            
            <div id="sort-dropdown" className="hidden absolute right-0 mt-2 w-40 bg-gray-800 rounded-lg shadow-lg z-10">
              <button
                onClick={() => handleSortChange('name')}
                className={`block w-full text-left px-3 py-2 text-sm ${sortOption === 'name' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                Sort by Name
              </button>
              <button
                onClick={() => handleSortChange('group')}
                className={`block w-full text-left px-3 py-2 text-sm ${sortOption === 'group' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                Sort by Group
              </button>
              <button
                onClick={() => handleSortChange('recent')}
                className={`block w-full text-left px-3 py-2 text-sm ${sortOption === 'recent' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                Sort by Recently Played
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Recently played section - Better overflow handling */}
      {recentlyPlayed.length > 0 && !loading && !error && (
        <div className="mb-4 sm:mb-6 overflow-hidden">
          <h3 className="text-sm sm:text-lg font-medium mb-2 sm:mb-3 flex items-center gap-1.5 sm:gap-2">
            <Clock className="w-3.5 h-3.5 sm:w-5 sm:h-5 flex-shrink-0" />
            <span className="truncate">Recently Played</span>
          </h3>
          
          <div className="grid grid-rows-1 grid-flow-col auto-cols-max gap-2 sm:gap-3 pb-1 -mx-4 px-4 overflow-x-auto scrollbar-hide">
            {recentlyPlayed.slice(0, 10).map(channel => (
              <div
                key={`recent-${channel.id}`}
                onClick={() => navigateToChannel(channel)}
                className="flex-shrink-0 w-24 sm:w-32 bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <div className="w-full h-14 sm:h-20 bg-gray-900 relative">
                  {channel.logo ? (
                    <img 
                      src={channel.logo}
                      alt={channel.name} 
                      className="w-full h-full object-contain p-1.5 sm:p-2"
                      onError={(e) => handleLogoError(e, channel.name)}
                      loading="lazy"
                    />
                  ) : (
                    <div 
                      className="w-full h-full flex items-center justify-center"
                      style={{ backgroundColor: getChannelColor(channel.name) }}
                    >
                      <div className="text-white text-sm sm:text-lg font-bold">
                        {getChannelInitials(channel.name)}
                      </div>
                    </div>
                  )}
                  
                  <button
                    onClick={(e) => toggleFavorite(channel, e)}
                    className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 p-0.5 sm:p-1 rounded-full bg-black/50 hover:bg-black/70"
                    aria-label={isFavorite(channel.id) ? "Remove from favorites" : "Add to favorites"}
                  >
                    {isFavorite(channel.id) ? (
                      <Heart className="w-3 h-3 sm:w-4 sm:h-4 text-red-500 fill-current" />
                    ) : (
                      <Heart className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                    )}
                  </button>
                </div>
                
                <div className="p-1.5 sm:p-2">
                  <h4 className="text-xs sm:text-sm font-medium truncate">{channel.name}</h4>
                  <p className="text-xs text-gray-400 truncate">{channel.group || 'Uncategorized'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Section - Improved channel grid with better text truncation */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="w-8 h-8 animate-spin text-blue-500" />
          <span className="ml-2">Loading playlist...</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-16">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <span className="ml-2">{error}</span>
        </div>
      ) : filteredChannels.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <AlertCircle className="w-8 h-8 text-yellow-500" />
          <span className="ml-2">No channels found</span>
        </div>
      ) : (
        <div>
          {isGridView ? (
            // Optimized grid view with better overflow handling
            Object.entries(groupedChannels).map(([group, groupChannels]) => (
              <div key={group} className="mb-5 sm:mb-8">
                <h3 className="text-sm sm:text-lg font-medium mb-2 sm:mb-3 truncate" title={group}>
                  {group}
                </h3>
                <div className="grid grid-cols-2 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-4">
                  {groupChannels.map(channel => (
                    <div
                      key={channel.id}
                      onClick={() => navigateToChannel(channel)}
                      className="bg-gray-800 p-2 sm:p-4 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer relative overflow-hidden"
                    >
                      <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                        <div className="relative flex-shrink-0">
                          {channel.logo ? (
                            <img 
                              src={channel.logo}
                              alt={channel.name} 
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0 object-cover bg-gray-900"
                              onError={(e) => handleLogoError(e, channel.name)}
                              loading="lazy"
                            />
                          ) : (
                            <div 
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0 flex items-center justify-center"
                              style={{ backgroundColor: getChannelColor(channel.name) }}
                            >
                              <div className="text-white text-xs sm:text-sm font-bold">
                                {getChannelInitials(channel.name)}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <h4 className="font-medium truncate text-xs sm:text-sm" title={channel.displayName || channel.tvgName || channel.name}>
                            {channel.channelNumber && (
                              <span className="text-gray-400 mr-1">{channel.channelNumber}.</span>
                            )}
                            {channel.displayName || channel.tvgName || channel.name}
                          </h4>
                          
                          {/* Show quality info if available */}
                          {channel.quality && (
                            <span className="text-xs px-1 py-0.5 bg-gray-700 rounded-sm text-gray-300 inline-block mt-0.5 truncate max-w-full">
                              {channel.quality}
                            </span>
                          )}
                          
                          {/* Display country if available */}
                          {channel.country && (
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              <span className="uppercase">{channel.country}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Display categories if available - Improved truncation */}
                      {channel.categories && channel.categories.length > 0 && (
                        <div className="mt-1 sm:mt-2 flex flex-wrap gap-1 overflow-hidden">
                          {channel.categories.slice(0, 1).map((category, index) => (
                            <span 
                              key={index} 
                              className="text-xs bg-blue-900/40 px-1.5 sm:px-2 py-0.5 rounded-full text-blue-300 truncate max-w-[120px]"
                              title={category}
                            >
                              {category}
                            </span>
                          ))}
                          {channel.categories.length > 1 && (
                            <span className="text-xs bg-blue-900/40 px-1.5 sm:px-2 py-0.5 rounded-full text-blue-300">
                              +{channel.categories.length - 1}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Action buttons */}
                      <div className="absolute top-1 sm:top-2 right-1 sm:right-2 flex gap-1">
                        <button
                          onClick={(e) => toggleFavorite(channel, e)}
                          className="p-1 sm:p-1.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 flex-shrink-0"
                          title={isFavorite(channel.id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Heart className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isFavorite(channel.id) ? 'text-red-500 fill-current' : ''}`} />
                        </button>
                        
                        <button
                          onClick={(e) => handleShowPreview(channel, e)}
                          className="p-1 sm:p-1.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 flex-shrink-0"
                          title="Preview channel"
                        >
                          <PlayCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Optimized list view with better text handling
            Object.entries(groupedChannels).map(([group, groupChannels]) => (
              <div key={group} className="mb-4 sm:mb-6">
                <h3 className="text-sm sm:text-lg font-medium mb-1.5 sm:mb-2 truncate" title={group}>
                  {group}
                </h3>
                <div className="bg-gray-800 rounded-lg overflow-hidden">
                  {groupChannels.map(channel => (
                    <div
                      key={channel.id}
                      onClick={() => navigateToChannel(channel)}
                      className="flex items-center py-2 px-2 sm:p-3 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-0 cursor-pointer overflow-hidden"
                    >
                      {channel.logo ? (
                        <img 
                          src={channel.logo}
                          alt={channel.name} 
                          data-channel={channel.id}
                          className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0 object-cover bg-gray-900 mr-2 sm:mr-3"
                          onError={(e) => handleLogoError(e, channel.name)}
                          loading="lazy"
                        />
                      ) : (
                        <div 
                          className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0 flex items-center justify-center mr-2 sm:mr-3"
                          style={{ backgroundColor: getChannelColor(channel.name) }}
                        >
                          <div className="text-white text-xs sm:text-sm font-bold">
                            {getChannelInitials(channel.name)}
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-w-0 overflow-hidden mr-2">
                        <span className="font-medium text-xs sm:text-sm block truncate" title={channel.tvgName || channel.name}>
                          {channel.tvgName || channel.name}
                        </span>
                        
                        {/* Display original title if it differs from TVG name */}
                        {channel.tvgName && channel.tvgName !== channel.name && (
                          <div className="text-xs text-gray-400 truncate mt-0.5" title={channel.name}>
                            {channel.name}
                          </div>
                        )}
                        
                        {/* Display categories in list view - Improved truncation */}
                        {channel.categories && channel.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5 sm:mt-1 overflow-hidden">
                            {channel.categories.slice(0, 1).map((category, index) => (
                              <span 
                                key={index} 
                                className="text-xs bg-gray-700 px-1 sm:px-1.5 py-0.5 rounded-full text-gray-300 truncate max-w-[80px] sm:max-w-[120px]"
                                title={category}
                              >
                                {category}
                              </span>
                            ))}
                            {channel.categories.length > 1 && (
                              <span className="text-xs bg-gray-700 px-1 sm:px-1.5 py-0.5 rounded-full text-gray-300">
                                +{channel.categories.length - 1}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Better spacing for list view actions on desktop */}
                      <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => toggleFavorite(channel, e)}
                          className="p-1.5 sm:p-2 text-gray-400 hover:text-white"
                          title={isFavorite(channel.id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${isFavorite(channel.id) ? 'text-red-500 fill-current' : ''}`} />
                        </button>
                        
                        <button
                          onClick={(e) => handleShowPreview(channel, e)}
                          className="p-1.5 sm:p-2 text-gray-400 hover:text-white"
                          title="Preview channel"
                        >
                          <PlayCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Channel Preview Modal, Debug Panel, etc. - Unchanged */}
      {showPreview && previewChannel && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-gray-900 rounded-lg overflow-hidden w-full max-w-3xl">
            <div className="p-2 sm:p-4 bg-gray-800 flex justify-between items-center">
              <h3 className="font-medium text-sm sm:text-base truncate pr-2">{previewChannel.name}</h3>
              <button 
                onClick={closePreview}
                className="p-1 rounded hover:bg-gray-700 flex-shrink-0"
                aria-label="Close preview"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            
            <div className="aspect-video bg-black relative">
              <iframe 
                id="preview-iframe"
                src={`/watch/${encodeURIComponent(previewChannel.url || previewChannel.id)}?preview=true`}
                className="w-full h-full absolute" 
                title={`Preview: ${previewChannel.name}`}
                allow="autoplay; fullscreen"
                loading="lazy"
                sandbox="allow-same-origin allow-scripts allow-forms"
              />
            </div>
            
            <div className="p-2 sm:p-4 flex flex-wrap gap-2 sm:gap-3">
              <button
                onClick={() => navigateToChannel(previewChannel)}
                className="px-3 py-1.5 sm:py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
              >
                <PlayCircle className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                Watch Full Screen
              </button>
              
              <button
                onClick={(e) => toggleFavorite(previewChannel, e)}
                className={`px-3 py-1.5 sm:py-2 ${isFavorite(previewChannel.id) ? 'bg-red-600' : 'bg-gray-700'} text-white rounded hover:${isFavorite(previewChannel.id) ? 'bg-red-700' : 'bg-gray-600'} flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm`}
              >
                <Heart className={`w-3.5 h-3.5 sm:w-5 sm:h-5 ${isFavorite(previewChannel.id) ? 'fill-current' : ''}`} />
                {isFavorite(previewChannel.id) ? 'Remove from Favorites' : 'Add to Favorites'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Panel with toggle button */}
      {showDebugPanel && (
        <div className="fixed bottom-16 left-0 right-0 max-h-[70vh] bg-gray-900 overflow-auto p-2 text-xs border-t border-gray-700 z-40" ref={debugRef}>
          <pre>{JSON.stringify({ debugInfo, storageInfo, logs }, null, 2)}</pre>
        </div>
      )}
      
      <button 
        onClick={toggleDebugPanel} 
        className="fixed bottom-2 right-2 bg-gray-800 p-1 rounded text-xs text-gray-400 hover:bg-gray-700 z-40"
      >
        Debug
      </button>
    </div>
  );
}
