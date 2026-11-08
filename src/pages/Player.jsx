import { h } from 'preact';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import Hls from 'hls.js';
import {
  ArrowLeft, Loader, Heart, AlertTriangle, RefreshCw, PlayCircle,
  Volume2, VolumeX, Maximize, Minimize, Settings, PictureInPicture, Play, Pause,
  ChevronLeft, Share2, Check
} from 'lucide-preact';
import ChannelCard from '../components/ChannelCard';
import { get, set } from '../utils/idbStorage';
import { getAllChannels } from '../utils/playlist';
import { getChannelColor, getChannelInitials } from '../utils/logoService';
import { usePictureInPicture } from '../contexts/PictureInPictureContext';
import { goBack } from '../utils/historyManager';
import * as apiClient from '../utils/apiClient';
import { parseWatchKey, resolveWatchKey, watchPath, watchPathForStream } from '../utils/watchLinks';

const LOAD_TIMEOUT_MS = 25000;
const CONTROLS_HIDE_MS = 3000;

const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: true,
  startLevel: -1,
  capLevelToPlayerSize: true,
  liveDurationInfinity: true,
  backBufferLength: 30,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  manifestLoadingTimeOut: 10000,
  manifestLoadingMaxRetry: 2,
  levelLoadingTimeOut: 10000,
  levelLoadingMaxRetry: 3,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 5,
};

// Clean names like `-1 tvg-id="x" group-title="y",Channel Name`
function cleanChannelTitle(title) {
  if (!title) return '';
  if (title.startsWith('-1') && title.includes(',')) {
    return title.split(',').slice(1).join(',').trim();
  }
  return title
    .replace(/tvg-[^"]*"[^"]*"/g, '')
    .replace(/group-title="[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\(\d+p\)/g, '')
    .replace(/\s*\|\s*.+$/, '')
    .trim();
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Plain media files that hls.js can't play but the <video> element can
function isProgressiveMedia(url) {
  try {
    return /\.(mp4|m4v|webm|mov|ogv|mp3|aac|m4a|ogg)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the stream server';
  }
}

function nameFromUrl(streamUrl) {
  try {
    const parts = new URL(streamUrl).pathname.split('/').filter(Boolean);
    let name = parts[parts.length - 1] || '';
    // index.m3u8 / playlist.m3u8 / chunklist.m3u8 say nothing; use the folder name instead
    if (/^(index|playlist|master|chunklist|mono|stream|live)\b/i.test(name) && parts.length > 1) {
      name = parts[parts.length - 2];
    }
    name = name
      .replace(/\.(m3u8?|ts|mp4|mpeg)$/i, '')
      .replace(/[-_.]+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
    return name || hostnameOf(streamUrl);
  } catch {
    return 'Unknown Channel';
  }
}

function formatTime(time) {
  if (!isFinite(time) || time < 0) return '00:00';
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);
  const pad = n => n.toString().padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function describeNetworkError(data, url) {
  const host = hostnameOf(url);
  const code = data?.response?.code ?? data?.networkDetails?.status;
  const mixedContent = typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http:');

  if (mixedContent) {
    return {
      message: 'Stream blocked by the browser',
      details: `This page is served over HTTPS but the stream uses plain HTTP (${host}), so the browser refuses to load it.`
    };
  }
  if (code === 403 || code === 451) {
    return {
      message: 'Stream may be geo-restricted',
      details: `${host} refused the request (HTTP ${code}). The channel is probably not available in your region.`
    };
  }
  if (code === 404 || code === 410) {
    return {
      message: 'Stream not found',
      details: `${host} says this stream doesn't exist any more (HTTP ${code}). The link in the playlist is dead.`
    };
  }
  if (code && code >= 400) {
    return {
      message: `Stream server error (HTTP ${code})`,
      details: `${host} returned an error. The channel may be temporarily offline.`
    };
  }
  return {
    message: "Stream couldn't be reached",
    details: `${host} didn't answer, or it doesn't allow playback from other websites (CORS). ` +
      'The channel may be offline, or only playable in a native player such as VLC.'
  };
}

// Look the stream up in the user's playlists, favorites and history to get a
// good name/logo, and record it in the watch history.
async function resolveChannelInfo(streamUrl, apiChannel, { recordHistory }) {
  const [history, favorites, playlistChannels] = await Promise.all([
    get('watchHistory').catch(() => null),
    get('favorites').catch(() => null),
    getAllChannels().catch(() => []),
  ]);
  const historyList = Array.isArray(history) ? history : [];
  const favoriteList = Array.isArray(favorites) ? favorites : [];

  const historyChannel = historyList.find(item => item?.channel?.id === streamUrl)?.channel;
  const favorite = favoriteList.find(fav => fav?.id === streamUrl);
  const fromPlaylist = playlistChannels.find(ch => ch?.url === streamUrl);

  const pick = (...values) => values.find(v => v && v !== 'Uncategorized' && v !== 'Unknown Channel');

  const channel = {
    id: streamUrl,
    name: pick(
      apiChannel?.name,
      favorite?.name,
      fromPlaylist && (fromPlaylist.tvgName || cleanChannelTitle(fromPlaylist.name)),
      historyChannel?.name
    ) || nameFromUrl(streamUrl),
    group: pick(
      apiChannel?.categories?.[0],
      apiChannel?.category,
      apiChannel?.group,
      favorite?.group,
      fromPlaylist?.group,
      historyChannel?.group
    ) || 'Uncategorized',
    logo: pick(
      apiChannel?.logo,
      favorite?.logo,
      fromPlaylist?.tvgLogo,
      fromPlaylist?.attributes?.['tvg-logo'],
      fromPlaylist?.logo,
      historyChannel?.logo
    ) || null,
    channelId: pick(apiChannel?.id, favorite?.channelId, fromPlaylist?.tvgId, historyChannel?.channelId) || null,
  };

  if (recordHistory) {
    const updatedHistory = [
      { timestamp: Date.now(), channel },
      ...historyList.filter(item => item?.channel?.id !== streamUrl)
    ].slice(0, 100);
    await set('watchHistory', updatedHistory).catch(err => console.warn('Could not update watch history:', err));
  }

  return { channel, isFavorite: !!favorite };
}

// Other streams in the user's playlists with a similar name
async function findSimilarStreams(channel, currentUrl) {
  if (!channel?.name) return [];
  const name = channel.name.toLowerCase();
  if (name.length < 2) return [];
  const all = await getAllChannels();
  const seen = new Set([currentUrl]);
  const result = [];
  for (const item of all) {
    if (!item?.url || seen.has(item.url)) continue;
    const itemName = cleanChannelTitle(item.name).toLowerCase();
    if (!itemName) continue;
    if (itemName.includes(name) || name.includes(itemName)) {
      seen.add(item.url);
      result.push({ url: item.url, name: cleanChannelTitle(item.name) });
      if (result.length >= 6) break;
    }
  }
  return result;
}

// Channels for the "Up next" column: same category, playlists first, then iptv-org
async function findUpNext(channel, currentUrl, limit = 7) {
  const group = channel?.group && channel.group !== 'Uncategorized' ? channel.group : null;
  const seen = new Set([currentUrl]);
  const result = [];
  const push = (item) => {
    if (!item?.url || seen.has(item.url) || result.length >= limit) return;
    seen.add(item.url);
    result.push(item);
  };
  if (group) {
    const wanted = group.toLowerCase();
    for (const item of await getAllChannels().catch(() => [])) {
      if ((item?.group || '').toLowerCase() === wanted) {
        push({ url: item.url, name: cleanChannelTitle(item.name), logo: item.logo || item.tvgLogo || null, group: item.group });
      }
    }
    if (result.length < limit) {
      const apiChannels = await apiClient.getChannels({ category: wanted }).catch(() => []);
      for (const item of apiChannels) {
        push({ url: item.url, id: item.id, name: item.name, logo: item.logo || null, group: item.categories?.[0] || group, country: item.country });
      }
    }
  }
  return result;
}

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const initialPlayerState = () => ({
  isPlaying: false,
  isMuted: false,
  volume: (() => {
    try {
      const saved = parseFloat(localStorage.getItem('player-volume'));
      return isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 1;
    } catch {
      return 1;
    }
  })(),
  showControls: true,
  isFullscreen: false
});

export default function Player({ id, preview = false }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const progressBarRef = useRef(null);
  const volumeBarRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const streamLoadedRef = useRef(false);
  const isSeekingRef = useRef(false);
  const isVolumeDragRef = useRef(false);
  const loadedIdRef = useRef(null);
  const tapRevealsControlsRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [channel, setChannel] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [similarStreams, setSimilarStreams] = useState([]);
  const [playerState, setPlayerState] = useState(initialPlayerState);
  const [streamUrl, setStreamUrl] = useState(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [qualities, setQualities] = useState([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentQuality, setCurrentQuality] = useState('auto');
  const [qualityLabel, setQualityLabel] = useState(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [upNext, setUpNext] = useState([]);
  const [shared, setShared] = useState(false);

  const { enterPiP, exitPiP, isPipActive, pipStatus, pipChannel } = usePictureInPicture();
  const pipRef = useRef({ isPipActive, pipStatus, exitPiP });
  pipRef.current = { isPipActive, pipStatus, exitPiP };

  const volumeRef = useRef(playerState.volume);
  volumeRef.current = playerState.volume;

  // ---------------------------------------------------------------------------
  // Stream loading. Runs for every channel (id) and every "Retry".
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!id || !video) return;

    let cancelled = false;
    let timeoutId = null;
    let nativeCleanup = null;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;

    // Reset everything from the previous channel
    streamLoadedRef.current = false;
    setStreamLoaded(false);
    setLoading(true);
    setBuffering(false);
    setError('');
    setErrorDetails('');
    setNeedsInteraction(false);
    setSimilarStreams([]);
    setQualities([]);
    setCurrentQuality('auto');
    setQualityLabel(null);
    setShowQualityMenu(false);
    setIsLive(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setLogoFailed(false);
    if (loadedIdRef.current !== id) {
      // New channel (not a retry of the same one)
      loadedIdRef.current = id;
      setChannel(null);
      setIsFavorite(false);
      setStreamUrl(null);
    }

    // Opening a channel in the full player closes a running PiP window, so
    // two streams don't play at once.
    if (!preview && (pipRef.current.isPipActive || pipRef.current.pipStatus !== 'inactive')) {
      pipRef.current.exitPiP();
    }

    const stopMedia = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (e) {
          console.warn('Error destroying HLS instance', e);
        }
        hlsRef.current = null;
      }
      if (nativeCleanup) {
        nativeCleanup();
        nativeCleanup = null;
      }
    };

    const fail = (message, details = '') => {
      if (cancelled) return;
      clearTimeout(timeoutId);
      stopMedia();
      streamLoadedRef.current = false;
      setStreamLoaded(false);
      setLoading(false);
      setBuffering(false);
      setNeedsInteraction(false);
      setError(message);
      setErrorDetails(details);
    };

    const markLoaded = () => {
      if (cancelled) return;
      clearTimeout(timeoutId);
      streamLoadedRef.current = true;
      setStreamLoaded(true);
      setLoading(false);
      setError('');
      setErrorDetails('');
    };

    // Try to play with sound (works after a click in the app); if the browser
    // blocks that, play muted and offer "tap to unmute".
    const startPlayback = () => {
      if (cancelled) return;
      video.volume = volumeRef.current;
      video.muted = preview;
      setPlayerState(prev => ({ ...prev, isMuted: video.muted }));

      video.play().catch(err => {
        if (cancelled || err?.name === 'AbortError') return;
        video.muted = true;
        setPlayerState(prev => ({ ...prev, isMuted: true }));
        video.play()
          .then(() => { if (!cancelled && !preview) setNeedsInteraction(true); })
          .catch(() => { if (!cancelled) setNeedsInteraction(true); });
      });
    };

    // fallbackError: what to report if the browser can't play it either
    const attachNative = (url, fallbackError) => {
      const onLoaded = () => {
        markLoaded();
        startPlayback();
      };
      const onError = () => {
        if (streamLoadedRef.current) {
          fail('Playback stopped', `The stream from ${hostnameOf(url)} stopped working.`);
        } else if (fallbackError) {
          fail(fallbackError.message, fallbackError.details);
        } else {
          fail("The browser couldn't play this stream",
            `The stream from ${hostnameOf(url)} may be offline, geo-restricted, or blocked by CORS.`);
        }
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError);
      video.src = url;
      nativeCleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    };

    const attachHls = (url) => {
      const hls = new Hls(HLS_CONFIG);
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (cancelled) return;
        markLoaded();
        if (data.levels && data.levels.length > 1) {
          setQualities(data.levels.map((level, index) => ({
            id: String(index),
            name: level.height
              ? `${level.height}p${level.bitrate ? ` · ${Math.round(level.bitrate / 1000)} kbps` : ''}`
              : `${Math.round((level.bitrate || 0) / 1000)} kbps`
          })));
        }
        startPlayback();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels?.[data.level];
        if (level?.height) {
          setQualityLabel(`${level.height}p`);
        } else if (level?.bitrate) {
          setQualityLabel(`${Math.round(level.bitrate / 1000)} kbps`);
        }
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (data?.details) setIsLive(!!data.details.live);
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRecoveries = 0;
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return;
        console.warn('HLS fatal error:', data.type, data.details);

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!streamLoadedRef.current) {
            // Not an HLS playlist (e.g. a raw .ts stream or a video file
            // without extension): let the browser try it directly.
            if (data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) {
              stopMedia();
              attachNative(url, {
                message: 'This link is not a playable stream',
                details: `${hostnameOf(url)} returned something that is neither an HLS playlist nor a video the browser can play.`
              });
              return;
            }
            const networkError = describeNetworkError(data, url);
            const status = data.response?.code ?? data.networkDetails?.status;
            // No response at all is usually CORS. The browser's own HLS
            // support (Safari, newer Chrome) isn't limited by CORS, so try it.
            if (!status && video.canPlayType('application/vnd.apple.mpegurl')) {
              stopMedia();
              attachNative(url, networkError);
              return;
            }
            fail(networkError.message, networkError.details);
            return;
          }
          if (networkRecoveries < 3) {
            networkRecoveries += 1;
            hls.startLoad();
            return;
          }
          fail('Lost connection to the stream', `${hostnameOf(url)} stopped responding.`);
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveries === 0) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
            return;
          }
          if (mediaRecoveries === 1) {
            mediaRecoveries += 1;
            hls.swapAudioCodec();
            hls.recoverMediaError();
            return;
          }
          fail("This stream's video format isn't supported by your browser", `Decoder error: ${data.details}`);
          return;
        }

        fail('Playback error', `The player stopped with: ${data.details}`);
      });

      hls.loadSource(url);
      hls.attachMedia(video);
    };

    const run = async () => {
      let url = id;
      let apiChannel = null;

      // Short links (/watch/bbc-one-1a2b3c4d) carry a key for the stream URL
      const watchKey = parseWatchKey(id);
      if (watchKey) {
        const resolved = await resolveWatchKey(watchKey, [
          async () => (await getAllChannels()).map(ch => ch?.url),
          async () => ((await get('favorites')) || []).flatMap(fav => [fav?.url, fav?.id]),
          async () => ((await get('watchHistory')) || []).map(item => item?.channel?.id),
          async () => ((await apiClient.getStreams()) || []).map(stream => stream?.url),
        ]);
        if (cancelled) return;
        if (resolved) url = resolved;
      }

      // iptv-org channel IDs (e.g. "CNN.us") need to be resolved to a stream URL
      if (!isHttpUrl(url)) {
        try {
          apiChannel = (await apiClient.getChannelDetails(id)) || (await apiClient.findChannel(id));
        } catch (err) {
          console.warn('Channel lookup failed:', err);
        }
        if (cancelled) return;
        if (!apiChannel?.url) {
          fail('No stream found for this channel', `"${id}" has no known stream URL.`);
          return;
        }
        url = apiChannel.url;
      }

      setStreamUrl(url);

      // Channel name/logo and watch history don't block playback
      resolveChannelInfo(url, apiChannel, { recordHistory: !preview })
        .then(info => {
          if (cancelled) return;
          setChannel(info.channel);
          setIsFavorite(info.isFavorite);
          // Old links carry the whole stream URL: show the short one instead
          if (!preview && isHttpUrl(id) && typeof window !== 'undefined') {
            try {
              window.history.replaceState(window.history.state, '', watchPath({ url, name: info.channel.name }));
            } catch {
              // Keep the long URL if the browser refuses
            }
          }
        })
        .catch(err => console.warn('Could not load channel info:', err));

      timeoutId = setTimeout(() => {
        if (!streamLoadedRef.current) {
          fail('Stream timed out', `${hostnameOf(url)} didn't send any video within ${LOAD_TIMEOUT_MS / 1000} seconds.`);
        }
      }, LOAD_TIMEOUT_MS);

      if (Hls.isSupported() && !isProgressiveMedia(url)) {
        attachHls(url);
      } else if (isProgressiveMedia(url) || video.canPlayType('application/vnd.apple.mpegurl')) {
        attachNative(url, null);
      } else {
        fail("Your browser doesn't support HLS playback");
      }
    };

    run().catch(err => {
      console.error('Error loading stream:', err);
      fail('Error loading stream', err?.message || 'Unknown error');
    });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      stopMedia();
    };
  }, [id, reloadToken, preview]);

  // Similar streams from the user's playlists when a stream fails
  useEffect(() => {
    if (!error || !channel || preview) return;
    let cancelled = false;
    findSimilarStreams(channel, streamUrl)
      .then(list => { if (!cancelled) setSimilarStreams(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [error, channel, streamUrl, preview]);

  // ---------------------------------------------------------------------------
  // <video> element events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlayerState(prev => ({ ...prev, isPlaying: true }));
    const onPause = () => setPlayerState(prev => ({ ...prev, isPlaying: false }));
    const onPlaying = () => {
      setBuffering(false);
      setPlayerState(prev => ({ ...prev, isPlaying: true }));
    };
    const onWaiting = () => {
      if (streamLoadedRef.current) setBuffering(true);
    };
    const onCanPlay = () => setBuffering(false);
    const onVolumeChange = () => {
      setPlayerState(prev => (prev.isMuted === video.muted ? prev : { ...prev, isMuted: video.muted }));
    };
    const onTimeUpdate = () => {
      if (isSeekingRef.current) return;
      setCurrentTime(video.currentTime);
    };
    const onDurationChange = () => {
      const d = video.duration;
      if (d === Infinity) {
        setIsLive(true);
        setDuration(0);
      } else if (isFinite(d) && d > 0) {
        setDuration(d);
      }
    };
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onDurationChange);
    video.addEventListener('progress', onProgress);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('progress', onProgress);
    };
  }, []);

  // Fullscreen state
  useEffect(() => {
    const onFullscreenChange = () => {
      setPlayerState(prev => ({ ...prev, isFullscreen: document.fullscreenElement === containerRef.current }));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // When this stream moves into the PiP window, pause the big player so the
  // channel doesn't play twice.
  useEffect(() => {
    if (preview || !isPipActive || !pipChannel || !streamUrl) return;
    if (pipChannel.id === streamUrl && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isPipActive, pipChannel, streamUrl, preview]);

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamLoadedRef.current) return;
    if (video.paused) {
      video.play().catch(err => console.warn('Play failed:', err));
    } else {
      video.pause();
    }
  }, []);

  const setVolume = useCallback((newVolume) => {
    const volume = Math.max(0, Math.min(1, newVolume));
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      if (volume > 0 && video.muted) video.muted = false;
    }
    setPlayerState(prev => ({ ...prev, volume, isMuted: video ? video.muted : prev.isMuted }));
    setNeedsInteraction(false);
    try {
      localStorage.setItem('player-volume', String(volume));
    } catch {
      // ignore
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) {
      video.volume = 1;
      setPlayerState(prev => ({ ...prev, volume: 1 }));
    }
    setPlayerState(prev => ({ ...prev, isMuted: video.muted }));
    setNeedsInteraction(false);
  }, []);

  const handleUnmute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setPlayerState(prev => ({ ...prev, isMuted: false }));
    setNeedsInteraction(false);
    if (video.paused) {
      video.play().catch(err => console.warn('Play failed:', err));
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(console.warn);
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(console.warn);
    } else if (video?.webkitEnterFullscreen) {
      // iPhone Safari only supports fullscreen on the video element itself
      video.webkitEnterFullscreen();
    }
  }, []);

  const handleQualityChange = useCallback((levelId) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelId === 'auto' ? -1 : parseInt(levelId, 10);
    }
    setCurrentQuality(levelId);
    setShowQualityMenu(false);
  }, []);

  const handlePictureInPicture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    const info = {
      ...(channel || {}),
      id: streamUrl,
      name: channel?.name || nameFromUrl(streamUrl)
    };
    enterPiP(info, streamUrl, {
      volume: playerState.volume,
      wasMuted: video.muted,
      isLive,
      fromUserGesture: true
    });
  }, [channel, streamUrl, enterPiP, playerState.volume, isLive]);

  const toggleFavorite = useCallback(async () => {
    if (!channel) return;
    try {
      const favorites = (await get('favorites')) || [];
      if (isFavorite) {
        await set('favorites', favorites.filter(fav => fav.id !== channel.id));
        setIsFavorite(false);
      } else {
        await set('favorites', [...favorites.filter(fav => fav.id !== channel.id), channel]);
        setIsFavorite(true);
      }
    } catch (err) {
      console.error('Error toggling favorite status:', err);
    }
  }, [channel, isFavorite]);

  const retryStream = useCallback(() => {
    setReloadToken(token => token + 1);
  }, []);

  const openSimilar = useCallback((event, url, name) => {
    event.preventDefault();
    // Replace the failed channel so Back still returns to the list
    route(watchPathForStream(url, name), true);
  }, []);

  // Seek bar (mouse and touch)
  const seekToClientX = useCallback((clientX) => {
    const bar = progressBarRef.current;
    const video = videoRef.current;
    if (!bar || !video || !isFinite(video.duration) || video.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = Math.min(ratio * video.duration, video.duration - 0.1);
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const onSeekPointerDown = useCallback((event) => {
    if (isLive) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    isSeekingRef.current = true;
    seekToClientX(event.clientX);
  }, [isLive, seekToClientX]);

  const onSeekPointerMove = useCallback((event) => {
    if (isSeekingRef.current) seekToClientX(event.clientX);
  }, [seekToClientX]);

  const onSeekPointerUp = useCallback(() => {
    isSeekingRef.current = false;
  }, []);

  // Volume bar (mouse and touch)
  const volumeFromClientX = useCallback((clientX) => {
    const bar = volumeBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    setVolume((clientX - rect.left) / rect.width);
  }, [setVolume]);

  const onVolumePointerDown = useCallback((event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    isVolumeDragRef.current = true;
    volumeFromClientX(event.clientX);
  }, [volumeFromClientX]);

  const onVolumePointerMove = useCallback((event) => {
    if (isVolumeDragRef.current) volumeFromClientX(event.clientX);
  }, [volumeFromClientX]);

  const onVolumePointerUp = useCallback(() => {
    isVolumeDragRef.current = false;
  }, []);

  // Show controls on activity, hide them after a few seconds of playback
  const showControlsTemporarily = useCallback(() => {
    setPlayerState(prev => (prev.showControls ? prev : { ...prev, showControls: true }));
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && !isSeekingRef.current && !isVolumeDragRef.current) {
        setPlayerState(prev => ({ ...prev, showControls: false }));
        setShowQualityMenu(false);
      }
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    if (playerState.isPlaying) {
      showControlsTemporarily();
    } else {
      clearTimeout(controlsTimeoutRef.current);
      setPlayerState(prev => (prev.showControls ? prev : { ...prev, showControls: true }));
    }
  }, [playerState.isPlaying, showControlsTemporarily]);

  useEffect(() => () => clearTimeout(controlsTimeoutRef.current), []);

  // On touch screens the first tap only brings the controls back
  const onContainerPointerDown = useCallback((event) => {
    tapRevealsControlsRef.current = event.pointerType === 'touch' && !playerState.showControls;
    showControlsTemporarily();
  }, [playerState.showControls, showControlsTemporarily]);

  const onVideoClick = useCallback(() => {
    if (tapRevealsControlsRef.current) {
      tapRevealsControlsRef.current = false;
      return;
    }
    togglePlay();
  }, [togglePlay]);

  // Keyboard shortcuts
  const shortcutsRef = useRef(null);
  shortcutsRef.current = { togglePlay, toggleFullscreen, toggleMute, setVolume, isLive, showControlsTemporarily, playerState };

  useEffect(() => {
    if (preview) return;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const s = shortcutsRef.current;
      const video = videoRef.current;

      switch (event.key) {
        case ' ':
        case 'k':
          if (target?.tagName === 'BUTTON' && event.key === ' ') return; // let buttons handle Space
          event.preventDefault();
          s.togglePlay();
          break;
        case 'f':
          s.toggleFullscreen();
          break;
        case 'm':
          s.toggleMute();
          break;
        case 'ArrowUp':
          event.preventDefault();
          s.setVolume(s.playerState.volume + 0.1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          s.setVolume(s.playerState.volume - 0.1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (!video || s.isLive || !isFinite(video.duration)) return;
          event.preventDefault();
          video.currentTime = Math.max(0, Math.min(video.duration - 0.1,
            video.currentTime + (event.key === 'ArrowLeft' ? -10 : 10)));
          break;
        case 'i':
          setShowDebug(v => !v);
          break;
        default:
          return;
      }
      s.showControlsTemporarily();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  // Fill "Up next" once the stream is playing, so it never competes with it
  useEffect(() => {
    if (preview || !channel || !streamLoaded) return undefined;
    let cancelled = false;
    findUpNext(channel, streamUrl)
      .then(list => { if (!cancelled) setUpNext(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [preview, channel, streamLoaded, streamUrl]);

  const shareChannel = useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: channel?.name || 'IPTV Streamer', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // share sheet dismissed or clipboard blocked
    }
  }, [channel]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const showTimeline = !isLive && duration > 0;
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedProgress = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const controlsVisible = playerState.showControls || !!error || loading;
  const displayName = channel?.name || (streamUrl ? nameFromUrl(streamUrl) : '');
  const containerClass = preview
    ? 'relative w-full h-full overflow-hidden bg-black'
    : 'relative w-full aspect-video max-h-[calc(100vh-12rem)] overflow-hidden bg-black rounded-2xl ring-1 ring-[var(--color-hairline)]';
  const showOverlayTitle = !preview && playerState.isFullscreen;
  const ctlButton = 'w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors';

  const videoBox = (
    <div
      ref={containerRef}
      className={`${containerClass} select-none ${controlsVisible ? '' : 'cursor-none'}`}
      onPointerMove={showControlsTemporarily}
      onPointerDown={onContainerPointerDown}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        onClick={onVideoClick}
        onDblClick={preview ? undefined : toggleFullscreen}
      />

      {/* Loading */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 pointer-events-none">
          <Loader className="w-12 h-12 text-[var(--color-lilac)] animate-spin mb-4" />
          <p className="text-gray-300">Loading stream...</p>
        </div>
      )}

      {/* Buffering after the stream has started */}
      {buffering && !loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <Loader className="w-10 h-10 text-white/80 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-4 sm:p-6 z-20 overflow-y-auto">
          <div className="max-w-lg w-full bg-gray-900 rounded-2xl border border-white/10 overflow-hidden shadow-2xl my-auto">
            <img src="/brand/stream-error.svg" alt="" width="480" height="270" className="w-full max-w-xs mx-auto h-auto pt-4" />
            <div className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-bold text-lg text-white">{error}</h3>
                {errorDetails && <p className="text-gray-300 text-sm mt-1">{errorDetails}</p>}
              </div>
            </div>

            {streamUrl && !preview && (
              <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500 break-all">
                {streamUrl}
              </div>
            )}

            <div className="p-4 flex flex-wrap gap-3 bg-gray-800/50">
              <button
                onClick={retryStream}
                className="btn btn-primary"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              {!preview && (
                <button
                  onClick={() => goBack()}
                  className="btn btn-secondary"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Go back
                </button>
              )}
            </div>

            {similarStreams.length > 0 && (
              <div className="p-4 border-t border-gray-800">
                <h4 className="font-medium mb-3 text-gray-300">Other streams you might try:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {similarStreams.map(stream => (
                    <a
                      key={stream.url}
                      href={watchPathForStream(stream.url, stream.name)}
                      onClick={(e) => openSimilar(e, stream.url, stream.name)}
                      className="p-2 bg-gray-800 hover:bg-gray-700 rounded-sm flex items-center gap-2 transition-colors"
                    >
                      <PlayCircle className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="truncate">{stream.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Muted autoplay / blocked autoplay */}
      {needsInteraction && streamLoaded && !loading && !error && (
        <button
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 sm:gap-4 bg-black/30 z-10"
          onClick={(e) => { e.stopPropagation(); handleUnmute(); }}
        >
          <div className="p-4 sm:p-6 rounded-full bg-white/15 border border-white/25 backdrop-blur-xl shadow-[var(--shadow-glow)] animate-pulse-slow">
            {videoRef.current?.paused
              ? <Play className="w-8 h-8 sm:w-16 sm:h-16 text-white" />
              : <Volume2 className="w-8 h-8 sm:w-16 sm:h-16 text-white" />}
          </div>
          <span className="text-white bg-black/70 px-4 py-2 rounded-full text-sm">
            {videoRef.current?.paused ? 'Click to play' : 'Tap to unmute'}
          </span>
        </button>
      )}

      {/* LIVE / quality badges, as in the FigCraft player frame */}
      {!preview && !showOverlayTitle && streamLoaded && !error && controlsVisible && (
        <div className="absolute top-4 left-4 sm:top-5 sm:left-5 flex items-center gap-2 z-30 pointer-events-none">
          {isLive && <span className="live-badge">LIVE</span>}
          {qualityLabel && (
            <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-violet-500/20 text-[var(--color-lilac)] text-[11px] font-bold tracking-wide">{qualityLabel}</span>
          )}
        </div>
      )}

      {/* Top bar in fullscreen: back button and channel info */}
      {showOverlayTitle && controlsVisible && (
        <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 bg-linear-to-b from-black/80 to-transparent z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={(e) => { e.stopPropagation(); goBack(); }}
              className="w-10 h-10 shrink-0 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors"
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>

            {displayName && (
              <>
                {channel?.logo && !logoFailed ? (
                  <img
                    src={channel.logo}
                    alt=""
                    className="w-10 h-10 shrink-0 rounded-sm object-contain bg-gray-900"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <div
                    className="w-10 h-10 shrink-0 rounded-sm flex items-center justify-center"
                    style={{ backgroundColor: getChannelColor(displayName) }}
                  >
                    <span className="text-white text-sm font-bold">{getChannelInitials(displayName)}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-base sm:text-lg truncate">{displayName}</h3>
                  {channel?.group && <p className="text-gray-300 text-sm truncate">{channel.group}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {streamLoaded && !error && controlsVisible && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-[rgb(18_17_29/0.92)] to-transparent px-3 sm:px-5 pt-8 pb-3 sm:pb-4 z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-3">
            {showTimeline && (
              <div className="flex items-center gap-2 w-full">
                <span className="text-xs text-gray-300 w-14 text-center tabular-nums">{formatTime(currentTime)}</span>
                <div
                  ref={progressBarRef}
                  className="relative grow h-4 flex items-center cursor-pointer touch-none group/seek"
                  onPointerDown={onSeekPointerDown}
                  onPointerMove={onSeekPointerMove}
                  onPointerUp={onSeekPointerUp}
                  onPointerCancel={onSeekPointerUp}
                >
                  <div className="relative w-full h-1.5 group-hover/seek:h-2 transition-[height] bg-white/20 rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufferedProgress}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,#8b5cf6,#f43f5e)]" style={{ width: `${progress}%` }} />
                  </div>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-sm opacity-0 group-hover/seek:opacity-100 transition-opacity"
                    style={{ left: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-gray-300 w-14 text-center tabular-nums">{formatTime(duration)}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={togglePlay}
                  className={ctlButton}
                  title={playerState.isPlaying ? 'Pause (k)' : 'Play (k)'}
                  aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
                >
                  {playerState.isPlaying ? <Pause className="w-[22px] h-[22px] fill-current" /> : <Play className="w-[22px] h-[22px] fill-current" />}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleMute}
                    className={ctlButton}
                    title={playerState.isMuted ? 'Unmute (m)' : 'Mute (m)'}
                  >
                    {playerState.isMuted || playerState.volume === 0
                      ? <VolumeX className="w-5 h-5" />
                      : <Volume2 className="w-5 h-5" />}
                  </button>
                  <div
                    ref={volumeBarRef}
                    className="hidden md:flex items-center w-20 h-4 cursor-pointer touch-none"
                    onPointerDown={onVolumePointerDown}
                    onPointerMove={onVolumePointerMove}
                    onPointerUp={onVolumePointerUp}
                    onPointerCancel={onVolumePointerUp}
                  >
                    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white rounded-full"
                        style={{ width: `${playerState.isMuted ? 0 : playerState.volume * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {isLive && (
                  <div className="flex items-center gap-1.5 ml-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--color-live)] shadow-[0_0_6px_rgb(251_113_133/0.7)]" />
                    <span className="text-xs font-bold tracking-[0.06em] text-[var(--color-text)]">LIVE</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 sm:gap-2">
                <span className="hidden md:inline text-xs font-semibold text-[var(--color-muted)] mr-1">
                  {currentQuality === 'auto' ? 'Auto' : 'Manual'}{qualityLabel ? ` · ${qualityLabel}` : ''}
                </span>
                {!preview && (
                  <button
                    onClick={handlePictureInPicture}
                    className={ctlButton}
                    title="Picture in Picture (keeps playing while you browse)"
                  >
                    <PictureInPicture className="w-5 h-5" />
                  </button>
                )}

                {qualities.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowQualityMenu(open => !open)}
                      className={ctlButton}
                      title="Quality"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                    {showQualityMenu && (
                      <div className="absolute bottom-full right-0 mb-2 w-44 max-h-64 overflow-y-auto bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl shadow-[var(--shadow-card-hover)] p-1.5 z-40">
                        <div className="text-xs text-gray-400 mb-1 px-2">Quality</div>
                        <button
                          onClick={() => handleQualityChange('auto')}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${currentQuality === 'auto' ? 'bg-violet-500/25 text-white' : 'hover:bg-white/10'}`}
                        >
                          Auto
                        </button>
                        {qualities.map(quality => (
                          <button
                            key={quality.id}
                            onClick={() => handleQualityChange(quality.id)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${currentQuality === quality.id ? 'bg-violet-500/25 text-white' : 'hover:bg-white/10'}`}
                          >
                            {quality.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {showOverlayTitle && (
                  <button
                    onClick={toggleFavorite}
                    disabled={!channel}
                    className={`${ctlButton} ${isFavorite ? 'text-rose-400' : ''} disabled:opacity-50`}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Heart className={isFavorite ? 'w-5 h-5 fill-current' : 'w-5 h-5'} />
                  </button>
                )}

                <button
                  onClick={toggleFullscreen}
                  className={ctlButton}
                  title={playerState.isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
                >
                  {playerState.isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Debug overlay (press "i") */}
      {showDebug && (
        <div className="absolute top-16 right-4 bg-black/80 p-3 rounded-sm text-xs text-gray-300 max-w-xs overflow-auto max-h-[50vh] z-40">
          <h4 className="font-bold mb-1">Debug Info</h4>
          <div>Channel: {displayName || 'Unknown'}</div>
          <div>Quality: {qualityLabel || 'Auto'}</div>
          <div>Live: {isLive ? 'Yes' : 'No'}</div>
          <div>Time: {formatTime(currentTime)} / {formatTime(duration)}</div>
          <div>ReadyState: {videoRef.current?.readyState ?? 'N/A'}</div>
          <div>Engine: {hlsRef.current ? 'hls.js' : 'native'}</div>
          <div>PiP: {pipStatus}</div>
          <div className="break-all">URL: {streamUrl || id}</div>
        </div>
      )}
    </div>
  );

  if (preview) return videoBox;

  const metaLine = [capitalize(channel?.group !== 'Uncategorized' ? channel?.group : ''), hostnameOf(streamUrl)]
    .filter(Boolean).join(' · ');

  return (
    <div className="pb-8">
      {/* Top bar: back + breadcrumb */}
      <div className="flex items-center gap-3 mb-5 min-w-0">
        <button onClick={() => goBack()} className="btn h-9 px-3 text-[var(--color-muted)] hover:text-white hover:bg-white/6">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <nav className="flex items-center gap-2 text-sm min-w-0" aria-label="Breadcrumb">
          {channel?.group && channel.group !== 'Uncategorized' && (
            <>
              <span className="text-[var(--color-muted)] shrink-0">{capitalize(channel.group)}</span>
              <span className="text-[var(--color-subtle)]">/</span>
            </>
          )}
          <span className="font-semibold text-[var(--color-text)] truncate">{displayName}</span>
        </nav>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {videoBox}

          {/* Channel info */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:px-5 sm:min-h-24 rounded-2xl bg-[var(--color-card)] border border-[var(--color-hairline)]">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {channel?.logo && !logoFailed ? (
                <img src={channel.logo} alt="" className="w-14 h-14 shrink-0 rounded-xl object-contain bg-white/5 p-1.5" onError={() => setLogoFailed(true)} />
              ) : (
                <div className="w-14 h-14 shrink-0 rounded-xl flex items-center justify-center" style={{ backgroundColor: getChannelColor(displayName || '?') }}>
                  <span className="text-white text-lg font-bold">{getChannelInitials(displayName || '?')}</span>
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-[-0.005em] text-[var(--color-text)] truncate">{displayName || 'Loading…'}</h1>
                <div className="flex items-center gap-2 mt-1.5 min-w-0">
                  {(isLive || loading) && <span className="live-badge shrink-0">LIVE</span>}
                  {metaLine && <span className="text-[13px] text-[var(--color-muted)] truncate">{metaLine}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={toggleFavorite} disabled={!channel} className="btn btn-secondary disabled:opacity-50" aria-pressed={isFavorite}>
                <Heart className={`w-4 h-4 ${isFavorite ? 'text-rose-400 fill-rose-400' : ''}`} />
                {isFavorite ? 'Favorited' : 'Favorite'}
              </button>
              <button onClick={shareChannel} className="btn btn-secondary">
                {shared ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {shared ? 'Link copied' : 'Share'}
              </button>
              <button onClick={handlePictureInPicture} className="btn px-3 text-[var(--color-muted)] hover:text-white hover:bg-white/6" title="Keep playing in a mini player while you browse">
                <PictureInPicture className="w-4 h-4" />
                <span className="hidden sm:inline">Mini player</span>
              </button>
            </div>
          </div>
        </div>

        {/* Up next */}
        <aside className="flex flex-col gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Up next</h2>
            <span className="flex-1" />
            {upNext.length > 0 && channel?.group && (
              <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-white/6 text-[11px] font-semibold text-[var(--color-muted)]">
                {capitalize(channel.group)} · {upNext.length}
              </span>
            )}
          </div>
          {upNext.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
              {upNext.map(item => (
                <ChannelCard
                  key={item.url}
                  href={item.id ? watchPath(item, { preferId: true }) : watchPathForStream(item.url, item.name)}
                  name={item.name}
                  logo={item.logo}
                  group={capitalize(item.group)}
                  country={item.country}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--color-line)] p-5 text-sm text-[var(--color-muted)]">
              {streamLoaded ? 'No other channels in this category yet.' : 'Similar channels appear here once the stream starts.'}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
