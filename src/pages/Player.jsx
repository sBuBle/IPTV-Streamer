import { h } from 'preact';
import { useEffect, useRef, useState, useCallback, useMemo } from 'preact/hooks'; // Add useMemo import
import { route } from 'preact-router';
import Hls from 'hls.js';
import { ArrowLeft, Loader, Heart, AlertTriangle, RefreshCw, Globe, Info,
         PlayCircle, PauseCircle, Volume2, VolumeX, Maximize, Minimize,
         Settings, BarChart2, PictureInPicture, Radio, Tv2, Settings as SettingsIcon, Gauge } from 'lucide-preact';
import { get, set } from '../utils/idbStorage'; // Replace idb-keyval import
import { markStreamAsInvalid, getChannelMetadata, getPlaylists, fetchPlaylist } from '../utils/playlist';
import { getChannelColor, getChannelInitials } from '../utils/logoService';
import { usePictureInPicture } from '../contexts/PictureInPictureContext';
import * as apiClient from '../utils/apiClient';

// Enhance the cleanChannelTitle function to properly handle TVG info
function cleanChannelTitle(title) {
  if (!title) return 'Unnamed Channel';

  // Check if title starts with -1 and contains tvg info (common format in many IPTV lists)
  if (title.startsWith('-1') && title.includes(',')) {
    const parts = title.split(',');
    return parts.slice(1).join(',').trim();
  }

  // Remove tvg tags and metadata
  return title
    .replace(/tvg-[^"]*"[^"]*"/g, '')
    .replace(/group-title="[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\(\d+p\)/g, '')
    .replace(/\s*\|\s*.+$/, '')
    .trim();
}

// Helper to check if URL is a direct stream URL or needs to be resolved
// Optimize isDirectStreamUrl with caching
const urlCache = new Map();

function isDirectStreamUrl(url) {
  if (!url) return false;
  
  // Check cache first
  if (urlCache.has(url)) {
    return urlCache.get(url);
  }
  
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();
    const result = path.endsWith('.m3u8') || path.endsWith('.m3u') || path.endsWith('.ts');
    urlCache.set(url, result);
    return result;
  } catch (e) {
    console.warn('Invalid URL format:', e);
    urlCache.set(url, false);
    return false;
  }
}

// Helper to extract channel ID from URLs or other formats
// Optimize extractChannelId with caching
function extractChannelId(id) {
  if (!id) return null;
  
  // Check cache first
  const cacheKey = `channelId:${id}`;
  if (urlCache.has(cacheKey)) {
    return urlCache.get(cacheKey);
  }
  
  try {
    // Check if it's already a valid URL
    new URL(id);
    urlCache.set(cacheKey, id);
    return id;
  } catch (e) {
    // Not a URL, might be a channel ID
    urlCache.set(cacheKey, id);
    return id;
  }
}

// Add this constant at the top of the file
const DEBUG_PLAYER = false; // Set to true to enable debug logging
const MAX_RETRIES = 3; // Move MAX_RETRIES to the top as a constant

function debugLog(...args) {
  if (DEBUG_PLAYER) {
    console.log('[Player]', ...args);
  }
}

export default function Player({ id }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  // Add missing metadataFetchedRef definition
  const metadataFetchedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [metadata, setMetadata] = useState(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');
  const [similarStreams, setSimilarStreams] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  
  // Move playerState declaration to the top, before any callbacks reference it
  const [playerState, setPlayerState] = useState({
    isPlaying: false,
    isMuted: false,
    volume: (() => {
      try {
        return parseFloat(localStorage.getItem('player-volume') || '1');
      } catch {
        return 1;
      }
    })(),
    showControls: true,
    isFullscreen: false
  });
  
  const [streamUrl, setStreamUrl] = useState(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const { enterPiP, exitPiP, pipVideo } = usePictureInPicture();
  const [debugInfo, setDebugInfo] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  // Add a successfully loaded state to distinguish from general loading
  const [streamLoaded, setStreamLoaded] = useState(false);

  // Add state for tracking current time and duration
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [bufferedProgress, setBufferedProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const progressBarRef = useRef(null);
  const [liveDetectionComplete, setLiveDetectionComplete] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [qualities, setQualities] = useState([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentQuality, setCurrentQuality] = useState(() => {
    try {
      return localStorage.getItem('preferred-quality') || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [isLive, setIsLive] = useState(false);
  
  // Use a ref for stream health to avoid unnecessary re-renders
  const streamHealthRef = useRef({
    droppedFrames: 0,
    latency: 0,
    bufferHealth: 100,
    quality: null,
    bitrate: 0
  });
  
  // Create a separate state for streamHealth since it's referenced in the UI
  const [streamHealth, setStreamHealth] = useState(streamHealthRef.current);
  
  // Store previous playback state when entering PiP to restore later
  const prevPlaybackRef = useRef(null);

  // Move callback definitions to the top, before any effects that use them
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.error);
    } else {
      videoRef.current.pause();
    }
    setPlayerState(prev => ({...prev, isPlaying: !videoRef.current.paused}));
  }, []);
  
  const handleVolumeChange = useCallback((newVolume) => {
    if (!videoRef.current) return;
    const volume = Math.max(0, Math.min(1, newVolume)); // Clamp between 0 and 1
    setPlayerState(prev => ({...prev, volume}));
    videoRef.current.volume = volume;
    localStorage.setItem('player-volume', volume.toString());
  }, []);
  
  // Add functions to handle volume bar interaction
  const handleVolumeBarClick = useCallback((e) => {
    // Get the click position relative to the volume bar
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    
    // Set the new volume based on click position
    handleVolumeChange(percentage);
  }, [handleVolumeChange]);
  
  const handleVolumeDrag = useCallback(() => {
    // Set up drag handling
    const onMouseMove = (e) => {
      // Get mouse position relative to the volume bar
      const volumeBar = document.querySelector('.volume-bar');
      if (!volumeBar) return;
      
      const rect = volumeBar.getBoundingClientRect();
      const posX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = posX / rect.width;
      
      handleVolumeChange(percentage);
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [handleVolumeChange]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const newMutedState = !playerState.isMuted;
    setPlayerState(prev => ({...prev, isMuted: newMutedState}));
    videoRef.current.muted = newMutedState;
  }, [playerState.isMuted]);
  
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }, []);
  
  const handleUnmute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = false;
    setPlayerState(prev => ({...prev, isMuted: false}));
    setNeedsInteraction(false);
  }, []);
  
  const handleQualityChange = useCallback((levelId) => {
    if (!hlsRef.current) return;
    
    localStorage.setItem('preferred-quality', levelId);
    setCurrentQuality(levelId);
    
    if (levelId === 'auto') {
      hlsRef.current.currentLevel = -1; // Auto
    } else {
      hlsRef.current.currentLevel = parseInt(levelId);
    }
    
    setShowQualityMenu(false);
  }, []);

  // Fix 1: Define the missing handleInvalidStream function early in the component
  const handleInvalidStream = useCallback((reason) => {
    console.warn(`Stream failed to load: ${reason}`);
    
    // Try to determine if this is likely a geo-restriction
    let isGeoRestricted = false;
    let isDNSError = false;
    
    // Check for common DNS resolution errors or geo-blocking signs
    if (reason.includes('ERR_NAME_NOT_RESOLVED') || 
        reason.includes('status 0') ||
        reason.includes('unavailable') ||
        reason.includes('could not be reached')) {
      isDNSError = true;
    }
    
    if (reason.includes('403') || 
        reason.includes('451') || 
        reason.includes('geo') || 
        reason.includes('restricted') ||
        reason.includes('not available in your region')) {
      isGeoRestricted = true;
    }
    
    // Set customized user-friendly error message based on error type
    let userMessage = 'Stream failed to load';
    let detailedMessage = '';
    
    try {
      const hostname = new URL(decodeURIComponent(id)).hostname;
      
      if (isDNSError) {
        userMessage = `Stream server not found`;
        detailedMessage = `The server ${hostname} couldn't be reached. This channel may no longer be active or its address has changed.`;
      } else if (isGeoRestricted) {
        userMessage = `Stream may be geo-restricted`;
        detailedMessage = `The channel at ${hostname} appears to be geo-restricted and may not be available in your region.`;
      } else {
        userMessage = `Stream failed to load`;
        detailedMessage = `There was a problem loading the stream from ${hostname}. ${reason}`;
      }
    } catch (e) {
      // Fallback if URL parsing fails
      userMessage = `Stream failed to load: ${reason}`;
      detailedMessage = `The stream could not be loaded. This could be due to the channel being offline, geo-restricted, or a network issue.`;
    }
    
    setError(userMessage);
    setErrorDetails(detailedMessage);
    setLoading(false);
  }, [id]);

  // Fix 2: Optimize retry logic
  const retryStream = useCallback(() => {
    if (retryCount < MAX_RETRIES) {
      setError('');
      setErrorDetails('');
      setLoading(true);
      setRetryCount(prev => prev + 1);
    } else {
      setError('Stream failed after multiple attempts. Please try again later.');
    }
  }, [retryCount, MAX_RETRIES]);

  // Fix 3: Improve findSimilarStreams to use proper error handling
  const findSimilarStreams = useCallback(async (channel) => {
    if (!channel || !channel.name || loadingSimilar) return;
    
    setLoadingSimilar(true);
    setSimilarStreams([]);
    
    try {
      // First check if we have other streams for this channel in our playlists
      const playlists = await getPlaylists();
      const allStreams = [];
      
      // Limit the number of playlists we check to avoid performance issues
      const playlistsToCheck = playlists.slice(0, 5);
      
      for (const playlist of playlistsToCheck) {
        try {
          const playlistData = await get(`channels_${playlist.id}`);
          if (playlistData && Array.isArray(playlistData)) {
            const similarInPlaylist = playlistData.filter(item => {
              // Match by name with some fuzzy matching
              return item.name && channel.name && 
                     (item.name.toLowerCase().includes(channel.name.toLowerCase()) ||
                      channel.name.toLowerCase().includes(item.name.toLowerCase()));
            });
            
            allStreams.push(...similarInPlaylist);
          }
        } catch (err) {
          console.warn(`Failed to check playlist ${playlist.name} for similar streams:`, err);
        }
      }
      
      // Deduplicate streams and limit to reasonable number
      const uniqueStreams = allStreams
        .filter((stream, index, self) => 
          index === self.findIndex(s => s.id === stream.id))
        .slice(0, 5);
        
      setSimilarStreams(uniqueStreams);
    } catch (err) {
      console.error('Failed to find similar streams:', err);
    } finally {
      setLoadingSimilar(false);
    }
  }, [loadingSimilar]);

  // Clean up any resources on unmount
  useEffect(() => {
    return () => {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
      }
      // Clean up HLS if it exists
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (e) {
          console.error("Error destroying HLS instance", e);
        }
        hlsRef.current = null;
      }
      // Clear any pending timeouts
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Main effect for resolving and loading the stream
  useEffect(() => {
    if (!id) return;
    
    let timeoutId = null;
    let isMounted = true;
    // Create a proper object reference instead of a boolean
    const autoplayRef = { value: false };
    
    const resolveAndLoadStream = async () => {
      try {
        setError('');
        setLoading(true);
        
        // Decode the input URL/ID
        const decodedId = decodeURIComponent(id);
        
        // Check if this is a direct m3u8/m3u URL or needs to be resolved
        let finalStreamUrl = decodedId;
        let channelData = null;
        
        if (!isDirectStreamUrl(decodedId)) {
          console.log('Not a direct stream URL, attempting to resolve from API:', decodedId);
          
          // First, check if this is a channel ID we can get from the API
          const channelId = extractChannelId(decodedId);
          
          if (channelId) {
            // Try to get channel details from API
            try {
              // Try to look up channel by ID first
              channelData = await apiClient.getChannelDetails(channelId);
              
              // If that fails, try by name
              if (!channelData) {
                channelData = await apiClient.findChannel(channelId);
              }
              
              if (channelData?.url) {
                console.log('Found stream URL from API:', channelData.url);
                finalStreamUrl = channelData.url;
                
                // Update the channel state with API data
                if (channelData && isMounted) {
                  setChannel({
                    id: finalStreamUrl,
                    name: channelData.name || 'Unknown Channel',
                    logo: channelData.logo,
                    group: channelData.group || channelData.category,
                    channelId: channelData.id
                  });
                }
              } else {
                console.warn('Channel found in API but no stream URL:', channelData);
                setError('Channel found but no stream URL available');
                setLoading(false);
                return;
              }
            } catch (err) {
              console.error('Error resolving stream URL from API:', err);
              setError('Could not find stream URL for this channel');
              setLoading(false);
              return;
            }
          }
        }
        
        if (isMounted) {
          setStreamUrl(finalStreamUrl);
          
          // Continue with the original channel loading logic
          // Pass the autoplayRef object
          loadChannelDetails(finalStreamUrl, channelData, timeoutId, autoplayRef);
          
          // Start a timer to detect if stream doesn't load
          timeoutId = setTimeout(() => {
            if (isMounted && loading && !error) {
              handleInvalidStream('Stream timed out after 25 seconds');
            }
          }, 25000);
        }
      } catch (err) {
        console.error('Error resolving stream:', err);
        if (isMounted) {
          setError('Error loading stream: ' + (err.message || 'Unknown error'));
          setLoading(false);
        }
      }
    };
    
    // Start the resolution process
    resolveAndLoadStream();
    
    // Cleanup function
    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [id]);

  // Updated version of loadChannelDetails to properly handle the autoplayRef
  const loadChannelDetails = useCallback(async (streamUrl, apiChannelData = null, timeoutId = null, autoplayRef = null) => {
    try {
      if (!streamUrl) {
        setError('Invalid stream URL');
        setLoading(false);
        return;
      }
      
      // Try to find channel info from previously viewed channels
      const history = await get('watchHistory') || [];
      const historyItem = history.find(item => item.channel.id === streamUrl);
      
      // Check if it's in favorites - might have better data
      const favorites = await get('favorites') || [];
      const favoriteItem = favorites.find(fav => fav.id === streamUrl);
      
      // Get the most reliable name source: prioritize API > favorites > history > URL parsing
      let channelName = null;
      let channelGroup = "Uncategorized";
      let channelLogo = null;
      let channelId = null;
      
      // Use API data if available (highest priority)
      if (apiChannelData) {
        channelName = apiChannelData.name;
        channelGroup = apiChannelData.category || apiChannelData.group || "Uncategorized";
        channelLogo = apiChannelData.logo;
        channelId = apiChannelData.id;
      }
      
      // Then try favorite data
      if (favoriteItem) {
        channelName = channelName || favoriteItem.name;
        channelGroup = channelGroup === "Uncategorized" ? favoriteItem.group || channelGroup : channelGroup;
        channelLogo = channelLogo || favoriteItem.logo;
        channelId = channelId || favoriteItem.channelId || favoriteItem.id;
      } 
      
      // Then try history data
      if (historyItem?.channel) {
        channelName = channelName || historyItem.channel.name;
        channelGroup = channelGroup === "Uncategorized" ? historyItem.channel.group || channelGroup : channelGroup;
        channelLogo = channelLogo || historyItem.channel.logo;
        channelId = channelId || historyItem.channel.channelId || historyItem.channel.id;
      }
      
      // If we still don't have a name, try to extract it from the URL
      if (!channelName || channelName === "Unknown Channel") {
        try {
          const urlObj = new URL(streamUrl);
          // Get the last part of path and remove file extension
          const pathParts = urlObj.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) {
            const lastPart = pathParts[pathParts.length - 1];
            // Remove extension and transform to readable format
            channelName = lastPart
              .replace(/\.(m3u8|ts|mp4|mpeg)$/i, '')
              .replace(/[-_.]/g, ' ')
              // More aggressive cleaning to get a nicer channel name
              .replace(/\d+kbps/i, '')
              .replace(/\d+p/i, '')
              .replace(/\bhigh\b|low\b|mid\b|sd\b|hd\b|fhd\b|uhd\b/i, '')
              .trim()
              .replace(/\b\w/g, c => c.toUpperCase()); // Capitalize first letter of each word
            
            // If hostname contains known providers, use as group
            if (urlObj.hostname.includes('iptv') || 
                urlObj.hostname.includes('tv') || 
                urlObj.hostname.includes('stream')) {
              channelGroup = urlObj.hostname.split('.')[0].toUpperCase();
            }
          }
        } catch (e) {
          console.warn("Could not parse URL for channel name", e);
          // Set fallback name if everything else fails
          channelName = channelName || "Channel " + Math.floor(Math.random() * 1000);
        }
      }
      
      // Create channel object with best available data
      const channelData = {
        id: streamUrl,
        name: channelName,
        channelId: channelId,
        group: channelGroup,
        logo: channelLogo
      };
      
      // Set channel state
      setChannel(channelData);
      setIsFavorite(favorites.some(fav => fav.id === streamUrl));
      
      // Update watch history entry with the best channel name information
      const newHistoryItem = {
        timestamp: Date.now(),
        channel: channelData
      };
      
      // Update watch history (limit to 100 items)
      const updatedHistory = [
        newHistoryItem,
        ...history.filter(item => item.channel.id !== streamUrl)
      ].slice(0, 100);
      
      await set('watchHistory', updatedHistory);
      
      // Pass the proper autoplayRef object
      setupHlsPlayer(streamUrl, timeoutId, autoplayRef || { value: false });
      
    } catch (err) {
      console.error('Error setting up channel data:', err);
      setError('Error loading stream: ' + (err.message || 'Unknown error'));
      setLoading(false);
    }
  }, []);

  // Extract HLS setup to a separate function for better organization
  // Fix the HLS setup function to safely use autoplayRef
  // Optimize setupHlsPlayer to use memoized config
  const hlsConfig = useMemo(() => ({
    enableWorker: true,
    lowLatencyMode: true,
    startLevel: -1,
    capLevelToPlayerSize: true,
    debug: false,
    liveDurationInfinity: true,
    liveBackBufferLength: 0,
    // Better mobile experience
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    manifestLoadingTimeOut: 10000,
    fragLoadingTimeOut: 20000,
    // Modified xhrSetup to remove unsafe headers
    xhrSetup: function(xhr) {
      xhr.timeout = 30000; // longer XHR timeout
    },
    // Add a retry mechanism for network errors
    fragLoadingMaxRetry: 5,
    manifestLoadingMaxRetry: 3,
    levelLoadingMaxRetry: 3
  }), []); // Empty dependency array since these options don't depend on props or state

  const setupHlsPlayer = useCallback((streamUrl, timeoutId = null, autoplayRef = null) => {
    if (!streamUrl || !videoRef.current) {
      setError('Invalid stream URL or video element not ready');
      setLoading(false);
      return;
    }
    
    // Ensure autoplayRef is an object with a value property
    const autoplayRefObj = (autoplayRef && typeof autoplayRef === 'object') 
      ? autoplayRef 
      : { value: false };
    
    let autoplayAttempted = false;
    
    // Clean up any existing HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    // Initialize player based on browser support
    if (Hls.isSupported()) {
      const hls = new Hls(hlsConfig); // Use memoized config
      
      hlsRef.current = hls;

      // Set up HLS event listeners
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log("Media attached, attempting to load source");
      });
      
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log("Manifest parsed, ready to play", data);
        
        // Important: Clear the timeout here when manifest is successfully parsed
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        // Mark stream as successfully loaded
        setStreamLoaded(true);
        setLoading(false); // Stream is ready, regardless of autoplay status
        setError(''); // Clear any error that might have been set
        
        autoplayAttempted = true;
        
        // Safely update the autoplayRef
        if (autoplayRefObj && typeof autoplayRefObj === 'object') {
          autoplayRefObj.value = true;
        }
        
        // Quality levels handling
        if (data.levels && data.levels.length > 1) {
          const qualityLevels = data.levels.map((level, index) => ({
            id: index.toString(),
            name: `${level.height || 'Auto'}p ${Math.round((level.bitrate || 0)/1000)} kbps`,
            bitrate: level.bitrate
          }));
          setQualities(qualityLevels);
        }
        
        // Always start muted to bypass autoplay restrictions
        if (videoRef.current) {
          videoRef.current.muted = true;
          setPlayerState(prev => ({...prev, isMuted: true}));
          
          videoRef.current.play()
            .then(() => {
              setPlayerState(prev => ({...prev, isPlaying: true}));
              setNeedsInteraction(true); // Show unmute button since we had to mute
            })
            .catch(err => {
              console.warn("Muted autoplay failed:", err); // Changed to warning level
              setNeedsInteraction(true); // Definitely needs interaction now
            });
        }
      });

      // Enhanced error handler with better CORS detection
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('HLS Error:', data.type, data.details);
        
        // Prevent null reference errors
        if (data.error && typeof data.error === 'object') {
          console.error('Error details:', data.error.message || 'Unknown error');
        }
        
        // Don't set error if stream is already playing successfully
        if (streamLoaded && videoRef.current && !videoRef.current.paused) {
          console.log('Ignoring error, stream is already playing');
          return;
        }
        
        // Check specifically for CORS issues
        const isCorsError = 
          data.response?.code === 0 || 
          (data.response && data.response.text && data.response.text.includes('CORS')) ||
          (data.error && (data.error.message || '').includes('CORS')) ||
          data.type === 'networkError' && data.details === 'manifestLoadError';
          
        if (isCorsError) {
          console.error("CORS error detected. The stream provider doesn't allow direct playback from this domain.");
          
          // Try to use a CORS proxy if configured
          const corsProxyEnabled = false; // We could add this as a setting
          const corsProxy = ''; // Configure a CORS proxy URL if needed
          
          if (corsProxyEnabled && corsProxy && !streamUrl.includes(corsProxy)) {
            console.log('Attempting to use CORS proxy for stream');
            // We could implement proxy URL transformation here
            // But that would be a future feature
          } else {
            setErrorDetails(
              "This stream doesn't allow playback from this website due to CORS restrictions. " +
              "Try using a native player or browser extension to access this content."
            );
            setError("Stream access restricted (CORS policy)");
            setLoading(false);
          }
          return;
        }
        
        // Handle internal exceptions specially to avoid cryptic errors
        if (data.type === 'otherError' && data.details === 'internalException') {
          console.error('HLS internal exception:', data.error);
          
          // Attempt recovery based on the specific error
          if (data.error && data.error.message && 
             (data.error.message.includes('autoplayAttempted') || 
              data.error.message.includes('undefined'))) {
            
            // This is likely our autoplayAttempted reference error
            console.log('Attempting to recover from reference error');
            
            // We'll try to restart the player with a delay
            setTimeout(() => {
              if (hlsRef.current) {
                try {
                  hlsRef.current.stopLoad();
                  hlsRef.current.loadSource(streamUrl);
                  hlsRef.current.startLoad();
                } catch (e) {
                  console.error('Recovery failed:', e);
                  handleInvalidStream('Failed to recover from internal exception');
                }
              }
            }, 1000);
            return;
          }
        }
        
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // For network errors, try to recover
              console.warn('Fatal network error, trying to recover');
              
              // Don't set error if it's just a transient network issue during initial loading
              if (loading && !autoplayAttempted) {
                console.log("Network error during initial load, attempting recovery");
                try {
                  hls.startLoad();
                } catch (e) {
                  console.error('Failed to restart loading:', e);
                }
                return;
              }
              
              // Check for specific network error types
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                const errorDetails = data.response ? 
                  `Server responded with ${data.response.code} (${data.response.text})` : 
                  'Name resolution failed or server unreachable';
                
                setErrorDetails(`Network error: ${errorDetails}`);
                
                // Only give up completely if we've tried multiple times
                if (retryCount > 0 && 
                    (data.networkDetails?.status === 0 || 
                     data.networkDetails?.statusText === '' || 
                     data.response?.text?.includes('ERR_NAME_NOT_RESOLVED'))) {
                  handleInvalidStream(`Stream unavailable: The server ${
                    new URL(streamUrl).hostname
                  } couldn't be reached. This channel may no longer be active.`);
                  return;
                }
              }
              
              // Try to recover by restarting load
              try {
                hls.startLoad();
              } catch (e) {
                console.error('Failed to restart loading after network error:', e);
                handleInvalidStream('Failed to restart stream after network error');
              }
              break;
              
            case Hls.ErrorTypes.MEDIA_ERROR:
              // For media errors, try to recover
              console.warn('Fatal media error, trying to recover');
              try {
                hls.recoverMediaError();
              } catch (e) {
                console.error('Media error recovery failed:', e);
                handleInvalidStream('Failed to recover from media error');
              }
              break;
              
            default:
              // For other fatal errors, give up and report an invalid stream
              console.error('Unrecoverable HLS error:', data);
              handleInvalidStream(`Fatal streaming error: ${data.details}`);
              break;
          }
        }
      });

      // Initialize playback with better error handling
      try {
        console.log("Loading HLS source:", streamUrl);
        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);
        
        // Set initial volume
        videoRef.current.volume = playerState.volume;
      } catch (err) {
        console.error("Error initializing HLS:", err);
        handleInvalidStream(`Failed to initialize player: ${err.message}`);
      }
    } else if (videoRef.current && videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // For Safari/iOS with better error handling
      try {
        // Add a listener to detect CORS issues in Safari
        const handleError = (e) => {
          console.error("Safari video error:", e);
          if (videoRef.current.error) {
            const errorCode = videoRef.current.error.code;
            // MEDIA_ERR_SRC_NOT_SUPPORTED or MEDIA_ERR_NETWORK
            if (errorCode === 4 || errorCode === 2) {
              handleInvalidStream("Safari cannot load this stream. It may be due to CORS restrictions or an invalid URL.");
            } else {
              handleInvalidStream(`Safari error code: ${errorCode}`);
            }
          }
        };

        videoRef.current.addEventListener('error', handleError);
        videoRef.current.src = streamUrl;
        
        const onLoadedMetadata = () => {
          // Clear timeout here too
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          // Mark stream as successfully loaded
          setStreamLoaded(true);
          setLoading(false);
          setError(''); // Clear any error that might have been set
          
          autoplayAttempted = true;
          
          // Safely update the autoplayRef
          if (autoplayRefObj && typeof autoplayRefObj === 'object') {
            autoplayRefObj.value = true;
          }
          
          // Always start muted to bypass autoplay restrictions
          videoRef.current.muted = true;
          setPlayerState(prev => ({...prev, isMuted: true}));
          
          videoRef.current.play()
            .then(() => {
              setPlayerState(prev => ({...prev, isPlaying: true}));
              setNeedsInteraction(true); // Show unmute button
            })
            .catch((err) => {
              console.warn("Safari muted autoplay failed:", err);
              setNeedsInteraction(true);
            });
        };
        
        videoRef.current.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        
        // Cleanup
        return () => {
          videoRef.current?.removeEventListener('error', handleError);
          videoRef.current?.removeEventListener('loadedmetadata', onLoadedMetadata);
        };
      } catch (err) {
        console.error("Error setting up native playback:", err);
        handleInvalidStream(`Failed to setup native playback: ${err.message}`);
      }
    } else {
      setError("Your browser doesn't support HLS playback");
      setLoading(false);
    }
  }, [hlsConfig, playerState.volume, handleInvalidStream]);
  
  // Fix 6: Improve/fix the metadata effect to prevent unnecessary fetches
  useEffect(() => {
    if (!id || !channel || metadataFetchedRef.current || loadingMetadata) return;
    
    const channelId = channel.id;
    let isMounted = true;
    
    async function fetchMetadata() {
      if (!isMounted) return;
      
      setLoadingMetadata(true);
      
      try {
        const streamUrl = decodeURIComponent(id);
        console.log(`Fetching metadata for channel: ${channel.name}, ID: ${streamUrl}`);
        
        // Get the playlist data for the channel first - this is the most accurate source
        const playlists = await getPlaylists();
        let playlistMetadata = null;
        
        // Search through available playlists for the channel
        for (const playlist of playlists) {
          try {
            const playlistContent = await fetchPlaylist(playlist.url);
            const channelInPlaylist = playlistContent.segments?.find(segment => 
              segment.uri === streamUrl || streamUrl.includes(segment.uri)
            );
            
            if (channelInPlaylist) {
              console.log("Found channel in playlist:", channelInPlaylist.title);
              
              // Extract TVG info from raw title if it contains the format
              let tvgId, tvgLogo, groupTitle;
              
              // Handle the raw title format: -1 tvg-id="X" tvg-logo="Y" group-title="Z",CHANNEL NAME
              if (channelInPlaylist.title && channelInPlaylist.title.startsWith('-1')) {
                const titleParts = channelInPlaylist.title.split(',');
                if (titleParts.length > 1) {
                  const attrPart = titleParts[0];
                  const channelName = titleParts.slice(1).join(',').trim();
                  
                  // Extract tvg-id
                  const idMatch = attrPart.match(/tvg-id="([^"]*)"/);
                  if (idMatch) tvgId = idMatch[1];
                  
                  // Extract tvg-logo
                  const logoMatch = attrPart.match(/tvg-logo="([^"]*)"/);
                  if (logoMatch) tvgLogo = logoMatch[1];
                  
                  // Extract group-title
                  const groupMatch = attrPart.match(/group-title="([^"]*)"/);
                  if (groupMatch) groupTitle = groupMatch[1];
                  
                  playlistMetadata = {
                    name: channelName,
                    logo: tvgLogo || channelInPlaylist.attributes?.['tvg-logo'],
                    group: groupTitle || channelInPlaylist.attributes?.['group-title'],
                    tvgId: tvgId || channelInPlaylist.attributes?.['tvg-id'],
                    country: channelInPlaylist.attributes?.['tvg-country'],
                    languages: channelInPlaylist.attributes?.['tvg-language']?.split(',')
                  };
                }
              } else {
                // Use the standard attributes
                playlistMetadata = {
                  name: cleanChannelTitle(channelInPlaylist.title),
                  logo: channelInPlaylist.attributes?.['tvg-logo'],
                  group: channelInPlaylist.attributes?.['group-title'],
                  tvgId: channelInPlaylist.attributes?.['tvg-id'],
                  country: channelInPlaylist.attributes?.['tvg-country'],
                  languages: channelInPlaylist.attributes?.['tvg-language']?.split(',')
                };
              }
              
              // If we found it, no need to search more playlists
              break;
            }
          } catch (err) {
            console.warn("Error searching playlist:", err);
          }
        }
        
        // Continue with the regular metadata lookup process as before
        let channelMeta = playlistMetadata || null;
        
        // Only continue API lookups if we didn't find anything in playlist
        if (!channelMeta) {
          try {
            // First try finding by channel ID if available
            if (channel.channelId) {
              channelMeta = await apiClient.findChannel(channel.channelId);
              console.log("Metadata found by channel ID:", channelMeta ? "yes" : "no");
            }
            
            // If not found by ID, try finding by name
            if (!channelMeta && channel.name) {
              channelMeta = await apiClient.findChannel(channel.name);
              console.log("Metadata found by name:", channelMeta ? "yes" : "no");
            }
            
            // If still not found, try a channel details lookup
            if (!channelMeta && channel.id) {
              channelMeta = await apiClient.getChannelDetails(channel.id)
                .catch(() => null);
              console.log("Metadata found by details lookup:", channelMeta ? "yes" : "no");
            }
            
            // Fall back to simple metadata service
            if (!channelMeta) {
              channelMeta = await getChannelMetadata(streamUrl);
              console.log("Fallback metadata found:", channelMeta ? "yes" : "no");
            }
          } catch (err) {
            console.warn('Error using API client for metadata:', err);
            try {
              channelMeta = await getChannelMetadata(streamUrl);
              console.log("Secondary fallback metadata found:", channelMeta ? "yes" : "no");
            } catch (metaErr) {
              console.error("All metadata lookup attempts failed:", metaErr);
            }
          }
        }
        
        if (channelMeta) {
          console.log("Setting metadata:", channelMeta);
          setMetadata(channelMeta);
          
          // Create a merged channel object with all available data
          const updatedChannel = {
            ...channel,
            logo: channel.logo || channelMeta.logo, // Prefer existing logo if we have it
            name: channel.name || channelMeta.name, // Prefer existing name if we have it
            languages: channelMeta.languages || channel.languages,
            country: channelMeta.country || channel.country,
            categories: channelMeta.categories || channel.categories,
            website: channelMeta.website || channel.website
          };
          
          // Update in watch history with improved error handling
          try {
            const history = await get('watchHistory') || [];
            const updatedHistory = history.map(item => {
              if (item.channel?.id === streamUrl) {
                return {
                  ...item,
                  channel: updatedChannel
                };
              }
              return item;
            });
            
            await set('watchHistory', updatedHistory);
          } catch (historyError) {
            console.warn('Failed to update watch history with metadata:', historyError);
          }
          
          // If it's in favorites, update there too
          try {
            if (isFavorite) {
              const favorites = await get('favorites') || [];
              const updatedFavorites = favorites.map(fav => {
                if (fav.id === streamUrl) {
                  return {
                    ...fav,
                    ...updatedChannel,
                    // Ensure these critical properties aren't lost
                    id: fav.id,
                    name: fav.name || updatedChannel.name
                  };
                }
                return fav;
              });
              
              await set('favorites', updatedFavorites);
            }
          } catch (favError) {
            console.warn('Failed to update favorites with metadata:', favError);
          }
          
          // Set the channel in state *without* triggering another metadata fetch
          // by using a function to access the previous state
          setChannel(prev => {
            if (!prev) return updatedChannel;
            return {
              ...prev,
              ...updatedChannel
            };
          });
        } else {
          console.warn("No metadata found for channel:", channel.name);
        }
        
        // Fix to prevent re-fetching on component updates:
        if (isMounted) {
          metadataFetchedRef.current = true;
        }
      } catch (err) {
        console.error("Error in metadata fetching process:", err);
      } finally {
        if (isMounted) {
          setLoadingMetadata(false);
        }
      }
    }
    
    fetchMetadata();
    
    // Fix: Only reset the fetch tracking when ID/channel actually changes
    return () => {
      isMounted = false;
    };
  }, [id, channel?.id, loadingMetadata]);

  // Find similar streams when error occurs
  useEffect(() => {
    if (error && channel) {
      findSimilarStreams(channel);
    }
  }, [error, channel]);

  // Update video playback state when related state changes
  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    video.muted = playerState.isMuted;
    
    const onPlay = () => setPlayerState(prev => ({...prev, isPlaying: true}));
    const onPause = () => setPlayerState(prev => ({...prev, isPlaying: false}));
    const onError = (e) => {
      console.error("Video error:", e);
      if (!error) { // Only set error if we don't already have one
        setError("Video playback error. The stream may be unavailable.");
      }
    };
    
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);
    
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
    };
  }, [playerState.isMuted, error]);

  // Add fullscreen change detection
  useEffect(() => {
    const handleFullscreenChange = () => {
      setPlayerState(prev => ({...prev, isFullscreen: !!document.fullscreenElement}));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Fix 5: Add the PiP toggle function
  // Store previous playback state when entering PiP to restore later
  const handlePictureInPicture = useCallback(() => {
    if (!videoRef.current || !channel) return;
    
    try {
      // Store current playback state
      prevPlaybackRef.current = {
        volume: playerState.volume,
        isMuted: playerState.isMuted,
        currentTime: videoRef.current.currentTime
      };
      
      // Check if channel has necessary properties
      const pipChannelInfo = {
        ...channel,
        // Ensure we have at least these properties
        id: channel.id || streamUrl,
        name: channel.name || 'Unknown Channel'
      };

      // Handle PiP entry with the proper context
      enterPiP(
        pipChannelInfo, 
        streamUrl, 
        {
          volume: playerState.isMuted ? 0 : playerState.volume,
          currentTime: videoRef.current.currentTime,
          isLive: isLive || (videoRef.current.duration === Infinity),
          wasMuted: playerState.isMuted,
          // Add this flag since this is triggered by a user click
          fromUserGesture: true
        }
      );
    } catch (error) {
      console.error("Error entering Picture-in-Picture mode:", error);
    }
  }, [channel, id, streamUrl, enterPiP, playerState.volume, isLive, playerState.isMuted]);

  // Fix 8: Improve controls visibility logic
  useEffect(() => {
    // Shows controls when mouse moves, hides after inactivity
    const handleMouseMove = () => {
      setPlayerState(prev => ({...prev, showControls: true}));
      
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      
      controlsTimeoutRef.current = setTimeout(() => {
        if (playerState.isPlaying) {
          setPlayerState(prev => ({...prev, showControls: false}));
        }
      }, 3000);
    };
    
    if (containerRef.current) {
      containerRef.current.addEventListener('mousemove', handleMouseMove);
      
      return () => {
        if (containerRef.current) {
          containerRef.current.removeEventListener('mousemove', handleMouseMove);
        }
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
      };
    }
  }, [playerState.isPlaying]);

  // Add additional video event listeners to ensure loading state is properly updated
  // Add debouncing to loading state updates to prevent flickering
  const debouncedSetLoading = useCallback((value) => {
    if (value === true) {
      // Set loading immediately when turning on
      setLoading(true);
    } else {
      // Small delay when turning off to prevent flickering
      setTimeout(() => setLoading(false), 100);
    }
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    
    // Helper to ensure loading is set to false and mark stream as loaded
    const handleVideoStarted = () => {
      debouncedSetLoading(false);
      setStreamLoaded(true);
      setPlayerState(prev => ({...prev, isPlaying: true}));
      setError(''); // Clear any error when playback actually starts
    };
    
    // Helper for when stream is ready but autoplay fails
    const handleLoadedData = () => {
      debouncedSetLoading(false); // Stream is loaded, even if not playing yet
      setStreamLoaded(true);
      setError(''); // Clear any error when media data loads
    };
    
    // Multiple events that indicate the video has started playing or is ready
    video.addEventListener('playing', handleVideoStarted);
    video.addEventListener('play', handleVideoStarted);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('loadedmetadata', handleLoadedData);
    
    return () => {
      video.removeEventListener('playing', handleVideoStarted);
      video.removeEventListener('play', handleVideoStarted);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('loadedmetadata', handleLoadedData);
    };
  }, [debouncedSetLoading]);

  // Fix 10: Ensure proper cleanup when toggling favorites
  const toggleFavorite = useCallback(async () => {
    if (!channel) return;
    
    try {
      const favorites = await get('favorites') || [];
      
      if (isFavorite) {
        // Remove from favorites
        await set('favorites', favorites.filter(fav => fav.id !== channel.id));
        setIsFavorite(false);
      } else {
        // Add to favorites
        await set('favorites', [...favorites, channel]);
        setIsFavorite(true);
      }
    } catch (error) {
      console.error('Error toggling favorite status:', error);
    }
  }, [channel, isFavorite]);

  // Add a function to handle seeking
  const handleSeek = useCallback((event) => {
    if (!videoRef.current || isLive) return;
    
    const progressBar = progressBarRef.current;
    if (!progressBar) return;
    
    const rect = progressBar.getBoundingClientRect();
    const clickPosition = event.clientX - rect.left;
    const percentage = clickPosition / rect.width;
    const seekTime = Math.max(0, Math.min(percentage * duration, duration - 0.1));
    
    videoRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
    setProgress((seekTime / duration) * 100);
  }, [duration, isLive]);
  
  // Setup drag handling for the progress bar
  const handleProgressDragStart = useCallback((event) => {
    if (isLive) return;
    setIsDragging(true);
    handleSeek(event);
    
    const onMouseMove = (e) => handleSeek(e);
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [handleSeek, isLive]);
  
  // Format time in MM:SS or HH:MM:SS
  const formatTime = useCallback((time) => {
    if (isNaN(time)) return '00:00';
    
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, []);
  
  // Add effect to update current time and buffer progress with improved detection
  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    let liveCheckIntervalId;
    let trackingStarted = false;
    
    const handleTimeUpdate = () => {
      // Don't update UI during dragging to avoid jumps
      if (isDragging) return;
      
      const currentTime = video.currentTime;
      const duration = video.duration;
      
      if (DEBUG_PLAYER) {
        debugLog(`Time update - currentTime: ${currentTime.toFixed(2)}, duration: ${duration.toFixed(2)}, isLive: ${isLive}`);
      }
      
      // Always update current time regardless of live status
      setCurrentTime(currentTime);
      
      // If we have a valid duration, update it
      if (isFinite(duration) && duration > 0) {
        setDuration(duration);
        
        // Update progress and buffer status for all streams (even live ones)
        setProgress((currentTime / duration) * 100);
        
        // Update buffered progress
        if (video.buffered.length > 0) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          setBufferedProgress((bufferedEnd / duration) * 100);
        }
        
        // Set tracking as started once we have valid playback data
        if (!trackingStarted) {
          trackingStarted = true;
        }
      }
      
      // Handle live detection and timeline visibility
      if (!liveDetectionComplete && video.readyState >= 3) {
        const isInfinite = duration === Infinity;
        
        // Mark detection as complete once we have enough data
        setLiveDetectionComplete(true);
        
        if (isInfinite) {
          // Definitely a live stream
          debugLog('Detected infinite duration live stream');
          setIsLive(true);
          setShowTimeline(false);
        } else if (duration > 0 && duration < Infinity) {
          // VOD content - show timeline
          debugLog('Detected VOD content with duration:', duration);
          setIsLive(false);
          setShowTimeline(true);
        }
      }
    };
    
    const handleDurationChange = () => {
      const duration = video.duration;
      debugLog('Duration changed:', duration, 'isInfinite:', duration === Infinity);
      
      if (!duration || duration <= 0) return;
      
      setDuration(duration);
      
      // When duration becomes definitely available, make a firm decision
      if (duration === Infinity) {
        setIsLive(true);
        setShowTimeline(false);
        setLiveDetectionComplete(true);
      } else if (duration > 120) {
        // If it's longer than 2 minutes, we're confident it's VOD content
        setIsLive(false); 
        setShowTimeline(true);
        setLiveDetectionComplete(true);
      }
    };
    
    // More robust detection of live vs. VOD content
    const checkStreamType = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      
      const video = videoRef.current;
      const currentTime = video.currentTime;
      const duration = video.duration;
      
      // Skip checks if we haven't started playback yet
      if (currentTime <= 0) return;
      
      // If duration is valid and substantial
      if (isFinite(duration) && duration > 0) {
        const timeFromEnd = duration - currentTime;
        
        // If it's definitely a longer VOD file (>2 min)
        if (duration > 120) {
          if (isLive) {
            debugLog('Reclassifying as VOD based on long duration:', duration);
            setIsLive(false);
            setShowTimeline(true);
          }
        }
        // Edge case: Some live streams report as VOD but stick to the end
        else if (timeFromEnd < 3) {
          // Need persistent behavior at end - this is probably live
          const consistentEndChecks = videoRef.current._liveChecks || 0;
          videoRef.current._liveChecks = consistentEndChecks + 1;
          
          if (consistentEndChecks > 5) {
            debugLog('Reclassifying as live based on persistent end position');
            setIsLive(true);
            setShowTimeline(false);
          }
        } else {
          videoRef.current._liveChecks = 0;
          
          // If we can seek freely, it's probably VOD content
          if (!showTimeline && video.seekable.length > 0) {
            const seekableEnd = video.seekable.end(0);
            const seekableStart = video.seekable.start(0);
            
            if ((seekableEnd - seekableStart) > 30) {
              debugLog('Enabling timeline based on seekable range:', seekableEnd - seekableStart);
              setShowTimeline(true);
              setIsLive(false);
            }
          }
        }
      }
    };
    
    // Listen for events that give us information about the stream
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('loadedmetadata', handleDurationChange);
    video.addEventListener('progress', handleTimeUpdate);
    
    // Set up interval for ongoing detection
    liveCheckIntervalId = setInterval(checkStreamType, 1000);
    
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('loadedmetadata', handleDurationChange);
      video.removeEventListener('progress', handleTimeUpdate);
      clearInterval(liveCheckIntervalId);
    };
  }, [isDragging, isLive, showTimeline]);

  // Consolidate related state variables to reduce render triggers

  // Update the state function to only trigger UI updates when needed
  const updateStreamHealth = useCallback((newHealth) => {
    const currentHealth = streamHealthRef.current;
    const shouldUpdate = 
      newHealth.quality !== currentHealth.quality ||
      Math.abs(newHealth.bufferHealth - currentHealth.bufferHealth) > 5 ||
      Math.abs(newHealth.bitrate - currentHealth.bitrate) > 100000;
    
    if (shouldUpdate) {
      streamHealthRef.current = newHealth;
      setStreamHealth(newHealth);
    }
  }, []);

  // Create a memoized version of channel data processing
  const processChannelData = useMemo(() => {
    if (!channel) return null;
    
    return {
      ...channel,
      displayName: channel.name || 'Unknown Channel',
      groupName: channel.group || metadata?.group || 'Uncategorized',
      // Pre-calculate other derived values
      color: getChannelColor(channel.name),
      initials: getChannelInitials(channel.name)
    };
  }, [channel, metadata?.group]);

  // Use the virtualized list for quality options if there are many
  const shouldUseVirtualList = qualities.length > 10;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-black rounded-lg group">
      {/* Optimize conditional rendering using && instead of ternary when possible */}
      {loading && !streamLoaded && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-10">
          <Loader className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <p className="text-gray-300">Loading stream...</p>
        </div>
      )}
      
      {/* Only show error if not successfully loaded */}
      {error && !streamLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-90 p-6 z-10">
          <div className="max-w-lg w-full bg-gray-900 rounded-lg overflow-hidden shadow-2xl">
            <div className="bg-red-900/30 p-4 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-lg text-white">{error}</h3>
                <p className="text-gray-300 text-sm mt-1">This stream may be offline or geo-restricted</p>
              </div>
            </div>
            
            {errorDetails && (
              <div className="p-4 border-t border-gray-800 text-sm text-gray-400">
                <p>{errorDetails}</p>
                <p className="mt-2 text-xs text-gray-500">Error URL: {decodeURIComponent(id || '')}</p>
              </div>
            )}
            
            <div className="p-4 flex flex-wrap gap-3 bg-gray-800/50">
              <button 
                onClick={retryStream} 
                disabled={retryCount >= MAX_RETRIES} 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800/40 disabled:text-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${retryCount < MAX_RETRIES ? '' : 'opacity-50'}`} /> 
                {retryCount >= MAX_RETRIES ? 'Max retries reached' : 'Retry Stream'}
              </button>
              
              <a 
                href="/" 
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Return Home
              </a>
            </div>
            
            {similarStreams.length > 0 && (
              <div className="p-4 border-t border-gray-800">
                <h4 className="font-medium mb-3 text-gray-300">Similar channels you might try:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {similarStreams.map(stream => (
                    <a 
                      key={stream.id}
                      href={`/watch/${encodeURIComponent(stream.id)}`}
                      className="p-2 bg-gray-800 hover:bg-gray-700 rounded flex items-center gap-2 transition-colors"
                    >
                      <PlayCircle className="w-4 h-4 text-blue-400" />
                      <span className="truncate">{stream.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      <video 
        ref={videoRef} 
        className="w-full h-full" 
        playsInline
        muted // Start muted by default to enable autoplay
        onCanPlay={() => {
          debouncedSetLoading(false);
          setStreamLoaded(true);
          setError(''); // Clear errors when video is ready to play
        }}
        onPlaying={() => {
          debouncedSetLoading(false);  // Make sure loading state is turned off
          setStreamLoaded(true);
          setPlayerState(prev => ({...prev, isPlaying: true})); // Update the playing state
          setError(''); // Clear errors when video is playing
        }}
        onLoadedData={() => {
          debouncedSetLoading(false);
          setStreamLoaded(true);
          setError(''); // Clear errors when data is loaded
        }}
        onLoadedMetadata={() => {
          debouncedSetLoading(false);
          setStreamLoaded(true);
          setError(''); // Clear errors when metadata is loaded
        }}
      />
      
      {/* Only show unmute button when needed, video is actually loaded (not loading) and no errors */}
      {needsInteraction && streamLoaded && !loading && !error && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-black/50 cursor-pointer z-10"
          onClick={handleUnmute}
        >
          <div className="bg-blue-600/90 p-6 rounded-full animate-pulse-slow shadow-lg">
            <Volume2 className="w-16 h-16 text-white" />
          </div>
          <span className="absolute mt-32 text-white bg-black/70 px-4 py-2 rounded-full text-sm">
            Tap to unmute stream
          </span>
        </div>
      )}
      
      {/* Channel info overlay */}
      {channel && playerState.showControls && (
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10 transition-opacity duration-300">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button 
              onClick={() => route('/')} 
              className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors mr-1"
              title="Back to Home"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            
            {channel.logo ? (
              <img 
                src={channel.logo} 
                alt={channel.name} 
                className="w-10 h-10 rounded object-cover bg-gray-900"
              />
            ) : (
              <div 
                className="w-10 h-10 rounded flex items-center justify-center"
                style={{ backgroundColor: getChannelColor(channel.name) }}
              >
                <span className="text-white text-sm font-bold">
                  {getChannelInitials(channel.name)}
                </span>
              </div>
            )}
            <div>
              <h3 className="font-bold text-white text-lg">
                {channel.name}
              </h3>
              <p className="text-gray-300 text-sm">
                {channel.group || metadata?.group || 'Uncategorized'}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Main controls */}
      {playerState.showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 z-10">
          <div className="flex flex-col gap-3">
            {/* Debug info for development */}
            {showDebug && (
              <div className="mb-1 text-xs bg-black/40 px-2 py-0.5 rounded inline-flex items-center">
                <span className="mr-2">Duration: {formatTime(duration)}</span>
                <span className="mr-2">Live: {isLive ? 'Yes' : 'No'}</span>
                <span className="mr-2">Time: {formatTime(currentTime)}</span>
                <span className="mr-2">Show Timeline: {showTimeline ? 'Yes' : 'No'}</span>
                <span>Progress: {progress.toFixed(1)}%</span>
              </div>
            )}

            {/* Timeline/progress bar for non-live streams */}
            {showTimeline && duration > 0 && (
              <div className="flex items-center gap-2 w-full">
                <span className="text-xs text-gray-300 w-12 text-center">
                  {formatTime(currentTime)}
                </span>
                
                <div 
                  ref={progressBarRef}
                  className="relative flex-grow h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer group"
                  onClick={handleSeek}
                  onMouseDown={handleProgressDragStart}
                >
                  {/* Buffered progress */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-white/30 z-10"
                    style={{ width: `${bufferedProgress}%` }}
                  ></div>
                  
                  {/* Playback progress */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-blue-500 z-20"
                    style={{ width: `${progress}%` }}
                  ></div>
                  
                  {/* Hover effect to make the progress bar taller */}
                  <div className="absolute inset-y-0 left-0 w-full transform scale-y-0 group-hover:scale-y-[3] origin-center transition-transform duration-150"></div>
                  
                  {/* Seek handle */}
                  <div 
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full shadow z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    style={{ left: `calc(${progress}% - 6px)` }}
                  ></div>
                </div>
                
                <span className="text-xs text-gray-300 w-12 text-center">
                  {formatTime(duration)}
                </span>
              </div>
            )}
            
            {/* Live indicator for live streams */}
            {isLive && (
              <div className="flex items-center gap-2 mb-1">
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full bg-red-500 mr-1.5 animate-pulse"></div>
                  <span className="text-xs font-medium text-red-500">LIVE</span>
                </div>
              </div>
            )}
            
            {/* Playback controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Play/pause button */}
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                  title={playerState.isPlaying ? "Pause" : "Play"}
                >
                  {playerState.isPlaying ? 
                    <PauseCircle className="w-7 h-7" /> : 
                    <PlayCircle className="w-7 h-7" />
                  }
                </button>
                
                {/* Volume controls - Updated with interactive functionality */}
                <div className="flex items-center gap-2">
                  <button 
                    onClick={toggleMute}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    title={playerState.isMuted ? "Unmute" : "Mute"}
                  >
                    {playerState.isMuted ? 
                      <VolumeX className="w-5 h-5" /> : 
                      <Volume2 className="w-5 h-5" />
                    }
                  </button>
                  
                  <div 
                    className="hidden md:block w-24 h-1.5 bg-white/20 rounded-full overflow-hidden volume-bar cursor-pointer"
                    onClick={handleVolumeBarClick}
                    onMouseDown={handleVolumeDrag}
                  >
                    <div 
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${playerState.volume * 100}%` }}
                    ></div>
                  </div>
                </div>
                
                {/* Info label - displays stream quality or status */}
                {streamHealth.quality && (
                  <div className="hidden md:flex items-center gap-1 text-xs bg-black/30 px-2 py-1 rounded text-gray-300">
                    <Gauge className="w-3 h-3" />
                    <span>{streamHealth.quality}</span>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                {/* PiP button */}
                <button
                  onClick={handlePictureInPicture}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  title="Picture in Picture"
                >
                  <PictureInPicture className="w-5 h-5" />
                </button>
                
                {/* Quality selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    title="Quality Settings"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                  
                  {showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 w-40 bg-gray-900 rounded-lg shadow-lg p-2 z-20">
                      <div className="text-xs text-gray-400 mb-1 px-2">Quality</div>
                      <button 
                        onClick={() => handleQualityChange('auto')}
                        className={`w-full text-left px-3 py-1.5 rounded ${currentQuality === 'auto' ? 'bg-blue-600 text-white' : 'hover:bg-white/10'}`}
                      >
                        Auto
                      </button>
                      {qualities.map((quality) => (
                        <button 
                          key={quality.id} 
                          onClick={() => handleQualityChange(quality.id)}
                          className={`w-full text-left px-3 py-1.5 rounded ${currentQuality === quality.id ? 'bg-blue-600 text-white' : 'hover:bg-white/10'}`}
                        >
                          {quality.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Favorite button - Fix incorrect tag structure */}
                <button
                  onClick={toggleFavorite}
                  className={`w-8 h-8 rounded-full ${isFavorite ? 'bg-red-600/30 text-red-500' : 'bg-white/10 hover:bg-white/20'} flex items-center justify-center transition-colors`}
                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart className={isFavorite ? "w-5 h-5 fill-current" : "w-5 h-5"} />
                </button>
                
                {/* Fullscreen toggle - Fix incorrect tag structure */}
                <button
                  onClick={toggleFullscreen}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  title={playerState.isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {playerState.isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove keyboard shortcuts tooltip */}
      
      {/* Debug overlay - Enhanced with more information */}
      {showDebug && (
        <div className="absolute top-14 right-4 bg-black/80 p-3 rounded text-xs text-gray-300 max-w-xs overflow-auto max-h-[50vh]">
          <h4 className="font-bold mb-1">Debug Info</h4>
          <div>Channel: {channel?.name || 'Unknown'}</div>
          <div>Quality: {streamHealth.quality || 'Auto'}</div>
          <div>Buffer: {Math.round(streamHealth.bufferHealth)}%</div>
          <div>Duration: {formatTime(duration)}</div>
          <div>Current Time: {formatTime(currentTime)}</div>
          <div>Live Status: {isLive ? 'Live' : 'Not Live'}</div>
          <div>Show Timeline: {showTimeline ? 'Yes' : 'No'}</div>
          <div>Live Detection: {liveDetectionComplete ? 'Complete' : 'Pending'}</div>
          <div>Seekable: {videoRef.current?.seekable?.length > 0 ? 
            `${videoRef.current.seekable.start(0).toFixed(1)}-${videoRef.current.seekable.end(0).toFixed(1)}` : 
            'None'}</div>
          <div>ReadyState: {videoRef.current?.readyState || 'N/A'}</div>
          <div>Dropped Frames: {streamHealth.droppedFrames}</div>
          <div>URL: {id ? decodeURIComponent(id).substring(0, 30) + '...' : 'Unknown'}</div>
          <div>Stream Loaded: {streamLoaded ? 'Yes' : 'No'}</div>
        </div>
      )}
    </div>
  );
}
