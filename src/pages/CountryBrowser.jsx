import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { route } from 'preact-router';
import { Globe, Search, Loader, AlertCircle, PlayCircle, Download, Check, Tv2, BookOpen, RefreshCw, Plus, Filter, Grid, List, Wifi, WifiOff, ArrowDown, ArrowUp, SortDesc } from 'lucide-preact';
import { getPlaylists, savePlaylist, fetchPlaylist, formatLogoUrl } from '../utils/playlist';
import { getChannelColor, getChannelInitials } from '../utils/logoService';
import { getCountries, getCategories, getLanguages, getChannelsByCountry, getStreams, getChannels } from '../utils/apiClient';
import * as apiClient from '../utils/apiClient';
import { debounce, throttle, memoize } from '../utils/performance';
import { EnhancedVirtualList } from '../components/EnhancedVirtualList';
import { getFavorites, toggleFavorite } from '../utils/favorites'; // Import favorites utilities
import 'flag-icons/css/flag-icons.min.css';

// Memoized simple components for better performance
const CountryListItem = memo(({ item, selectedItem, streamInfo, loadingStreamCounts, onClick }) => {
  const isSelected = selectedItem && selectedItem.code === item.code;
  const countryCode = item.code || '';
  
  return (
    <button
      onClick={() => onClick(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick(item);
          e.preventDefault();
        }
      }}
      class={`w-full text-left p-3 rounded-lg flex items-center ${
        isSelected ? 'bg-blue-700' : 'hover:bg-gray-700'
      }`}
      aria-selected={isSelected}
      role="option"
      aria-label={`Select ${item.name}`}
    >
      <div class="flex items-center gap-3 w-full">
        <div class="w-8 h-6 flex-shrink-0 overflow-hidden rounded shadow-sm bg-gray-900">
          {countryCode && (
            <span 
              class={`fi fi-${countryCode.toLowerCase()}`}
              style={{ display: 'block', width: '100%', height: '100%' }}
              aria-hidden="true"
            ></span>
          )}
        </div>
        <span class="flex-1">{item.name} {item.code && <span class="text-gray-400 text-sm">({item.code.toUpperCase()})</span>}</span>
        
        {/* Enhanced stream count display */}
        {streamInfo && (
          <div class={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
            streamInfo.streamCount > 0 ? 'bg-green-900/30 text-green-300' : 'bg-gray-700 text-gray-400'
          }`}>
            <Wifi class={`w-3 h-3 ${streamInfo.streamCount > 0 ? 'text-green-400' : 'text-gray-500'}`} />
            <span>{streamInfo.streamCount}</span>
            {streamInfo.channelCount > 0 && streamInfo.channelCount !== streamInfo.streamCount && (
              <span class="text-gray-400">/{streamInfo.channelCount}</span>
            )}
          </div>
        )}
        {!streamInfo && loadingStreamCounts && (
          <div class="w-8 h-5 flex-shrink-0">
            <Loader class="w-3 h-3 animate-spin" />
          </div>
        )}
      </div>
    </button>
  );
});

// Memoized channel grid item
const ChannelGridItem = memo(({ channel, index, isFavorite, onFavoriteToggle }) => {
  const logoSrc = channel.logo || apiClient.getLogoUrl(channel.id || channel.name);
  const hasStream = !!channel.url;
  
  const handleFavoriteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFavoriteToggle(channel);
  };

  return (
    <div
      class={`bg-gray-700 p-3 rounded-lg transition-colors flex flex-col ${hasStream ? 'hover:bg-gray-600' : 'opacity-60'}`}
    >
      <div class="flex items-center gap-3 mb-2">
        <div class="w-12 h-12 rounded-md flex-shrink-0 relative overflow-hidden">
          <img
            src={logoSrc}
            alt={channel.name || 'Channel logo'}
            class="w-12 h-12 rounded-md object-contain bg-gray-900"
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              e.target.style.display = 'none';
              e.target.parentNode.innerHTML = `<div class="w-12 h-12 bg-gray-800 rounded-md flex items-center justify-center" style="background-color: ${getChannelColor(channel.name)}"><div class="text-white text-sm font-bold">${getChannelInitials(channel.name)}</div></div>`;
            }}
          />
        </div>
        <div class="flex-1 min-w-0">
          <h5 class="font-medium text-sm truncate flex items-center gap-1">
            {channel.name || 'Unnamed Channel'}
            {hasStream ? (
              <Wifi class="w-3 h-3 text-green-500 flex-shrink-0" />
            ) : (
              <WifiOff class="w-3 h-3 text-red-500 flex-shrink-0" />
            )}
          </h5>
          <p class="text-xs text-gray-400 truncate">
            {channel.categories?.[0] || 'General'}
            {channel.resolution && (
              <span class="ml-1 bg-gray-800 px-1 py-0.5 rounded text-xs">
                {channel.resolution}
              </span>
            )}
          </p>
        </div>
      </div>
      <div class="mt-auto pt-2 flex justify-between items-center">
        <span class="text-xs bg-gray-800 px-2 py-0.5 rounded">
          {channel.languages?.[0] || 'Unknown'}
        </span>
        <div class="flex items-center gap-1">
          {/* Add favorite toggle button */}
          <button
            onClick={handleFavoriteClick}
            class="p-1.5 bg-gray-800 rounded-full hover:bg-gray-700"
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <svg 
              class={`w-4 h-4 ${isFavorite ? 'text-red-500 fill-current' : 'text-gray-400'}`}
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              stroke-width="2" 
              fill="none"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          
          {hasStream ? (
            <a
              href={`/watch/${encodeURIComponent(channel.id || channel.url || index)}`}
              class="p-1.5 bg-blue-600 rounded-full hover:bg-blue-700"
            >
              <PlayCircle class="w-4 h-4" />
            </a>
          ) : (
            <span class="p-1.5 bg-gray-800 rounded-full text-gray-500">
              <PlayCircle class="w-4 h-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

// Memoized channel list item
const ChannelListItem = memo(({ channel, index, isFavorite, onFavoriteToggle }) => {
  const logoSrc = channel.logo || apiClient.getLogoUrl(channel.id || channel.name);
  const hasStream = !!channel.url;
  
  const handleFavoriteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFavoriteToggle(channel);
  };
  
  return (
    <a
      href={hasStream ? `/watch/${encodeURIComponent(channel.id || channel.url || index)}` : '#'}
      class={`flex items-center gap-3 bg-gray-700 p-3 rounded-lg ${hasStream ? 'hover:bg-gray-600 transition-colors' : 'opacity-60 cursor-default'}`}
      onClick={e => !hasStream && e.preventDefault()}
    >
      <div class="w-10 h-10 rounded-md flex-shrink-0 relative overflow-hidden">
        <img
          src={logoSrc}
          alt={channel.name || 'Channel logo'}
          class="w-10 h-10 rounded-md object-contain bg-gray-900"
          loading="lazy"
          onError={(e) => {
            e.target.onerror = null;
            e.target.style.display = 'none';
            e.target.parentNode.innerHTML = `<div class="w-10 h-10 bg-gray-800 rounded-md flex items-center justify-center" style="background-color: ${getChannelColor(channel.name)}"><div class="text-white text-xs font-bold">${getChannelInitials(channel.name)}</div></div>`;
          }}
        />
      </div>
      <div class="flex-1 min-w-0">
        <h5 class="font-medium text-sm truncate">
          {channel.name || 'Unnamed Channel'}
          {channel.id && (
            <span class="text-xs text-gray-400 ml-1">({channel.id})</span>
          )}
        </h5>
        <div class="flex items-center gap-2">
          {channel.categories?.[0] && (
            <span class="text-xs text-gray-400">{channel.categories[0]}</span>
          )}
          {channel.languages?.[0] && (
            <span class="text-xs bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">
              {channel.languages[0]}
            </span>
          )}
          {channel.resolution && (
            <span class="text-xs bg-blue-900/50 border border-blue-800 px-1.5 py-0.5 rounded text-gray-100">
              {channel.resolution}
            </span>
          )}
        </div>
      </div>
      <div class="flex items-center gap-2">
        {/* Add favorite button */}
        <button
          onClick={handleFavoriteClick}
          class="p-1.5 rounded flex-shrink-0"
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <svg 
            class={`w-5 h-5 ${isFavorite ? 'text-red-500 fill-current' : 'text-gray-400 hover:text-red-400'}`}
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            stroke-width="2" 
            fill="none"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
        
        {hasStream ? (
          <PlayCircle class="w-5 h-5 flex-shrink-0 text-blue-400" />
        ) : (
          <WifiOff class="w-4 h-4 flex-shrink-0 text-red-500" />
        )}
      </div>
    </a>
  );
});

export default function CountryBrowser() {
  const [activeTab, setActiveTab] = useState('countries');
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [previewChannels, setPreviewChannels] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  
  // Channel display state
  const [channels, setChannels] = useState([]);
  const [channelsPage, setChannelsPage] = useState(1);
  const [channelsPerPage, setChannelsPerPage] = useState(24);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  
  // Stream fetching state
  const [fetchingStreams, setFetchingStreams] = useState(false);
  const [streamsFetched, setStreamsFetched] = useState(false);
  
  // Country sorting state
  const [sortBy, setSortBy] = useState('streams');
  const [sortOrder, setSortOrder] = useState('desc');
  const [countriesWithStreamCounts, setCountriesWithStreamCounts] = useState([]);
  const [loadingStreamCounts, setLoadingStreamCounts] = useState(false);
  
  // Optimization: Use a ref to track if stream counts are already being loaded
  const [streamCountsLoading, setStreamCountsLoading] = useState(false);
  
  // Optimization: Cache the batch size for stream count loading
  const STREAM_COUNT_BATCH_SIZE = 10;
  
  // Additional state for channel sorting
  const [channelSortBy, setChannelSortBy] = useState('streams');
  const [channelSortOrder, setChannelSortOrder] = useState('desc');
  const [listHeight, setListHeight] = useState(500);
  const listContainerRef = useRef(null);
  
  // Create debounced versions of search and filter inputs
  const [searchQuery, setSearchQueryRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [channelFilter, setChannelFilterRaw] = useState('');
  const [debouncedChannelFilter, setDebouncedChannelFilter] = useState('');
  const debouncedApiCallRef = useRef(null);
  
  // Fix debounced setter functions - store debounced functions as refs
  const setSearchQuery = useCallback((value) => {
    setSearchQueryRaw(value);
    if (!debouncedSearchRef.current) {
      debouncedSearchRef.current = debounce((val) => setDebouncedSearch(val), 300);
    }
    debouncedSearchRef.current(value);
  }, []);
  
  const setChannelFilter = useCallback((value) => {
    setChannelFilterRaw(value);
    if (!debouncedChannelFilterRef.current) {
      debouncedChannelFilterRef.current = debounce((val) => setDebouncedChannelFilter(val), 300);
    }
    debouncedChannelFilterRef.current(value);
  }, []);
  
  // Add refs for debounced functions
  const debouncedSearchRef = useRef(null);
  const debouncedChannelFilterRef = useRef(null);
  
  // Store previous activeTab to detect changes
  const prevActiveTabRef = useRef(activeTab);
  
  // Use local storage for preferences
  useEffect(() => {
    // Load view mode preference
    try {
      const savedViewMode = localStorage.getItem('country-browser-view-mode');
      if (savedViewMode) setViewMode(savedViewMode);
      
      const savedSortBy = localStorage.getItem('country-browser-sort-by');
      if (savedSortBy) setSortBy(savedSortBy);
      
      const savedSortOrder = localStorage.getItem('country-browser-sort-order');
      if (savedSortOrder) setSortOrder(savedSortOrder);
    } catch (e) {
      console.warn('Could not load preferences from localStorage:', e);
    }
  }, []);
  
  // Save preferences when they change
  useEffect(() => {
    try {
      localStorage.setItem('country-browser-view-mode', viewMode);
    } catch (e) {
      console.warn('Could not save view mode preference:', e);
    }
  }, [viewMode]);
  
  useEffect(() => {
    try {
      localStorage.setItem('country-browser-sort-by', sortBy);
      localStorage.setItem('country-browser-sort-order', sortOrder);
    } catch (e) {
      console.warn('Could not save sort preferences:', e);
    }
  }, [sortBy, sortOrder]);

  // Main data loading function - optimized with useCallback and throttling
  const loadData = useCallback(async () => {
    // If there's a pending API call, cancel it
    if (debouncedApiCallRef.current) {
      clearTimeout(debouncedApiCallRef.current);
    }
    
    // Create a new debounced API call
    debouncedApiCallRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        
        switch (activeTab) {
          case 'countries':
            // Try loading from cache first
            let cachedCountries;
            try {
              const cachedData = localStorage.getItem('cached-countries');
              const cacheTimestamp = localStorage.getItem('cached-countries-timestamp');
              
              if (cachedData && cacheTimestamp) {
                // Check if cache is still valid (1 hour)
                const now = Date.now();
                if (now - parseInt(cacheTimestamp) < 3600000) {
                  cachedCountries = JSON.parse(cachedData);
                }
              }
            } catch (cacheError) {
              console.warn('Error retrieving cache:', cacheError);
            }
            
            if (cachedCountries && cachedCountries.length > 0) {
              setCountries(cachedCountries);
            } else {
              const countriesList = await getCountries();
              setCountries(countriesList);
              
              // Cache the results
              try {
                localStorage.setItem('cached-countries', JSON.stringify(countriesList));
                localStorage.setItem('cached-countries-timestamp', Date.now().toString());
              } catch (cacheError) {
                console.warn('Error caching countries data:', cacheError);
              }
            }
            break;
            
          case 'categories':
            // Same caching logic for categories
            let cachedCategories;
            try {
              const cachedData = localStorage.getItem('cached-categories');
              const cacheTimestamp = localStorage.getItem('cached-categories-timestamp');
              
              if (cachedData && cacheTimestamp) {
                const now = Date.now();
                if (now - parseInt(cacheTimestamp) < 3600000) {
                  cachedCategories = JSON.parse(cachedData);
                }
              }
            } catch (cacheError) {
              console.warn('Error retrieving categories cache:', cacheError);
            }
            
            if (cachedCategories && cachedCategories.length > 0) {
              setCategories(cachedCategories);
            } else {
              const categoriesList = await getCategories();
              setCategories(categoriesList);
              
              try {
                localStorage.setItem('cached-categories', JSON.stringify(categoriesList));
                localStorage.setItem('cached-categories-timestamp', Date.now().toString());
              } catch (cacheError) {
                console.warn('Error caching categories data:', cacheError);
              }
            }
            break;
            
          case 'languages':
            // Same caching logic for languages
            let cachedLanguages;
            try {
              const cachedData = localStorage.getItem('cached-languages');
              const cacheTimestamp = localStorage.getItem('cached-languages-timestamp');
              
              if (cachedData && cacheTimestamp) {
                const now = Date.now();
                if (now - parseInt(cacheTimestamp) < 3600000) {
                  cachedLanguages = JSON.parse(cachedData);
                }
              }
            } catch (cacheError) {
              console.warn('Error retrieving languages cache:', cacheError);
            }
            
            if (cachedLanguages && cachedLanguages.length > 0) {
              setLanguages(cachedLanguages);
            } else {
              const languagesList = await getLanguages();
              setLanguages(languagesList);
              
              try {
                localStorage.setItem('cached-languages', JSON.stringify(languagesList));
                localStorage.setItem('cached-languages-timestamp', Date.now().toString());
              } catch (cacheError) {
                console.warn('Error caching languages data:', cacheError);
              }
            }
            break;
        }
      } catch (err) {
        setError(`Failed to load ${activeTab}`);
        console.error(err);
      } finally {
        setLoading(false);
        debouncedApiCallRef.current = null;
      }
    }, 150); // Small delay to batch rapid calls
  }, [activeTab]);

  // Properly throttled stream count loading
  const loadCountryStreamCounts = useCallback(
    throttle(async (countriesList) => {
      if (streamCountsLoading || !countriesList?.length) return;
      
      try {
        setStreamCountsLoading(true);
        setLoadingStreamCounts(true);
        
        // Cache key for stream counts
        const streamCountsCacheKey = `stream-counts-${sortBy}-${sortOrder}`;
        
        // Try to load from cache first
        let cachedCounts = null;
        try {
          const cachedData = localStorage.getItem(streamCountsCacheKey);
          const cacheTimestamp = localStorage.getItem(`${streamCountsCacheKey}-timestamp`);
          
          if (cachedData && cacheTimestamp) {
            // Check if cache is still valid (30 minutes)
            const now = Date.now();
            if (now - parseInt(cacheTimestamp) < 1800000) {
              cachedCounts = JSON.parse(cachedData);
            }
          }
        } catch (cacheError) {
          console.warn('Error retrieving stream count cache:', cacheError);
        }
        
        if (cachedCounts && cachedCounts.length > 0) {
          setCountriesWithStreamCounts(cachedCounts);
          setLoadingStreamCounts(false);
          setTimeout(() => setStreamCountsLoading(false), 300);
          return;
        }
        
        // Rest of the original batch loading logic
        // ...existing code...
        
        // Cache the results when done
        try {
          localStorage.setItem(streamCountsCacheKey, JSON.stringify(countriesWithStreamCounts));
          localStorage.setItem(`${streamCountsCacheKey}-timestamp`, Date.now().toString());
        } catch (cacheError) {
          console.warn('Error caching stream counts:', cacheError);
        }
      } catch (err) {
        console.error('Error loading country stream counts:', err);
      } finally {
        setStreamCountsLoading(false);
        setLoadingStreamCounts(false);
      }
    }, 500), // Throttle to once every 500ms
    [sortBy, sortOrder]
  );

  // Improved sort function with better dependencies
  const toggleSort = useCallback((field) => {
    setSortBy(prevSort => {
      const newSortBy = prevSort === field ? field : field;
      const newSortOrder = prevSort === field 
        ? (sortOrder === 'asc' ? 'desc' : 'asc')
        : (field === 'name' ? 'asc' : 'desc');
      
      setSortOrder(newSortOrder);
      
      // If switching to stream sorting and we don't have counts yet, load them
      if (field === 'streams' && countriesWithStreamCounts.length === 0 && countries.length > 0) {
        // Use setTimeout to break the synchronous execution
        setTimeout(() => loadCountryStreamCounts(countries), 0);
      }
      
      return newSortBy;
    });
  }, [countries, countriesWithStreamCounts.length, loadCountryStreamCounts, sortOrder]);

  // Fix all the useEffect dependencies
  useEffect(() => {
    // Cancel any pending API calls when component unmounts
    return () => {
      if (debouncedApiCallRef.current) {
        clearTimeout(debouncedApiCallRef.current);
      }
    };
  }, []);
  
  // Initial data loading
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // Tab change handler with proper cleanup
  useEffect(() => {
    // Only reset if tab has actually changed
    if (prevActiveTabRef.current !== activeTab) {
      setSelectedItem(null);
      setSearchQueryRaw('');
      setDebouncedSearch('');
      setPreviewChannels([]);
      setChannels([]);
      setChannelsPage(1);
      setChannelFilterRaw('');
      setDebouncedChannelFilter('');
      setLoading(true);
      
      // Update the ref with current tab
      prevActiveTabRef.current = activeTab;
      
      // Load data for the new tab
      loadData();
    }
  }, [activeTab, loadData]);
  
  // Lazy load stream counts for countries with improved dependency handling
  useEffect(() => {
    if (activeTab === 'countries' && countries.length > 0 && 
        countriesWithStreamCounts.length === 0 && 
        !streamCountsLoading) {
      // Small delay before loading to avoid UI freezes on tab change
      const timerId = setTimeout(() => loadCountryStreamCounts(countries), 300);
      return () => clearTimeout(timerId);
    }
  }, [activeTab, countries, countriesWithStreamCounts.length, loadCountryStreamCounts, streamCountsLoading]);
  
  // Optimized item click handler with useCallback
  const handleItemClick = useCallback(async (item) => {
    if (!item) return;
    
    setSelectedItem(item);
    setLoadingPreview(true);
    setPreviewChannels([]);
    setChannels([]);
    setLoadingChannels(true);
    setChannelsPage(1);
    setChannelFilterRaw('');
    setDebouncedChannelFilter('');
    setStreamsFetched(false);
    setError('');
    
    try {
      // Fetch channels based on selected item type
      let fetchedChannels = [];
      
      if (activeTab === 'countries') {
        console.log('Fetching channels for country:', item.code);
        
        try {
          // Try preferred method first
          fetchedChannels = await getChannelsByCountry(item.code);
          
          // Fall back to filter method if needed
          if (!fetchedChannels || fetchedChannels.length === 0) {
            fetchedChannels = await getChannels({ country: item.code });
          }
        } catch (error) {
          console.error('Error fetching country channels:', error);
        }
      } else if (activeTab === 'categories') {
        fetchedChannels = await getChannels({ category: item.id });
      } else if (activeTab === 'languages') {
        fetchedChannels = await getChannels({ language: item.code });
      }
      
      // Check for channels with missing streams
      const channelsWithStreams = fetchedChannels.filter(channel => channel.url);
      
      if (channelsWithStreams.length === 0 && fetchedChannels.length > 0) {
        setFetchingStreams(true);
        
        try {
          const streams = await getStreams();
          const streamsByChannelId = streams.reduce((acc, stream) => {
            if (!acc[stream.channel]) acc[stream.channel] = [];
            acc[stream.channel].push(stream);
            return acc;
          }, {});
          
          // Efficiently map stream URLs to channels
          fetchedChannels = fetchedChannels.map(channel => {
            const channelStreams = streamsByChannelId[channel.id] || [];
            const bestStream = channelStreams.length > 0 ? channelStreams[0] : null;
            
            if (!bestStream) return channel;
            
            return {
              ...channel,
              url: bestStream.url,
              resolution: bestStream.resolution,
              status: bestStream.status,
              httpReferrer: bestStream.http_referrer,
              userAgent: bestStream.user_agent
            };
          });
          
          setStreamsFetched(true);
        } catch (streamError) {
          console.error('Error fetching streams:', streamError);
        } finally {
          setFetchingStreams(false);
        }
      } else {
        setStreamsFetched(true);
      }
      
      setChannels(fetchedChannels);
      setPreviewChannels(fetchedChannels.slice(0, 12));
      
    } catch (error) {
      console.error('Error loading channels:', error);
      setError(`Failed to load channels for ${item.name}. ${error.message}`);
    } finally {
      setLoadingPreview(false);
      setLoadingChannels(false);
    }
  }, [activeTab]);
  
  // Optimized import handler
  const handleImport = useCallback(async () => {
    if (!selectedItem || importing) return;
    
    try {
      setImporting(true);
      setError('');
      
      // Generate appropriate URL if needed
      let importUrl = selectedItem.url;
      if (!importUrl) {
        // Create URL based on selected item type
        switch (activeTab) {
          case 'countries':
            if (selectedItem.code) {
              importUrl = `https://iptv-org.github.io/iptv/countries/${selectedItem.code.toLowerCase()}.m3u`;
            }
            break;
          case 'categories':
            if (selectedItem.id) {
              importUrl = `https://iptv-org.github.io/iptv/categories/${selectedItem.id.toLowerCase()}.m3u`;
            }
            break;
          case 'languages':
            if (selectedItem.code) {
              importUrl = `https://iptv-org.github.io/iptv/languages/${selectedItem.code.toLowerCase()}.m3u`;
            }
            break;
          default:
            break;
        }
      }
      
      if (importUrl) {
        await savePlaylist(importUrl, getPlaylistTitle(selectedItem));
        setPreviewChannels([]);
        setImportSuccess(true);
      } else {
        throw new Error("Could not generate import URL");
      }
      
      setTimeout(() => setImporting(false), 1500);
    } catch (err) {
      console.error(`Failed to import ${selectedItem.name} playlist:`, err);
      setError(`Failed to import ${selectedItem.name} playlist. Please try again later.`);
      setImporting(false);
    }
  }, [selectedItem, importing, activeTab]);
  
  // Helper function for playlist titles
  const getPlaylistTitle = useCallback((item) => {
    if (!item) return 'Unknown';
    
    switch (activeTab) {
      case 'countries':
        return `${item.name} TV Channels`;
      case 'categories':
        return `${item.name} Channels`;
      case 'languages':
        return `${item.name} Language Channels`;
      default:
        return item.name || 'Playlist';
    }
  }, [activeTab]);
  
  // Optimized logo URL helper
  const getFormattedLogoUrl = useCallback((url) => {
    if (!url) return null;
    return apiClient.getLogoUrl(url);
  }, []);
  
  // Stream refresh function
  const refreshStreams = useCallback(async () => {
    if (!selectedItem || fetchingStreams) return;
    
    setFetchingStreams(true);
    setError('');
    
    try {
      const streams = await getStreams({ forceRefresh: true });
      
      // Efficiently create lookup table for streams
      const streamsByChannelId = {};
      streams.forEach(stream => {
        if (!stream.channel) return;
        if (!streamsByChannelId[stream.channel]) {
          streamsByChannelId[stream.channel] = [];
        }
        streamsByChannelId[stream.channel].push(stream);
      });
      
      // Update channels in one pass
      const updatedChannels = channels.map(channel => {
        const channelStreams = streamsByChannelId[channel.id] || [];
        const bestStream = channelStreams[0] || null;
        
        if (!bestStream) return channel;
        
        return {
          ...channel,
          url: bestStream.url || channel.url,
          resolution: bestStream.resolution || channel.resolution,
          status: bestStream.status || channel.status,
          httpReferrer: bestStream.http_referrer || channel.httpReferrer,
          userAgent: bestStream.user_agent || channel.userAgent
        };
      });
      
      setChannels(updatedChannels);
      setPreviewChannels(updatedChannels.slice(0, 12));
      setStreamsFetched(true);
      
    } catch (error) {
      console.error('Error refreshing streams:', error);
      setError(`Failed to refresh stream data. ${error.message}`);
    } finally {
      setFetchingStreams(false);
    }
  }, [selectedItem, fetchingStreams, channels]);

  // Filter and sort lists - optimized with useMemo
  const currentList = useMemo(() => {
    switch (activeTab) {
      case 'countries': return countries;
      case 'categories': return categories;
      case 'languages': return languages;
      default: return [];
    }
  }, [activeTab, categories, countries, languages]);
  
  // Memoized filtered list
  const filteredList = useMemo(() => {
    if (!debouncedSearch) return currentList;
    
    const query = debouncedSearch.toLowerCase();
    return currentList.filter(item => {
      // More comprehensive search
      return item.name?.toLowerCase().includes(query) || 
             item.code?.toLowerCase().includes(query) ||
             (item.id && String(item.id).toLowerCase().includes(query));
    });
  }, [currentList, debouncedSearch]);
  
  // Optimize memoized sorted list with lodash memoize
  const getSortedList = memoize((filteredList, activeTab, sortBy, sortOrder, countriesWithStreamCounts) => {
    if (!filteredList.length) return [];
    
    return [...filteredList].sort((a, b) => {
      if (activeTab !== 'countries' || sortBy === 'name') {
        return sortOrder === 'asc' 
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      
      if (sortBy === 'code') {
        return sortOrder === 'asc'
          ? a.code.localeCompare(b.code)
          : b.code.localeCompare(a.code);
      }
      
      if (sortBy === 'streams') {
        const countryA = countriesWithStreamCounts.find(c => c.code === a.code) || { streamCount: 0 };
        const countryB = countriesWithStreamCounts.find(c => c.code === b.code) || { streamCount: 0 };
        
        return sortOrder === 'asc'
          ? countryA.streamCount - countryB.streamCount
          : countryB.streamCount - countryA.streamCount;
      }
      
      return 0;
    });
  });

  // Memoized filtered channels
  const filteredChannels = useMemo(() => {
    if (!channels.length) return [];
    if (!debouncedChannelFilter) return channels;
    
    const query = debouncedChannelFilter.toLowerCase();
    return channels.filter(c => {
      // More comprehensive search
      return (c.name && c.name.toLowerCase().includes(query)) || 
             (c.id && String(c.id).toLowerCase().includes(query)) ||
             (c.categories && c.categories.some(cat => cat.toLowerCase().includes(query))) ||
             (c.languages && c.languages.some(lang => lang.toLowerCase().includes(query)));
    });
  }, [channels, debouncedChannelFilter]);
  
  // Memoized sorted and filtered channels with improved sort by stream
  const sortedAndFilteredChannels = useMemo(() => {
    let result = [...filteredChannels];
    
    // Apply sorting
    result = result.sort((a, b) => {
      switch (channelSortBy) {
        case 'name':
          return channelSortOrder === 'asc'
            ? (a.name || '').localeCompare(b.name || '')
            : (b.name || '').localeCompare(a.name || '');
            
        case 'streams':
          // For stream sorting, prioritize channels with URLs
          const aHasStream = !!a.url;
          const bHasStream = !!b.url;
          
          if (aHasStream && !bHasStream) {
            return channelSortOrder === 'asc' ? 1 : -1;
          } else if (!aHasStream && bHasStream) {
            return channelSortOrder === 'asc' ? -1 : 1;
          }
          
          // If both have streams or both don't, sort by resolution quality
          if (aHasStream && bHasStream) {
            const aResolution = a.resolution ? parseInt(a.resolution.replace(/p$/, '')) : 0;
            const bResolution = b.resolution ? parseInt(b.resolution.replace(/p$/, '')) : 0;
            
            if (aResolution && bResolution) {
              return channelSortOrder === 'asc' ? aResolution - bResolution : bResolution - aResolution;
            }
          }
          
          // Fall back to name sorting if resolution comparison fails
          return channelSortOrder === 'asc'
            ? (a.name || '').localeCompare(b.name || '')
            : (b.name || '').localeCompare(a.name || '');
            
        default:
          return 0;
      }
    });
    
    return result;
  }, [filteredChannels, channelSortBy, channelSortOrder]);
  
  // Memoized paginated channels
  const paginatedChannels = useMemo(() => {
    const startIndex = (channelsPage - 1) * channelsPerPage;
    const endIndex = startIndex + channelsPerPage;
    return sortedAndFilteredChannels.slice(startIndex, endIndex);
  }, [sortedAndFilteredChannels, channelsPage, channelsPerPage]);
  
  // Calculate total pages
  const totalPages = useMemo(() => 
    Math.ceil(sortedAndFilteredChannels.length / channelsPerPage),
    [sortedAndFilteredChannels.length, channelsPerPage]
  );
  
  // Pagination handlers
  const nextPage = useCallback(() => {
    if (channelsPage < totalPages) {
      setChannelsPage(prev => prev + 1);
    }
  }, [channelsPage, totalPages]);
  
  const prevPage = useCallback(() => {
    if (channelsPage > 1) {
      setChannelsPage(prev => prev - 1);
    }
  }, [channelsPage]);
  
  // Stream metrics
  const streamMetrics = useMemo(() => {
    const withStreams = channels.filter(channel => channel.url);
    const percentage = channels.length > 0 
      ? Math.round((withStreams.length / channels.length) * 100) 
      : 0;
    
    return {
      channelsWithStreams: withStreams,
      streamAvailabilityPercentage: percentage
    };
  }, [channels]);
  
  // Tab icon helper
  const getTabIcon = useCallback((tab) => {
    switch (tab) {
      case 'countries': return <Globe class="w-5 h-5" />;
      case 'categories': return <Tv2 class="w-5 h-5" />;
      case 'languages': return <BookOpen class="w-5 h-5" />;
      default: return null;
    }
  }, []);

  // Render functions for VirtualList
  const renderCountryItem = useCallback((item, index) => {
    const streamInfo = countriesWithStreamCounts.find(c => c.code === item.code);
    
    return (
      <CountryListItem
        key={`${item.code || item.id || ''}${index}`}
        item={item}
        selectedItem={selectedItem}
        streamInfo={streamInfo}
        loadingStreamCounts={loadingStreamCounts}
        onClick={handleItemClick}
      />
    );
  }, [countriesWithStreamCounts, handleItemClick, loadingStreamCounts, selectedItem]);

  // Adjust virtual list height based on container size
  useEffect(() => {
    if (!listContainerRef.current) return;
    
    const calculateHeight = () => {
      if (!listContainerRef.current) return;
      
      // Get container dimensions
      const containerHeight = listContainerRef.current.clientHeight;
      
      // Account for the stream count loading indicator if present
      let adjustedHeight = containerHeight;
      const loadingIndicator = listContainerRef.current.querySelector('.bg-blue-900\\/30');
      if (loadingIndicator) {
        adjustedHeight -= loadingIndicator.offsetHeight + 12; // height + margin
      }
      
      // Set minimum height to prevent negative values
      setListHeight(Math.max(adjustedHeight, 100));
    };
    
    // Initial calculation
    calculateHeight();
    
    // Create ResizeObserver with proper cleanup
    const resizeObserver = new ResizeObserver(() => {
      calculateHeight();
    });
    
    // Start observing
    resizeObserver.observe(listContainerRef.current);
    
    // Proper cleanup
    return () => {
      resizeObserver.disconnect();
    };
  }, [activeTab, sortBy, loadingStreamCounts]); // Add dependencies to recalculate when relevant states change

  // Optimize fetch error handling for countries
  const loadDataWithErrorHandling = useCallback(async () => {
    try {
      await loadData();
    } catch (err) {
      console.error(`Failed to load ${activeTab} data:`, err);
      setError(`Failed to load ${activeTab}. Please check your connection and try again.`);
      setLoading(false);
    }
  }, [loadData, activeTab]);
  
  // Initial data loading with error handling
  useEffect(() => {
    loadDataWithErrorHandling();
  }, [loadDataWithErrorHandling]);

  // Toggle channel sort function
  const toggleChannelSort = useCallback((field) => {
    setChannelSortBy(prevSort => {
      if (prevSort === field) {
        // If already sorting by this field, toggle direction
        setChannelSortOrder(prevOrder => prevOrder === 'asc' ? 'desc' : 'asc');
        return field;
      } else {
        // New sort field, set default order
        setChannelSortOrder(field === 'name' ? 'asc' : 'desc');
        return field;
      }
    });
  }, []);

  // Add a state for keyboard focus management
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(-1);
  const [keyboardNavigation] = useState(true);

  // Initialize sortedList variable to store the memoized result
  const sortedList = useMemo(() => {
    return getSortedList(filteredList, activeTab, sortBy, sortOrder, countriesWithStreamCounts);
  }, [filteredList, activeTab, sortBy, sortOrder, countriesWithStreamCounts, getSortedList]);

  // Keyboard arrow key navigation handler needs access to sortedList
  const handleKeyboardNavigation = useCallback((e) => {
    // Basic keyboard navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const newIndex = Math.max(0, Math.min(sortedList.length - 1, keyboardFocusIndex + delta));
      setKeyboardFocusIndex(newIndex);
      
      if (sortedList[newIndex]) {
        handleItemClick(sortedList[newIndex]);
      }
    }
  }, [sortedList, keyboardFocusIndex, handleItemClick]);

  // Add state for favorites
  const [favorites, setFavorites] = useState([]);
  
  // Add function to load favorites - should be called in a useEffect
  const loadFavorites = useCallback(async () => {
    try {
      const favs = await getFavorites();
      setFavorites(favs);
    } catch (err) {
      console.error('Failed to load favorites:', err);
    }
  }, []);

  // Check if a channel is a favorite
  const isChannelFavorite = useCallback((channelId) => {
    return favorites.some(fav => fav.id === channelId);
  }, [favorites]);
  
  // Handle toggling favorites
  const handleToggleFavorite = useCallback(async (channel) => {
    try {
      const newStatus = await toggleFavorite(channel);
      
      if (newStatus !== null) {
        setFavorites(prev => {
          if (newStatus) {
            // Add to favorites
            return [...prev, {
              ...channel, 
              addedToFavoritesAt: new Date().toISOString()
            }];
          } else {
            // Remove from favorites
            return prev.filter(fav => fav.id !== channel.id);
          }
        });
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  }, []);
  
  // Load favorites on initial render
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  return (
    <div>
      <div class="mb-8">
        {/* Title and description */}
        <h2 class="text-3xl font-bold mb-4">
          Browse IPTV Playlists
        </h2>
        <p class="text-gray-400 mb-4">
          Browse and import playlists from the iptv-org repository.
          <a
            href="https://github.com/iptv-org/iptv#playlists"
            target="_blank"
            rel="noopener noreferrer"
            class="ml-1 text-blue-400 hover:underline"
          >
            View Source
          </a>
        </p>
        
        {/* Tabs */}
        <div class="flex border-b border-gray-700 mb-6">
          {['countries', 'categories', 'languages'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              class={`flex items-center gap-2 px-4 py-2 -mb-px ${
                activeTab === tab 
                  ? 'border-l border-t border-r rounded-t border-gray-700 text-blue-400 bg-gray-800' 
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab === 'countries' && <Globe class="w-5 h-5" />}
              {tab === 'categories' && <Tv2 class="w-5 h-5" />}
              {tab === 'languages' && <BookOpen class="w-5 h-5" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        
        {/* Search and sorting controls */}
        <div class="flex flex-col md:flex-row gap-3 mb-4">
          <div class="relative flex-grow">
            <input
              type="text"
              id="search-input"
              aria-label={`Search ${activeTab}`}
              placeholder={`Search ${activeTab}...`}
              class="w-full px-4 py-2 bg-gray-800 rounded-lg pl-10"
              value={searchQuery}
              onInput={e => setSearchQuery(e.target.value)}
            />
            <label htmlFor="search-input" class="sr-only">Search {activeTab}</label>
            <Search class="absolute left-3 top-2.5 w-5 h-5 text-gray-400" aria-hidden="true" />
          </div>
          
          {activeTab === 'countries' && (
            <div class="flex gap-2">
              <button
                onClick={() => toggleSort('streams')}
                class={`px-3 py-2 rounded-lg flex items-center gap-1 ${
                  sortBy === 'streams' ? 'bg-blue-600' : 'bg-gray-700'
                }`}
                title="Sort by available streams"
              >
                <Wifi class="w-4 h-4" />
                Streams
                {sortBy === 'streams' && (
                  sortOrder === 'asc' ? <ArrowUp class="w-3 h-3" /> : <ArrowDown class="w-3 h-3" />
                )}
              </button>
              <button
                onClick={() => toggleSort('name')}
                class={`px-3 py-2 rounded-lg flex items-center gap-1 ${
                  sortBy === 'name' ? 'bg-blue-600' : 'bg-gray-700'
                }`}
                title="Sort alphabetically"
              >
                <SortDesc class="w-4 h-4" />
                Name
                {sortBy === 'name' && (
                  sortOrder === 'asc' ? <ArrowUp class="w-3 h-3" /> : <ArrowDown class="w-3 h-3" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div class="bg-red-900/30 border border-red-900 text-red-200 p-4 rounded-lg mb-6 flex items-start gap-2">
          <AlertCircle class="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p class="font-medium">Connection Error</p>
            <p class="whitespace-pre-line">{error}</p>
            {selectedItem && (
              <p class="mt-2 text-sm">You can still try to import the playlist - some channels may work even if the preview fails.</p>
            )}
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div class="grid grid-cols-1 gap-8 md:grid-cols-3">
        {/* Left sidebar */}
        <div 
          ref={listContainerRef}
          class="md:col-span-1 bg-gray-800 rounded-lg p-4 h-[70vh] overflow-hidden"
        >
          {loading ? (
            <div class="flex items-center justify-center h-full">
              <Loader class="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : filteredList.length === 0 ? (
            <div class="text-center py-12">
              <p class="text-gray-400">No {activeTab} found</p>
            </div>
          ) : (
            <div class="h-full">
              {/* Stream count loading indicator */}
              {activeTab === 'countries' && sortBy === 'streams' && loadingStreamCounts && (
                <div class="bg-blue-900/30 text-blue-200 p-2 rounded-lg mb-3 text-sm flex items-center gap-2">
                  <Loader class="w-4 h-4 animate-spin" />
                  <span>Loading stream availability data...</span>
                </div>
              )}
              
              {/* Error state for virtualized list */}
              {!sortedList || sortedList.length === 0 ? (
                <div class="text-center py-12">
                  <p class="text-gray-400">No results to display</p>
                </div>
              ) : (
                <EnhancedVirtualList
                  items={sortedList}
                  height={listHeight} 
                  itemHeight={56}
                  renderItem={renderCountryItem}
                  overscan={5}
                  selectedItem={selectedItem}
                  aria-label={`List of ${activeTab}`}
                  tabIndex={keyboardNavigation ? 0 : undefined}
                  class="focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
                  onItemsRendered={({visibleStartIndex}) => {
                    // Restore keyboard navigation functionality
                    if (keyboardNavigation && visibleStartIndex >= 0) {
                      setKeyboardFocusIndex(visibleStartIndex);
                    }
                  }}
                  onKeyDown={handleKeyboardNavigation}
                />
              )}
            </div>
          )}
        </div>

        {/* Main content area */}
        <div class="md:col-span-2 bg-gray-800 rounded-lg p-6 h-[70vh] overflow-y-auto">
          {!selectedItem ? (
            <div class="flex flex-col items-center justify-center h-full text-center">
              {getTabIcon(activeTab)}
              <h3 class="text-xl font-semibold text-gray-400 mt-4">Select a {activeTab.slice(0, -1)}</h3>
              <p class="text-gray-500 mt-2">
                Choose a {activeTab.slice(0, -1)} from the list to view channels
              </p>
            </div>
          ) : (
            <div>
              {/* Item header with improved flag handling */}
              {activeTab === 'countries' && selectedItem && (
                <div class="mb-6">
                  <div class="flex items-center gap-4">
                    <div class="w-16 h-12 overflow-hidden rounded shadow-lg bg-gray-900 flex items-center justify-center">
                      {selectedItem.code ? (
                        <span 
                          class={`fi fi-${selectedItem.code.toLowerCase()}`}
                          style={{ display: 'block', width: '100%', height: '100%' }}
                          aria-hidden="true"
                        ></span>
                      ) : (
                        <Globe class="w-8 h-8 text-gray-600" />
                      )}
                    </div>
                    <div>
                      <h3 class="text-2xl font-bold flex items-center gap-2">
                        {selectedItem.name} 
                        {selectedItem.code && (
                          <span class="bg-gray-700 text-sm px-2 py-1 rounded">
                            {selectedItem.code.toUpperCase()}
                          </span>
                        )}
                      </h3>
                      <div class="flex items-center gap-2 text-sm text-gray-400 mt-1">
                        <span>{filteredChannels.length} channels available</span>
                        {streamsFetched && (
                          <span class="flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded">
                            {streamMetrics.streamAvailabilityPercentage}% with streams
                            {streamMetrics.channelsWithStreams.length > 0 ? (
                              <Wifi class="w-3 h-3 text-green-500" />
                            ) : (
                              <WifiOff class="w-3 h-3 text-red-500" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {activeTab !== 'countries' && (
                <div class="mb-6">
                  <h3 class="text-2xl font-bold flex items-center gap-2">
                    {selectedItem.name}
                    {activeTab === 'languages' && selectedItem.code && (
                      <span class="bg-gray-700 text-sm px-2 py-1 rounded">
                        {selectedItem.code.toUpperCase()}
                      </span>
                    )}
                  </h3>
                  <div class="flex items-center gap-2 text-sm text-gray-400 mt-1">
                    <span>{filteredChannels.length} channels available</span>
                    {streamsFetched && (
                      <span class="flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded">
                        {streamMetrics.streamAvailabilityPercentage}% with streams
                        {streamMetrics.channelsWithStreams.length > 0 ? (
                          <Wifi class="w-3 h-3 text-green-500" />
                        ) : (
                          <WifiOff class="w-3 h-3 text-red-500" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Channel controls with added channel sorting */}
              <div class="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-700">
                <div class="flex-1 min-w-[200px]">
                  <div class="relative">
                    <input
                      type="text"
                      id="channel-filter-input"
                      aria-label="Filter channels"
                      placeholder="Filter channels..."
                      class="w-full px-4 py-2 bg-gray-700 rounded-lg pl-10 text-sm"
                      value={channelFilter}
                      onInput={e => setChannelFilter(e.target.value)}
                    />
                    <label htmlFor="channel-filter-input" class="sr-only">Filter channels</label>
                    <Search class="absolute left-3 top-2.5 w-4 h-4 text-gray-400" aria-hidden="true" />
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  {/* Channel sort buttons */}
                  <div class="flex gap-1 mr-1 items-center">
                    <button
                      onClick={() => toggleChannelSort('streams')}
                      class={`p-1.5 rounded flex items-center gap-1 text-xs ${
                        channelSortBy === 'streams' ? 'bg-blue-600' : 'bg-gray-700'
                      }`}
                      title="Sort by available streams"
                    >
                      <Wifi class="w-3 h-3" />
                      {channelSortBy === 'streams' && (
                        channelSortOrder === 'asc' ? <ArrowUp class="w-3 h-3" /> : <ArrowDown class="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleChannelSort('name')}
                      class={`p-1.5 rounded flex items-center gap-1 text-xs ${channelSortBy === 'name' ? 'bg-blue-600' : 'bg-gray-700'}`}
                      title="Sort alphabetically"
                    >
                      <SortDesc class="w-3 h-3" />
                      {channelSortBy === 'name' && (
                        channelSortOrder === 'asc' ? <ArrowUp class="w-3 h-3" /> : <ArrowDown class="w-3 h-3" />
                      )}
                    </button>
                  </div>
                
                  <button 
                    onClick={refreshStreams} 
                    disabled={fetchingStreams}
                    title="Refresh stream data" 
                    class={`p-1.5 rounded ${fetchingStreams ? 'bg-blue-800' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    <RefreshCw class={`w-4 h-4 ${fetchingStreams ? 'animate-spin' : ''}`} />
                  </button>
                  
                  <button 
                    onClick={() => setViewMode('grid')}
                    class={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                    title="Grid view"
                  >
                    <Grid class="w-4 h-4" />
                  </button>
                  
                  <button 
                    onClick={() => setViewMode('list')}
                    class={`p-1.5 rounded ${viewMode === 'list' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                    title="List view"
                  >
                    <List class="w-4 h-4" />
                  </button>
                  <span class="text-sm text-gray-400 ml-2">
                    {filteredChannels.length > 0 ? `${(channelsPage - 1) * channelsPerPage + 1}-${Math.min(channelsPage * channelsPerPage, filteredChannels.length)} of ${filteredChannels.length}` : '0 items'}
                  </span>

                  <button 
                    onClick={prevPage} 
                    disabled={channelsPage <= 1}
                    class={`p-1.5 rounded ${channelsPage <= 1 ? 'text-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    &#8592;
                  </button>
                  <button 
                    onClick={nextPage} 
                    disabled={channelsPage >= totalPages}
                    class={`p-1.5 rounded ${channelsPage >= totalPages ? 'text-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    &#8594;
                  </button>
                </div>
                {selectedItem && (
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    class="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm"
                  >
                    {importing ? <RefreshCw class="w-4 h-4 animate-spin" /> : <Plus class="w-4 h-4" />}
                    {importSuccess ? 'Added!' : 'Import Playlist'}
                  </button>
                )}
              </div>

              {/* Channel content area - now using sortedAndFilteredChannels */}
              {loadingChannels ? (
                <div class="bg-gray-800 rounded-lg p-10 flex justify-center">
                  <Loader class="animate-spin w-8 h-8 text-blue-400" />
                </div>
              ) : sortedAndFilteredChannels.length === 0 ? (
                <div class="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
                  <AlertCircle class="w-12 h-12 mx-auto mb-2 text-yellow-500 opacity-70" />
                  <p>No channels found for {selectedItem.name}</p>
                  <p class="text-sm mt-2">Try selecting another {activeTab.slice(0, -1)} or check your connection.</p>
                </div>
              ) : fetchingStreams ? (
                <div class="bg-gray-800/50 rounded-lg p-6 flex justify-center items-center">
                  <div class="text-center">
                    <Loader class="animate-spin w-8 h-8 text-blue-400 mx-auto mb-2" />
                    <p class="text-gray-400">Fetching stream data...</p>
                  </div>
                </div>
              ) : (
                <div className={viewMode === 'grid' ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3" : "flex flex-col gap-2"}>
                  {/* Use optimized rendered components with proper keys and favorites props */}
                  {paginatedChannels.map((channel, index) => (
                    viewMode === 'grid' ? (
                      <ChannelGridItem 
                        key={channel.id || channel.url || index}
                        channel={channel}
                        index={index}
                        isFavorite={isChannelFavorite(channel.id)}
                        onFavoriteToggle={handleToggleFavorite}
                      />
                    ) : (
                      <ChannelListItem
                        key={channel.id || channel.url || index}
                        channel={channel}
                        index={index}
                        isFavorite={isChannelFavorite(channel.id)}
                        onFavoriteToggle={handleToggleFavorite}
                      />
                    )
                  ))}
                </div>
              )}

              {/* Pagination footer */}
              {sortedAndFilteredChannels.length > channelsPerPage && (
                <div class="mt-6 flex justify-between items-center">
                  <button 
                    onClick={prevPage} 
                    disabled={channelsPage <= 1}
                    class={`px-3 py-1.5 rounded ${channelsPage <= 1 ? 'text-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    Previous
                  </button>
                  <span class="text-sm text-gray-400">
                    Page {channelsPage} of {totalPages}
                  </span>
                  <button 
                    onClick={nextPage} 
                    disabled={channelsPage >= totalPages}
                    class={`px-3 py-1.5 rounded ${channelsPage >= totalPages ? 'text-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}