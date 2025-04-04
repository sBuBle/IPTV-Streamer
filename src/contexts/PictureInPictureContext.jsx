import { h, createContext } from 'preact';
import { useState, useContext, useEffect, useRef, useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import Hls from 'hls.js';
import { savePipState, loadPipState, clearPipState } from '../utils/pipStateManager';

// Debug flag - set to true to enable verbose logging
const DEBUG_PIP = true;

const debugLog = (...args) => {
  if (DEBUG_PIP) {
    console.log('[PiP]', ...args);
  }
};

const PictureInPictureContext = createContext({
  enterPiP: () => {},
  exitPiP: () => {},
  pipVideo: null,
  isPipActive: false,
  activatePendingPiP: () => {},
  pipChannel: null,
  pipError: null,
  pipStatus: 'inactive', // Add status for better diagnostic
});

export function PictureInPictureProvider({ children }) {
  const [pipVideo, setPipVideo] = useState(null);
  const [pipChannel, setPipChannel] = useState(null);
  const pipHlsRef = useRef(null);
  const pipVideoRef = useRef(null);
  const [pipError, setPipError] = useState(null);
  const [isSwitchingPip, setIsSwitchingPip] = useState(false);
  const [currentStreamUrl, setCurrentStreamUrl] = useState(null);
  // Add status state to track PiP lifecycle better
  const [pipStatus, setPipStatus] = useState('inactive'); // inactive, pending, active, error
  const statusTimerRef = useRef(null);
  
  // Check if browser supports PiP
  const isPipSupported = useCallback(() => {
    try {
      return document && document.pictureInPictureEnabled && typeof HTMLVideoElement !== 'undefined' && 
        HTMLVideoElement.prototype.requestPictureInPicture;
    } catch (e) {
      return false;
    }
  }, []);

  useEffect(() => {
    // Log PiP support state 
    debugLog('PiP supported:', isPipSupported());
    // If PiP is not supported, log a warning
    if (!isPipSupported()) {
      console.warn('Picture-in-Picture is not supported in this browser');
    }
  }, []);

  // Restore PiP state when the component mounts
  useEffect(() => {
    const restorePipState = async () => {
      // Don't attempt to restore if PiP is already active
      if (pipVideo || document.pictureInPictureElement) {
        debugLog('PiP already active, not restoring state');
        return;
      }
      
      const savedState = loadPipState();
      if (savedState && savedState.streamUrl && savedState.channel) {
        debugLog('Attempting to restore PiP for:', savedState.channel.name);
        setPipStatus('restoring');
        
        // Wait a bit to ensure DOM is fully loaded
        setTimeout(() => {
          enterPiP(savedState.channel, savedState.streamUrl, savedState.options || {});
        }, 1000);
      } else {
        debugLog('No PiP state to restore');
      }
    };
    
    if (isPipSupported()) {
      restorePipState();
    }
    
    // Cleanup all PiP resources when component unmounts
    return () => {
      debugLog('PiP provider unmounting, cleaning up resources');
      cleanupPipResources(true); // Force cleanup
      
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, [isPipSupported]);

  // Listen for popstate events (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      // If we have PiP active and we're not on the Player page that opened it
      // we need to make sure the PiP stays active
      if (pipVideo && pipChannel && currentStreamUrl) {
        debugLog('Navigation occurred, ensuring PiP stays active');
        
        // Re-save the state to keep it fresh
        savePipState(pipChannel, currentStreamUrl, {
          wasMuted: pipVideo.muted,
          volume: pipVideo.volume,
          isLive: true
        });
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [pipVideo, pipChannel, currentStreamUrl]);

  // Monitor for document visibility changes to handle tab switching
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && pipVideo && !document.pictureInPictureElement) {
        debugLog('Tab hidden - attempting to restore PiP');
        
        // Try to re-request PiP when switching back to the tab
        // This helps with some browsers that exit PiP when tab loses focus
        try {
          if (pipVideoRef.current) {
            setPipStatus('reactivating');
            pipVideoRef.current.requestPictureInPicture().catch(err => {
              debugLog('Failed to reactivate PiP:', err);
              // If we can't reactivate, just update the status
              setPipStatus(pipVideo ? 'active' : 'inactive');
            });
          }
        } catch (e) {
          debugLog('Error reactivating PiP:', e);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pipVideo]);

  // Helper function to clean up PiP resources
  const cleanupPipResources = (force = false) => {
    // Only proceed with cleanup if we're not switching or force is true
    if (isSwitchingPip && !force) {
      debugLog('Skipping cleanup during switching');
      return;
    }
    
    debugLog('Cleaning up PiP resources');
    
    if (pipVideoRef.current) {
      try {
        // Cleanup event listeners
        pipVideoRef.current.removeEventListener('leavepictureinpicture', handleLeavePiP);
        pipVideoRef.current.removeEventListener('error', handlePipError);
        
        // Exit PiP if active
        if (document.pictureInPictureElement === pipVideoRef.current) {
          debugLog('Exiting PiP mode');
          document.exitPictureInPicture().catch(e => 
            console.warn('Error exiting picture-in-picture:', e)
          );
        }
      } catch (e) {
        console.warn('Error during PiP cleanup:', e);
      }
    }
    
    // Destroy HLS instance if exists
    if (pipHlsRef.current) {
      try {
        pipHlsRef.current.destroy();
      } catch (e) {
        console.warn('Error destroying HLS instance:', e);
      }
      pipHlsRef.current = null;
    }
    
    // Remove video element from DOM
    if (pipVideoRef.current && pipVideoRef.current.parentNode) {
      pipVideoRef.current.parentNode.removeChild(pipVideoRef.current);
    }
    
    // Clear references
    pipVideoRef.current = null;
    setPipVideo(null);
    setPipChannel(null);
    setPipError(null);
    setCurrentStreamUrl(null);
    setPipStatus('inactive');
    
    // Clear stored PiP state
    clearPipState();
  };

  // Handler for when PiP mode is exited by the browser
  const handleLeavePiP = useCallback((event) => {
    debugLog('PiP was closed by browser or user');
    
    // Only clean up resources if we're not in the middle of switching
    // and it wasn't triggered by our own cleanup
    if (!isSwitchingPip) {
      setPipStatus('closing');
      
      // Use a small delay to allow for proper state transitions
      statusTimerRef.current = setTimeout(() => {
        cleanupPipResources();
      }, 100);
    }
  }, [isSwitchingPip]);

  // Handler for PiP video errors
  const handlePipError = useCallback((event) => {
    console.error('PiP playback error:', event);
    setPipError(`Playback error: ${event.type}`);
    setPipStatus('error');
    
    // Try to recover, but if it fails, exit PiP
    if (pipHlsRef.current) {
      try {
        pipHlsRef.current.recoverMediaError();
      } catch (e) {
        debugLog('Failed to recover from error, exiting PiP');
        exitPiP();
      }
    } else {
      exitPiP();
    }
  }, [/* exitPiP will be defined below */]);

  const enterPiP = useCallback(async (channel, streamUrl, options = {}) => {
    if (!isPipSupported()) {
      setPipError("Picture-in-Picture not supported in this browser");
      return;
    }
    
    if (!channel || !streamUrl) {
      console.error('Missing required parameters for PiP:', channel, streamUrl);
      return;
    }
    
    // First save the PiP state regardless of whether we need user gesture
    // This ensures the channel info is available for the overlay
    savePipState(channel, streamUrl, {...options, pendingPiP: true});
    
    // Set channel info immediately so overlay can show it
    setPipChannel(channel);
    
    // Store parameters for delayed PiP activation via user gesture
    // When coming from a button click in Player.jsx, we should have this flag
    if (!options.fromUserGesture) {
      debugLog('User gesture required, showing activation prompt');
      setPipStatus('pending');
      setPipError("Click to activate PiP");
      return;
    }
    
    try {
      // Set flag to prevent cleanup during switching
      setIsSwitchingPip(true);
      // Clear any previous error
      setPipError(null);
      setPipStatus('initializing');
      
      // Cleanup any existing PiP
      if (document.pictureInPictureElement || pipVideo) {
        debugLog('Existing PiP found, cleaning up');
        await exitPipInternal();
      }
      
      debugLog('Entering PiP for:', channel.name, streamUrl);
      
      // Create new video element
      const newPipVideo = document.createElement('video');
      newPipVideo.muted = options.wasMuted !== undefined ? options.wasMuted : true;
      newPipVideo.autoplay = true;
      newPipVideo.playsInline = true;
      newPipVideo.style.opacity = '0';
      newPipVideo.className = 'pip-video-element';
      newPipVideo.style.position = 'fixed';
      newPipVideo.style.left = '-9999px';
      newPipVideo.style.width = '10px';
      newPipVideo.setAttribute('playsinline', '');
      newPipVideo.setAttribute('webkit-playsinline', '');
      pipVideoRef.current = newPipVideo;
      
      // Add to DOM (required for PiP)
      document.body.appendChild(newPipVideo);

      // Set up event listeners
      newPipVideo.addEventListener('leavepictureinpicture', handleLeavePiP);
      newPipVideo.addEventListener('error', handlePipError);
      
      // Set channel information and stream URL
      setCurrentStreamUrl(streamUrl);
      setPipChannel(channel);
      
      // Save state for persistence (but not as pending anymore)
      savePipState(channel, streamUrl, {...options, pendingPiP: false});
      
      // Set up streaming
      let initSuccess = false;
      if (Hls.isSupported()) {
        setPipStatus('loading');
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          startLevel: -1,
          fragLoadingMaxRetry: 5,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          // Add these configs to help with buffer stalled errors
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
          highBufferWatchdogPeriod: 3,
          // Add a more generous timeout
          manifestLoadingTimeOut: 10000,
          manifestLoadingMaxRetryTimeout: 64000,
          levelLoadingTimeOut: 10000,
          fragLoadingTimeOut: 20000
        });
        
        // Set up event listeners
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          debugLog("PiP: Media attached");
        });
        
        // Enhanced MANIFEST_PARSED handler with better error recovery
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          debugLog("PiP: Manifest parsed, ready to play");
          initSuccess = true;
          setPipStatus('ready');
          
          // Start playback
          newPipVideo.play().then(async () => {
            setPipStatus('playing');
            try {
              // Request PiP mode (requires user gesture)
              // If this fails, we'll provide a button in the overlay
              await newPipVideo.requestPictureInPicture();
              setPipVideo(newPipVideo);
              setPipError(null);
              setPipStatus('active');
              
              // Apply volume setting
              if (typeof options.volume === 'number') {
                newPipVideo.volume = options.volume;
              }
              
              // Apply muted state if specified
              if (options.wasMuted === false) {
                setTimeout(() => {
                  newPipVideo.muted = false;
                }, 1000);
              }
            } catch (err) {
              // If it's a user gesture error, we'll just keep the video playing
              // and show a message to click on the indicator
              if (err.name === 'NotAllowedError') {
                debugLog('PiP requires user gesture:', err);
                setPipVideo(newPipVideo); // Still set the video reference
                setPipError('Click to activate PiP mode');
                setPipStatus('needsActivation');
                
                // Set special flag in state to know we need activation
                savePipState(channel, streamUrl, {...options, needsActivation: true});
              } else {
                console.error("Failed to enter PiP mode:", err);
                setPipStatus('error');
                cleanupPipResources();
                setPipError("Failed to enter PiP mode: " + err.message);
              }
            }
          }).catch(e => {
            console.error("PiP playback failed to start:", e);
            setPipStatus('error');
            cleanupPipResources();
            setPipError("Playback failed to start: " + e.message);
          });
        });
        
        // Enhanced ERROR handler to better recover from buffer stalls
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.warn("PiP HLS error:", data.type, data.details);
          
          // Special handling for buffer stalled errors
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            debugLog('Buffer stalled, attempting recovery...');
            
            try {
              // Try to recover by jumping forward slightly
              if (newPipVideo.readyState > 0 && !newPipVideo.paused) {
                const currentTime = newPipVideo.currentTime;
                newPipVideo.currentTime = currentTime + 0.5;
                hls.startLoad();
              }
              return; // Don't treat this as fatal
            } catch (e) {
              console.warn('Recovery from buffer stall failed:', e);
            }
          }
          
          if (data.fatal) {
            setPipStatus('error');
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // For network errors, try to recover
                debugLog('PiP fatal network error, trying to recover');
                setPipError(`Network error: ${data.details}`);
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                // For media errors, try to recover
                debugLog('PiP fatal media error, trying to recover');
                setPipError(`Media error: ${data.details}`);
                hls.recoverMediaError();
                break;
              default:
                // For other fatal errors, give up
                console.error('Unrecoverable PiP HLS error:', data);
                cleanupPipResources();
                setPipError(`Fatal stream error: ${data.details}`);
                break;
            }
          }
        });
        
        // Initialize playback
        pipHlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(newPipVideo);
        
        // Set a timeout to check if initialization succeeded
        setTimeout(() => {
          if (!initSuccess && pipVideoRef.current === newPipVideo) {
            debugLog("PiP initialization timed out");
            setPipStatus('error');
            cleanupPipResources();
            setPipError("Stream initialization timed out");
          }
        }, 10000);
        
      } else if (newPipVideo.canPlayType('application/vnd.apple.mpegurl')) {
        // For Safari
        debugLog('Using native HLS for Safari');
        setPipStatus('loading');
        newPipVideo.src = streamUrl;
        
        newPipVideo.addEventListener('loadedmetadata', async () => {
          debugLog('Safari: loadedmetadata event');
          try {
            initSuccess = true;
            setPipStatus('playing');
            await newPipVideo.play();
            await newPipVideo.requestPictureInPicture();
            setPipVideo(newPipVideo);
            setPipStatus('active');
            
            // Apply volume setting
            if (typeof options.volume === 'number') {
              newPipVideo.volume = options.volume;
            }
          } catch (err) {
            console.error('Failed to enter PiP mode in Safari:', err);
            setPipStatus('error');
            cleanupPipResources();
            setPipError("Failed to enter PiP mode: " + err.message);
          }
        });
        
        // Set a timeout for Safari too
        setTimeout(() => {
          if (!initSuccess && pipVideoRef.current === newPipVideo) {
            debugLog("PiP initialization timed out in Safari");
            setPipStatus('error');
            cleanupPipResources();
            setPipError("Stream initialization timed out");
          }
        }, 10000);
      } else {
        throw new Error('HLS is not supported in this browser');
      }
    } catch (error) {
      console.error('Error setting up PiP mode:', error);
      setPipStatus('error');
      cleanupPipResources();
      setPipError("Failed to setup PiP: " + error.message);
    } finally {
      // Wait a moment before resetting the switching flag
      setTimeout(() => {
        setIsSwitchingPip(false);
      }, 1000);
    }
  }, [isPipSupported, handleLeavePiP, handlePipError]);

  // Internal method to exit PiP without affecting the switching flag
  const exitPipInternal = async () => {
    debugLog('Internal PiP exit');
    if (pipVideoRef.current) {
      try {
        // Remove event listeners
        pipVideoRef.current.removeEventListener('leavepictureinpicture', handleLeavePiP);
        pipVideoRef.current.removeEventListener('error', handlePipError);
        
        // Exit picture-in-picture mode if active
        if (document.pictureInPictureElement === pipVideoRef.current) {
          debugLog('Exiting active PiP mode');
          await document.exitPictureInPicture().catch(err => {
            console.warn("Error exiting PiP:", err);
          });
        }
      } catch (e) {
        console.warn('Error closing PiP:', e);
      }
    }
    
    // Cleanup HLS instance
    if (pipHlsRef.current) {
      try {
        pipHlsRef.current.destroy();
      } catch (e) {
        console.warn('Error destroying HLS:', e);
      }
      pipHlsRef.current = null;
    }
    
    // Remove video element
    if (pipVideoRef.current && pipVideoRef.current.parentNode) {
      pipVideoRef.current.parentNode.removeChild(pipVideoRef.current);
      pipVideoRef.current = null;
    }
    
    // Clear state
    setPipVideo(null);
    setPipChannel(null);
    setPipError(null);
    setCurrentStreamUrl(null);
    setPipStatus('inactive');
    clearPipState();
  };

  const exitPiP = useCallback(() => {
    debugLog('Exiting PiP');
    // Set switching flag to prevent duplicate cleanups
    setIsSwitchingPip(true);
    setPipStatus('closing');
    
    exitPipInternal().catch(err => {
      console.error("Error in exitPiP:", err);
      setPipStatus('error');
    }).finally(() => {
      // Reset switching flag
      setTimeout(() => {
        setIsSwitchingPip(false);
      }, 500);
    });
  }, []);

  // Add a new function to activate PiP when user clicks the indicator
  const activatePendingPiP = useCallback(async () => {
    debugLog('Activating pending PiP');
    
    // Check if we have a pending PiP activation
    const savedState = loadPipState();
    if (!savedState) {
      console.warn('No PiP state found to activate');
      return;
    }
    
    const { channel, streamUrl, options } = savedState;
    debugLog('Activating PiP for:', channel.name);
    
    // Clear any error since user is responding to the prompt
    setPipError(null);
    setPipStatus('activating');
    
    // If we already have a video element that just needs PiP activation
    if (pipVideoRef.current && pipStatus === 'needsActivation') {
      try {
        debugLog('Using existing video element for PiP');
        await pipVideoRef.current.requestPictureInPicture();
        setPipVideo(pipVideoRef.current);
        setPipStatus('active');
        
        // Update state to no longer pending
        savePipState(channel, streamUrl, {
          ...options, 
          pendingPiP: false, 
          needsActivation: false
        });
        return;
      } catch (err) {
        debugLog('Failed to activate existing video element:', err);
        // Fall through to restart approach
      }
    }
    
    // Start from scratch with user gesture flag
    enterPiP(channel, streamUrl, {
      ...options, 
      fromUserGesture: true, 
      pendingPiP: false
    });
  }, [pipStatus, enterPiP]);

  // Debug: Log state changes
  useEffect(() => {
    debugLog('PiP Status changed:', pipStatus);
  }, [pipStatus]);

  return (
    <PictureInPictureContext.Provider
      value={{
        enterPiP,
        exitPiP,
        pipVideo,
        pipChannel,
        pipError,
        isPipActive: !!pipVideo,
        activatePendingPiP,
        pipStatus,
        isSupported: isPipSupported()
      }}
    >
      {children}
    </PictureInPictureContext.Provider>
  );
}

export function usePictureInPicture() {
  return useContext(PictureInPictureContext);
}
