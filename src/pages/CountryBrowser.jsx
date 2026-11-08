import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { route } from 'preact-router';
import { Globe, Search, Loader, AlertCircle, Download, Check, Tv2, BookOpen, RefreshCw, Grid, List, Wifi, WifiOff, ArrowDown, ArrowUp, SortDesc, ChevronRight, ChevronLeft, Heart, Play, ExternalLink } from 'lucide-preact';
import { getPlaylists, savePlaylist, fetchPlaylist, formatLogoUrl } from '../utils/playlist';
import ChannelLogo from '../components/ChannelLogo';
import CountryFlag from '../components/CountryFlag';
import { getCountries, getRegions, getCategories, getLanguagesWithChannels, getChannelsByCountry, getStreams, getChannels, getRawChannels } from '../utils/apiClient';
import * as apiClient from '../utils/apiClient';
import { debounce, throttle } from '../utils/performance';
import { EnhancedVirtualList } from '../components/EnhancedVirtualList';
import { useNavState } from '../utils/historyManager';
import { getFavorites, toggleFavorite } from '../utils/favorites'; // Import favorites utilities
import { watchPath } from '../utils/watchLinks';

const TAB_SINGULAR = { countries: 'country', categories: 'category', languages: 'language' };
const TABS = [
  { id: 'countries', label: 'Countries', icon: Globe },
  { id: 'categories', label: 'Categories', icon: Tv2 },
  { id: 'languages', label: 'Languages', icon: BookOpen },
];
// Region chips shown above the country list (codes from iptv-org regions.json)
const REGION_CHIPS = [
  ['EUR', 'Europe'], ['ASIA', 'Asia'], ['AMER', 'Americas'], ['AFR', 'Africa'],
  ['MIDEAST', 'Middle East'], ['OCE', 'Oceania'],
];

// Neutral count badge from the FigCraft Badge component ("128 channels")
const CountBadge = ({ children }) => (
  <span class="shrink-0 inline-flex items-center h-[22px] px-2 rounded-full bg-white/6 text-[11px] font-semibold text-[var(--color-muted)] whitespace-nowrap">
    {children}
  </span>
);

const formatCount = (n) => Number(n || 0).toLocaleString('en-US');

// Leading visual of a row: flag for countries, VectorCraft icon for categories
const ItemMark = ({ item, kind, size = 'row' }) => {
  const box = size === 'row' ? 'w-7 h-5 rounded-[4px]' : 'w-10 h-7 rounded-[5px]';
  if (kind === 'countries') {
    return (
      <span class={`${box} shrink-0 overflow-hidden ring-1 ring-inset ring-white/15 bg-[var(--color-card-hover)]`}>
        <CountryFlag code={item.code} />
      </span>
    );
  }
  if (kind === 'categories') {
    const px = size === 'row' ? 'w-7 h-7' : 'w-10 h-10';
    return (
      <img src={`/brand/icons/cat-${item.id}.svg`} alt="" class={`${px} shrink-0`}
        onError={(e) => { e.currentTarget.src = '/brand/channel-fallback.svg'; }} />
    );
  }
  return (
    <span class={`${box} shrink-0 flex items-center justify-center bg-violet-500/15 text-[var(--color-lilac)] text-[10px] font-bold uppercase`}>
      {String(item.code || '').slice(0, 3)}
    </span>
  );
};

// CountryRow from the FigCraft design (design/figcraft/code/CountryRow.tsx):
// 56px tall, card fill, hairline edge; hover lifts to card-hover with a violet edge.
const CountryRow = memo(({ item, kind, count, loadingCount, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(item)}
    class="group w-full min-h-14 pl-4 pr-3.5 flex items-center gap-3 rounded-xl text-left bg-[var(--color-card)] border border-[var(--color-hairline)] hover:bg-[var(--color-card-hover)] hover:border-violet-500/40 transition"
  >
    <ItemMark item={item} kind={kind} />
    <span class="flex-1 min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">{item.name}</span>
    {count != null ? (
      <CountBadge>{formatCount(count)} channels</CountBadge>
    ) : loadingCount ? (
      <span class="w-16 h-[22px] rounded-full bg-white/6 animate-pulse" aria-hidden="true" />
    ) : null}
    <ChevronRight class="w-[18px] h-[18px] shrink-0 text-white opacity-35 group-hover:opacity-90 transition-opacity" aria-hidden="true" />
  </button>
));

// "Most channels" card: flag, name and count over a wash of the flag's colours
const FeaturedCountry = ({ item, count, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(item)}
    class="group relative h-[148px] p-5 flex flex-col justify-end gap-3 rounded-2xl overflow-hidden text-left bg-[var(--color-card)] border border-[var(--color-line)] hover:border-violet-500/50 hover:shadow-[var(--shadow-card-hover)] transition"
  >
    <span class="absolute inset-0 opacity-30 group-hover:opacity-40 transition-opacity scale-150 blur-2xl saturate-150 pointer-events-none" aria-hidden="true">
      <CountryFlag code={item.code} />
    </span>
    <span class="absolute inset-0 bg-[linear-gradient(135deg,transparent,rgb(28_27_43/0.55))] pointer-events-none" aria-hidden="true" />
    <span class="relative w-10 h-7 rounded-[5px] overflow-hidden ring-1 ring-inset ring-white/20">
      <CountryFlag code={item.code} />
    </span>
    <span class="relative text-lg md:text-xl font-bold tracking-[-0.005em] text-[var(--color-text)] truncate">{item.name}</span>
    <span class="relative"><CountBadge>{formatCount(count)} channels</CountBadge></span>
  </button>
);

// Heart toggle shared by the grid and list cards
const FavoriteButton = ({ isFavorite, onClick, size = 18 }) => (
  <button
    type="button"
    onClick={onClick}
    class={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition ${
      isFavorite ? 'bg-rose-500/15' : 'hover:bg-white/8'
    }`}
    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    aria-pressed={isFavorite}
  >
    <Heart
      size={size}
      class={isFavorite ? 'text-rose-400 fill-rose-400' : 'text-white opacity-45 group-hover:opacity-100'}
      aria-hidden="true"
    />
  </button>
);

// Small "HD" / "1080p" style tag
const MetaTag = ({ children, title }) => (
  <span class="shrink-0 inline-flex items-center h-5 px-1.5 rounded-md bg-white/6 border border-[var(--color-hairline)] text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide" title={title}>
    {children}
  </span>
);

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const channelLanguage = (channel) => channel.languageNames?.[0] || channel.languages?.[0] || '';

// Channel card in the FigCraft style (see components/ChannelCard.jsx), with a real
// favorite toggle and an "offline" state for channels without a stream.
const ChannelGridItem = memo(({ channel, isFavorite, onFavoriteToggle }) => {
  const logoSrc = channel.logo || apiClient.getLogoUrl(channel.id || channel.name);
  const hasStream = !!channel.url;
  const language = channelLanguage(channel);
  const subtitle = [capitalize(channel.categories?.[0]) || 'General', language].filter(Boolean).join(' · ');

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFavoriteToggle(channel);
  };

  return (
    <div
      class={`channel-card group relative flex items-center gap-3 p-3 min-h-20 rounded-[14px] border border-[var(--color-hairline)] bg-[var(--color-card)] transition ${
        hasStream ? 'hover:bg-[var(--color-card-hover)] hover:border-violet-500/40 hover:shadow-[var(--shadow-card-hover)]' : ''
      }`}
    >
      <a
        href={hasStream ? watchPath(channel, { preferId: true }) : undefined}
        aria-disabled={!hasStream}
        class={`flex items-center gap-3 flex-1 min-w-0 ${hasStream ? '' : 'cursor-default'}`}
      >
        <div class={`relative w-14 h-14 shrink-0 rounded-xl overflow-hidden ${hasStream ? '' : 'grayscale opacity-60'}`}>
          <ChannelLogo
            src={logoSrc}
            name={channel.name}
            alt=""
            imgClass="w-14 h-14 object-contain bg-white/5 p-1.5"
            fallbackClass="w-14 h-14 flex items-center justify-center"
            textClass="text-lg tracking-tight"
          />
          {hasStream && (
            <span class="absolute inset-0 flex items-center justify-center bg-[rgb(18_17_29/0.7)] opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
              <Play size={22} class="text-white fill-white" />
            </span>
          )}
        </div>
        <div class="flex-1 min-w-0">
          <div class={`text-sm font-semibold truncate ${hasStream ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
            {channel.name || 'Unnamed Channel'}
          </div>
          <div class="flex items-center gap-2 mt-1.5 min-w-0">
            {hasStream ? (
              <span class="live-badge shrink-0">LIVE</span>
            ) : (
              <span class="shrink-0 inline-flex items-center gap-1 h-[22px] px-2 rounded-full bg-white/5 text-[11px] font-semibold text-[var(--color-subtle)]">
                <WifiOff class="w-3 h-3" aria-hidden="true" /> OFFLINE
              </span>
            )}
            <span class="text-xs text-[var(--color-muted)] truncate" title={(channel.languageNames || channel.languages || []).join(', ') || undefined}>
              {subtitle}
            </span>
            {channel.resolution && <MetaTag>{channel.resolution}</MetaTag>}
          </div>
        </div>
      </a>
      <FavoriteButton isFavorite={isFavorite} onClick={handleFavoriteClick} />
    </div>
  );
});

// Compact row for the list view
const ChannelListItem = memo(({ channel, isFavorite, onFavoriteToggle }) => {
  const logoSrc = channel.logo || apiClient.getLogoUrl(channel.id || channel.name);
  const hasStream = !!channel.url;
  const language = channelLanguage(channel);

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFavoriteToggle(channel);
  };

  return (
    <div
      class={`group flex items-center gap-3 px-3 py-2 rounded-xl border border-transparent transition ${
        hasStream ? 'hover:bg-[var(--color-card-hover)] hover:border-violet-500/30' : ''
      }`}
    >
      <a
        href={hasStream ? watchPath(channel, { preferId: true }) : undefined}
        aria-disabled={!hasStream}
        class={`flex items-center gap-3 flex-1 min-w-0 ${hasStream ? '' : 'cursor-default'}`}
      >
        <div class={`w-10 h-10 rounded-lg shrink-0 relative overflow-hidden ${hasStream ? '' : 'grayscale opacity-60'}`}>
          <ChannelLogo
            src={logoSrc}
            name={channel.name}
            alt=""
            imgClass="w-10 h-10 object-contain bg-white/5 p-1"
            fallbackClass="w-10 h-10 flex items-center justify-center"
            textClass="text-xs"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class={`text-sm font-semibold truncate ${hasStream ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
            {channel.name || 'Unnamed Channel'}
          </div>
          <div class="text-xs text-[var(--color-muted)] truncate">
            {[capitalize(channel.categories?.[0]), language].filter(Boolean).join(' · ') || 'General'}
          </div>
        </div>
        {channel.resolution && <MetaTag>{channel.resolution}</MetaTag>}
        {hasStream ? (
          <span class="live-badge shrink-0 hidden sm:inline-flex">LIVE</span>
        ) : (
          <WifiOff class="w-4 h-4 shrink-0 text-[var(--color-subtle)]" aria-label="No stream" />
        )}
      </a>
      <FavoriteButton isFavorite={isFavorite} onClick={handleFavoriteClick} size={16} />
    </div>
  );
});

const STREAM_COUNTS_KEY = 'stream-counts-v2';
const STREAM_COUNTS_TTL = 24 * 60 * 60 * 1000; // as long as the iptv-org data they come from

function readSavedStreamCounts() {
  try {
    const saved = localStorage.getItem(STREAM_COUNTS_KEY);
    const savedAt = parseInt(localStorage.getItem(`${STREAM_COUNTS_KEY}-timestamp`), 10);
    if (saved && Date.now() - savedAt < STREAM_COUNTS_TTL) {
      const counts = JSON.parse(saved);
      if (Array.isArray(counts)) return counts;
    }
  } catch { /* no saved counts */ }
  return [];
}

export default function CountryBrowser() {
  // Remembered per history entry, so Back from the player returns to the same list
  const [activeTab, setActiveTab] = useNavState('activeTab', 'countries');
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useNavState('selectedItem', null);
  const [regionFilter, setRegionFilter] = useNavState('regionFilter', '');
  const [regions, setRegions] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [previewChannels, setPreviewChannels] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  
  // Channel display state
  const [channels, setChannels] = useState([]);
  const [channelsPage, setChannelsPage] = useNavState('channelsPage', 1);
  const [channelsPerPage, setChannelsPerPage] = useState(24);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  
  // Stream fetching state
  const [fetchingStreams, setFetchingStreams] = useState(false);
  const [streamsFetched, setStreamsFetched] = useState(false);
  
  // Country sorting state
  const [sortBy, setSortBy] = useState('streams');
  const [sortOrder, setSortOrder] = useState('desc');
  // Start from the saved counts, so the first paint is already in stream
  // order (instead of A-Z, then re-sorted, downloading flags twice)
  const [countriesWithStreamCounts, setCountriesWithStreamCounts] = useState(readSavedStreamCounts);
  const [loadingStreamCounts, setLoadingStreamCounts] = useState(false);
  
  // Optimization: Use a ref to track if stream counts are already being loaded
  const [streamCountsLoading, setStreamCountsLoading] = useState(false);
  // Load counts automatically only once, so a failed download doesn't retry in a loop
  const streamCountsAttemptedRef = useRef(false);
  
  // Optimization: Cache the batch size for stream count loading
  const STREAM_COUNT_BATCH_SIZE = 10;
  
  // Additional state for channel sorting
  const [channelSortBy, setChannelSortBy] = useState('streams');
  const [channelSortOrder, setChannelSortOrder] = useState('desc');
  const [listHeight, setListHeight] = useState(500);
  const listContainerRef = useRef(null);
  
  // Create debounced versions of search and filter inputs
  const [searchQuery, setSearchQueryRaw] = useNavState('searchQuery', '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [channelFilter, setChannelFilterRaw] = useNavState('channelFilter', '');
  const [debouncedChannelFilter, setDebouncedChannelFilter] = useState(channelFilter);
  // What was on screen when the user left this page (e.g. to open the player)
  const [restoreState] = useState(() => ({ item: selectedItem, page: channelsPage, filter: channelFilter }));
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
          case 'countries': {
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
          }
            
          case 'categories': {
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
          }
            
          case 'languages': {
            // Same caching logic for languages
            let cachedLanguages;
            try {
              const cachedData = localStorage.getItem('cached-languages-v2');
              const cacheTimestamp = localStorage.getItem('cached-languages-v2-timestamp');
              
              if (cachedData && cacheTimestamp) {
                // Counting languages reads channels, streams and feeds, so keep
                // the result as long as that data (24 hours)
                const now = Date.now();
                if (now - parseInt(cacheTimestamp) < 86400000) {
                  cachedLanguages = JSON.parse(cachedData);
                }
              }
            } catch (cacheError) {
              console.warn('Error retrieving languages cache:', cacheError);
            }
            
            if (cachedLanguages && cachedLanguages.length > 0) {
              setLanguages(cachedLanguages);
            } else {
              const languagesList = await getLanguagesWithChannels();
              setLanguages(languagesList);
              
              try {
                localStorage.setItem('cached-languages-v2', JSON.stringify(languagesList));
                localStorage.setItem('cached-languages-v2-timestamp', Date.now().toString());
              } catch (cacheError) {
                console.warn('Error caching languages data:', cacheError);
              }
            }
            break;
          }
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
        
        // Counts don't depend on the sort order, so one entry serves every sort
        const streamCountsCacheKey = STREAM_COUNTS_KEY;
        const cachedCounts = readSavedStreamCounts();
        
        if (cachedCounts && cachedCounts.length > 0) {
          setCountriesWithStreamCounts(cachedCounts);
          setLoadingStreamCounts(false);
          setTimeout(() => setStreamCountsLoading(false), 300);
          return;
        }
        
        // Count channels and playable streams per country in one pass
        const [allChannels, allStreams] = await Promise.all([getRawChannels(), getStreams()]);
        const channelCountry = new Map();
        const channelCounts = {};
        for (const ch of allChannels || []) {
          if (!ch?.country) continue;
          const code = ch.country.toUpperCase();
          channelCountry.set(ch.id, code);
          channelCounts[code] = (channelCounts[code] || 0) + 1;
        }
        const streamCounts = {};
        for (const stream of allStreams || []) {
          const code = stream?.channel && channelCountry.get(stream.channel);
          if (code) streamCounts[code] = (streamCounts[code] || 0) + 1;
        }
        const results = countriesList.map(country => {
          const code = (country.code || '').toUpperCase();
          return {
            code: country.code,
            streamCount: streamCounts[code] || 0,
            channelCount: channelCounts[code] || 0
          };
        });
        setCountriesWithStreamCounts(results);

        // Cache the results (only when we actually got data)
        if (allChannels?.length) {
          try {
            localStorage.setItem(streamCountsCacheKey, JSON.stringify(results));
            localStorage.setItem(`${streamCountsCacheKey}-timestamp`, Date.now().toString());
          } catch (cacheError) {
            console.warn('Error caching stream counts:', cacheError);
          }
        }
      } catch (err) {
        console.error('Error loading country stream counts:', err);
      } finally {
        setStreamCountsLoading(false);
        setLoadingStreamCounts(false);
      }
    }, 500), // Throttle to once every 500ms
    []
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
        !streamCountsLoading && !streamCountsAttemptedRef.current) {
      // Small delay before loading to avoid UI freezes on tab change
      const timerId = setTimeout(() => {
        streamCountsAttemptedRef.current = true;
        loadCountryStreamCounts(countries);
      }, 300);
      return () => clearTimeout(timerId);
    }
  }, [activeTab, countries, countriesWithStreamCounts.length, loadCountryStreamCounts, streamCountsLoading]);
  
  // Optimized item click handler with useCallback
  const handleItemClick = useCallback(async (item) => {
    if (!item) return;
    if (activeTab === 'countries' && item.code) {
      // The player's "Up next" falls back to the last country opened here
      try { sessionStorage.setItem('browse-last-country', JSON.stringify({ code: item.code, name: item.name })); } catch { /* not critical */ }
    }
    
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
          fetchedChannels = await getChannelsByCountry(item.code);
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
  
  // Coming back (browser Back / player Back): reload the channels of the
  // country/category/language that was open, then go back to the same page.
  useEffect(() => {
    if (!restoreState.item) return;
    handleItemClick(restoreState.item).then(() => {
      if (restoreState.page > 1) setChannelsPage(restoreState.page);
      if (restoreState.filter) {
        setChannelFilterRaw(restoreState.filter);
        setDebouncedChannelFilter(restoreState.filter);
      }
    });
  }, []);

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
  // Region chips that exist in regions.json, with the country codes in each
  const regionChips = useMemo(() => REGION_CHIPS
    .map(([code, label]) => {
      const region = regions.find(r => r.code === code);
      return region?.countries?.length
        ? { code, label, countries: new Set(region.countries.map(c => String(c).toUpperCase())) }
        : null;
    })
    .filter(Boolean), [regions]);

  const filteredList = useMemo(() => {
    let list = currentList;
    const region = activeTab === 'countries' && regionFilter
      ? regionChips.find(r => r.code === regionFilter)
      : null;
    if (region) list = list.filter(item => region.countries.has(String(item.code || '').toUpperCase()));
    if (!debouncedSearch) return list;
    
    const query = debouncedSearch.toLowerCase();
    return list.filter(item => {
      // More comprehensive search
      return item.name?.toLowerCase().includes(query) || 
             item.code?.toLowerCase().includes(query) ||
             (item.id && String(item.id).toLowerCase().includes(query));
    });
  }, [currentList, debouncedSearch, activeTab, regionFilter, regionChips]);
  
  // Live-stream count per country code, for sorting and the row badges
  const streamCountByCode = useMemo(() => {
    const map = new Map();
    for (const c of countriesWithStreamCounts) map.set(c.code, c.streamCount);
    return map;
  }, [countriesWithStreamCounts]);

  const sortedList = useMemo(() => {
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
        const countA = streamCountByCode.get(a.code) || 0;
        const countB = streamCountByCode.get(b.code) || 0;
        
        return sortOrder === 'asc' ? countA - countB : countB - countA;
      }
      
      return 0;
    });
  }, [filteredList, activeTab, sortBy, sortOrder, streamCountByCode]);

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
             (c.languages && c.languages.some(lang => lang.toLowerCase().includes(query))) ||
             (c.languageNames && c.languageNames.some(lang => lang.toLowerCase().includes(query)));
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
            
        case 'streams': {
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
            
            if (aResolution !== bResolution) {
              return channelSortOrder === 'asc' ? aResolution - bResolution : bResolution - aResolution;
            }
          }
          
          // Same quality: A-Z
          return (a.name || '').localeCompare(b.name || '');
        }

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

  // Adjust virtual list height based on container size
  useEffect(() => {
    if (!listContainerRef.current) return;
    
    const calculateHeight = () => {
      if (!listContainerRef.current) return;
      
      // Get container dimensions
      const containerHeight = listContainerRef.current.clientHeight;
      
      // Account for the stream count loading indicator if present
      let adjustedHeight = containerHeight;
      const loadingIndicator = listContainerRef.current.querySelector('.stream-count-notice');
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

  // /countries?country=DE (from the player's "Browse Germany" link) opens that country
  const countryParamHandledRef = useRef(false);
  useEffect(() => {
    if (countryParamHandledRef.current || activeTab !== 'countries' || !countries.length) return;
    countryParamHandledRef.current = true;
    const code = new URLSearchParams(window.location.search).get('country');
    if (!code) return;
    const match = countries.find(c => String(c.code).toUpperCase() === code.toUpperCase());
    if (match) handleItemClick(match);
  }, [activeTab, countries, handleItemClick]);

  // Render the list in batches: the first rows paint at once, more are added
  // when the sentinel under the grid scrolls near the viewport
  const LIST_BATCH = 36;
  const [visibleCount, setVisibleCount] = useState(LIST_BATCH);
  const loadMoreRef = useRef(null);
  useEffect(() => {
    setVisibleCount(LIST_BATCH);
  }, [activeTab, regionFilter, debouncedSearch, sortBy, sortOrder]);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) setVisibleCount(n => n + LIST_BATCH);
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, sortedList.length, selectedItem]);

  // "/" focuses the filter field, as hinted by the kbd chip in the design
  const searchInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (!searchInputRef.current) return;
      e.preventDefault();
      searchInputRef.current.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Regions for the filter chips; the page works without them
  useEffect(() => {
    let cancelled = false;
    getRegions()
      .then(list => { if (!cancelled && Array.isArray(list)) setRegions(list); })
      .catch(err => console.warn('Could not load regions:', err));
    return () => { cancelled = true; };
  }, []);

  const singular = TAB_SINGULAR[activeTab] || 'item';
  const iconButton = (active) => `h-9 min-w-9 px-2 rounded-[10px] flex items-center justify-center gap-1 text-xs font-semibold transition ${
    active
      ? 'bg-violet-500/20 text-white ring-1 ring-inset ring-violet-400/50'
      : 'text-[var(--color-muted)] hover:text-white hover:bg-white/8'
  }`;
  const field = 'w-full h-11 pl-11 pr-4 rounded-xl bg-[var(--color-card)] border border-white/8 text-sm text-[var(--color-text)] placeholder:text-[var(--color-subtle)] focus:outline-none focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/25 transition';
  const chipClass = (on) => `shrink-0 h-9 px-4 rounded-full text-[13px] transition ${
    on
      ? 'font-semibold text-white bg-[linear-gradient(135deg,#8b5cf6,#f43f5e)] shadow-[var(--shadow-glow)]'
      : 'text-[var(--color-muted)] bg-white/[0.04] border border-[var(--color-line)] hover:text-white hover:border-violet-400/40'
  }`;
  const pageStart = filteredChannels.length > 0 ? (channelsPage - 1) * channelsPerPage + 1 : 0;
  const pageEnd = Math.min(channelsPage * channelsPerPage, filteredChannels.length);
  const ChannelSortArrow = ({ on }) => (on ? (channelSortOrder === 'asc' ? <ArrowUp class="w-3 h-3" /> : <ArrowDown class="w-3 h-3" />) : null);

  const isCountries = activeTab === 'countries';
  const rowCount = (item) => {
    if (isCountries) return streamCountByCode.get(item.code) ?? null;
    return item.channelCount > 0 ? item.channelCount : null;
  };
  const totalLive = isCountries ? countriesWithStreamCounts.reduce((sum, c) => sum + (c.streamCount || 0), 0) : 0;
  const featured = isCountries && !debouncedSearch && countriesWithStreamCounts.length > 0
    ? [...sortedList]
      .filter(c => streamCountByCode.get(c.code) > 0)
      .sort((a, b) => streamCountByCode.get(b.code) - streamCountByCode.get(a.code))
      .slice(0, 4)
    : [];
  const sortedByCount = sortBy === 'streams';
  const openItem = (item) => {
    handleItemClick(item);
    window.scrollTo({ top: 0 });
  };

  return (
    <div class="pb-8">
      {!selectedItem ? (
        <>
          {/* Header: title + filter, as in the FigCraft screen-browse frame */}
          <div class="flex flex-col lg:flex-row lg:items-end gap-5 mb-6">
            <div class="flex-1 min-w-0">
              <h2 class="text-3xl md:text-4xl font-bold tracking-[-0.015em] text-[var(--color-text)]">
                Browse by {singular}
              </h2>
              <p class="mt-2 text-base text-[var(--color-muted)]">
                {loading ? 'Loading…' : isCountries
                  ? <>{formatCount(countries.length)} countries{totalLive > 0 && <> · {formatCount(totalLive)} live channels</>}. Pick a country to see what’s on.</>
                  : <>{formatCount(currentList.length)} {activeTab}. Pick one to see what’s on.</>}
              </p>
            </div>
            <div class="lg:pb-1">
              <div class="relative w-full sm:w-[360px]">
                <label htmlFor="search-input" class="sr-only">Filter {activeTab}</label>
                <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-white opacity-50 pointer-events-none" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  id="search-input"
                  placeholder={`Filter ${activeTab}`}
                  class={`${field} pr-12`}
                  value={searchQuery}
                  onInput={e => setSearchQuery(e.target.value)}
                />
                <kbd class="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 h-6 min-w-6 px-1.5 items-center justify-center rounded-md border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] font-sans pointer-events-none">/</kbd>
              </div>
            </div>
          </div>

          {/* Region chips, with the country / category / language switch on the right */}
          <div class="flex flex-col-reverse md:flex-row md:items-center gap-3 mb-8">
            {isCountries && regionChips.length > 0 && (
              <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 min-w-0" role="group" aria-label="Filter by region">
                {[{ code: '', label: 'All' }, ...regionChips].map(({ code, label }) => (
                  <button key={code || 'all'} onClick={() => setRegionFilter(code)} aria-pressed={regionFilter === code} class={chipClass(regionFilter === code)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span class="hidden md:block flex-1" />
          <div class="inline-flex p-1 gap-1 rounded-xl bg-[var(--color-card)] border border-white/8 shrink-0" role="tablist" aria-label="Browse by">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                title={`Browse by ${TAB_SINGULAR[id]}`}
                class={`h-9 px-3 rounded-[10px] flex items-center gap-1.5 text-[13px] font-semibold transition ${
                  activeTab === id ? 'bg-white/10 text-white' : 'text-[var(--color-muted)] hover:text-white'
                }`}
              >
                <Icon class="w-4 h-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          </div>

          {error && (
            <div class="bg-rose-500/10 border border-rose-500/30 text-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3">
              <AlertCircle class="w-5 h-5 mt-0.5 shrink-0 text-[var(--color-live)]" />
              <div>
                <p class="font-semibold">Connection error</p>
                <p class="whitespace-pre-line text-sm text-rose-100/80">{error}</p>
              </div>
            </div>
          )}

          {/* Most channels */}
          {featured.length > 0 && (
            <section class="mb-10">
              <h3 class="text-xl font-semibold tracking-[-0.005em] mb-4">Most channels</h3>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {featured.map(item => (
                  <FeaturedCountry key={item.code} item={item} count={streamCountByCode.get(item.code)} onClick={openItem} />
                ))}
              </div>
            </section>
          )}

          {/* All countries */}
          <section>
            <div class="flex items-center gap-3 mb-4">
              <h3 class="text-xl font-semibold tracking-[-0.005em]">All {activeTab}</h3>
              <span class="flex-1" />
              {isCountries ? (
                <button
                  onClick={() => {
                    const next = sortedByCount ? 'name' : 'streams';
                    setSortBy(next);
                    setSortOrder(next === 'name' ? 'asc' : 'desc');
                  }}
                  class="see-all font-semibold"
                >
                  Sort: {sortedByCount ? 'most channels' : 'A–Z'}
                  <ChevronRight class="w-4 h-4 opacity-80" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {loading ? (
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3" aria-busy="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} class="h-14 rounded-xl bg-[var(--color-card)] border border-[var(--color-hairline)] animate-pulse" />
                ))}
              </div>
            ) : sortedList.length === 0 ? (
              <div class="py-12 text-center">
                <img src="/brand/pages/empty-search.svg" alt="" width="320" height="200" class="w-40 h-auto mx-auto mb-3" />
                <p class="text-[var(--color-muted)]">No {activeTab} found</p>
                {(regionFilter || searchQuery) && (
                  <button onClick={() => { setRegionFilter(''); setSearchQuery(''); }} class="see-all mt-2">Clear filters</button>
                )}
              </div>
            ) : (
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
                {sortedList.slice(0, visibleCount).map(item => (
                  <CountryRow
                    key={item.code || item.id}
                    item={item}
                    kind={activeTab}
                    count={rowCount(item)}
                    loadingCount={isCountries && loadingStreamCounts}
                    onClick={openItem}
                  />
                ))}
              </div>
            )}
            {!loading && sortedList.length > visibleCount && (
              <div ref={loadMoreRef} class="flex justify-center pt-6">
                <button onClick={() => setVisibleCount(n => n + LIST_BATCH)} class="btn btn-secondary">
                  Show more ({sortedList.length - visibleCount})
                </button>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {/* Selected country / category / language */}
          <button onClick={() => setSelectedItem(null)} class="see-all font-semibold mb-5">
            <ChevronLeft class="w-4 h-4" aria-hidden="true" /> All {activeTab}
          </button>

          <div class="flex flex-col sm:flex-row sm:items-end gap-5 mb-6">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <ItemMark item={selectedItem} kind={activeTab} size="large" />
              <div class="min-w-0">
                <h2 class="text-3xl md:text-4xl font-bold tracking-[-0.015em] truncate">{selectedItem.name}</h2>
                <div class="flex flex-wrap items-center gap-2 mt-2">
                  <CountBadge>{formatCount(filteredChannels.length)} channels</CountBadge>
                  {streamsFetched && (
                    <span class="live-badge">{streamMetrics.streamAvailabilityPercentage}% LIVE</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={handleImport} disabled={importing} class="btn btn-primary self-start sm:self-auto shrink-0 disabled:opacity-70">
              {importing ? <RefreshCw class="w-4 h-4 animate-spin" /> : importSuccess ? <Check class="w-4 h-4" /> : <Download class="w-4 h-4" />}
              {importSuccess ? 'Added to playlists' : 'Import playlist'}
            </button>
          </div>

          {error && (
            <div class="bg-rose-500/10 border border-rose-500/30 text-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3">
              <AlertCircle class="w-5 h-5 mt-0.5 shrink-0 text-[var(--color-live)]" />
              <div>
                <p class="font-semibold">Connection error</p>
                <p class="whitespace-pre-line text-sm text-rose-100/80">{error}</p>
                <p class="mt-2 text-sm text-rose-100/80">You can still try to import the playlist; some channels may work even if the preview fails.</p>
              </div>
            </div>
          )}

          {/* Channel toolbar */}
          <div class="flex flex-wrap items-center gap-2 mb-5">
            <div class="relative flex-1 min-w-[200px] max-w-[360px]">
              <label htmlFor="channel-filter-input" class="sr-only">Filter channels</label>
              <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-white opacity-50 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                id="channel-filter-input"
                placeholder="Filter channels"
                class={field}
                value={channelFilter}
                onInput={e => setChannelFilter(e.target.value)}
              />
            </div>
            <span class="flex-1" />
            <div class="inline-flex p-1 gap-1 rounded-xl bg-[var(--color-card)] border border-[var(--color-hairline)]">
              <button onClick={() => toggleChannelSort('streams')} class={iconButton(channelSortBy === 'streams')} title="Sort by available streams" aria-label="Sort by available streams" aria-pressed={channelSortBy === 'streams'}>
                <Wifi class="w-4 h-4" /> <ChannelSortArrow on={channelSortBy === 'streams'} />
              </button>
              <button onClick={() => toggleChannelSort('name')} class={iconButton(channelSortBy === 'name')} title="Sort alphabetically" aria-label="Sort alphabetically" aria-pressed={channelSortBy === 'name'}>
                <SortDesc class="w-4 h-4" /> <ChannelSortArrow on={channelSortBy === 'name'} />
              </button>
            </div>
            <div class="inline-flex p-1 gap-1 rounded-xl bg-[var(--color-card)] border border-[var(--color-hairline)]">
              <button onClick={() => setViewMode('grid')} class={iconButton(viewMode === 'grid')} title="Grid view" aria-label="Grid view" aria-pressed={viewMode === 'grid'}>
                <Grid class="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('list')} class={iconButton(viewMode === 'list')} title="List view" aria-label="List view" aria-pressed={viewMode === 'list'}>
                <List class="w-4 h-4" />
              </button>
              <button onClick={refreshStreams} disabled={fetchingStreams} class={iconButton(false)} title="Refresh stream data" aria-label="Refresh stream data">
                <RefreshCw class={`w-4 h-4 ${fetchingStreams ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Channels */}
          {loadingChannels ? (
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} class="h-20 rounded-[14px] bg-[var(--color-card)] border border-[var(--color-hairline)] animate-pulse" />
              ))}
            </div>
          ) : sortedAndFilteredChannels.length === 0 ? (
            <div class="py-10 text-center">
              <img src="/brand/pages/empty-search.svg" alt="" width="320" height="200" class="w-40 h-auto mx-auto mb-3" />
              <p class="font-semibold">No channels found for {selectedItem.name}</p>
              <p class="text-sm mt-1 text-[var(--color-muted)]">Try another {singular}, clear the filter, or check your connection.</p>
            </div>
          ) : fetchingStreams ? (
            <div class="py-10 flex flex-col items-center text-[var(--color-muted)]">
              <Loader class="animate-spin w-7 h-7 text-[var(--color-lilac)] mb-2" />
              <p>Fetching stream data…</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginatedChannels.map((channel, index) => (
                <ChannelGridItem
                  key={channel.id || channel.url || index}
                  channel={channel}
                  isFavorite={isChannelFavorite(channel.id)}
                  onFavoriteToggle={handleToggleFavorite}
                />
              ))}
            </div>
          ) : (
            <div class="flex flex-col gap-0.5 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-card)] p-1.5">
              {paginatedChannels.map((channel, index) => (
                <ChannelListItem
                  key={channel.id || channel.url || index}
                  channel={channel}
                  isFavorite={isChannelFavorite(channel.id)}
                  onFavoriteToggle={handleToggleFavorite}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {sortedAndFilteredChannels.length > channelsPerPage && (
            <div class="mt-6 flex items-center justify-between gap-3">
              <button onClick={prevPage} disabled={channelsPage <= 1} class="btn btn-secondary disabled:opacity-40 disabled:pointer-events-none">
                <ChevronLeft class="w-4 h-4" /> Previous
              </button>
              <span class="text-sm text-[var(--color-muted)] text-center">
                {pageStart}–{pageEnd} <span class="text-[var(--color-subtle)]">of {filteredChannels.length}</span>
              </span>
              <button onClick={nextPage} disabled={channelsPage >= totalPages} class="btn btn-secondary disabled:opacity-40 disabled:pointer-events-none">
                Next <ChevronRight class="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
