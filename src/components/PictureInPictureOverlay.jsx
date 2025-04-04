import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { usePictureInPicture } from '../contexts/PictureInPictureContext';
import { X, Volume2, AlertTriangle, Tv2, Maximize, Loader, RefreshCw } from 'lucide-preact';

export function PictureInPictureOverlay() {
  const { 
    pipChannel, 
    pipVideo, 
    pipError, 
    exitPiP, 
    activatePendingPiP, 
    pipStatus, 
    isSupported 
  } = usePictureInPicture();
  
  const [visible, setVisible] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  
  // Show the overlay whenever we have a channel (even if PiP isn't active yet)
  useEffect(() => {
    if (pipVideo || pipChannel || pipStatus !== 'inactive') {
      setVisible(true);
    } else {
      // Add a small delay before hiding to make transitions smoother
      const hideTimer = setTimeout(() => {
        setVisible(false);
      }, 300);
      
      return () => clearTimeout(hideTimer);
    }
  }, [pipVideo, pipChannel, pipStatus]);

  // Handle double-click on overlay header to show debug info
  const handleHeaderDoubleClick = () => {
    setShowDebug(prev => !prev);
  };

  // If not visible, don't render anything
  if (!visible) return null;
  
  if (!isSupported) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-red-900/80 p-3 rounded-lg shadow-lg text-white">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-300" />
          <span className="text-sm">PiP not supported in this browser</span>
        </div>
      </div>
    );
  }
  
  // Handle different status states
  let statusClass = 'bg-gray-800';
  let isClickable = false;
  let statusIcon = <Tv2 className="w-4 h-4 text-blue-400" />;
  
  switch (pipStatus) {
    case 'pending':
    case 'needsActivation':
      statusClass = 'bg-blue-900/80';
      isClickable = true;
      statusIcon = <Maximize className="w-4 h-4 text-blue-300" />;
      break;
    case 'initializing':
    case 'loading':
    case 'restoring':
    case 'activating':
      statusClass = 'bg-blue-800/80';
      statusIcon = <Loader className="w-4 h-4 text-blue-300 animate-spin" />;
      break;
    case 'error':
      statusClass = 'bg-red-900/80';
      statusIcon = <AlertTriangle className="w-4 h-4 text-red-300" />;
      break;
    case 'active':
      statusClass = 'bg-gray-800/80';
      statusIcon = <Tv2 className="w-4 h-4 text-blue-400" />;
      break;
  }
  
  // Check if this is a pending PiP activation (needs user action)
  const needsActivation = ['pending', 'needsActivation'].includes(pipStatus);
  
  // Show activation message if we need activation or have an error about activation
  const showActivationMessage = needsActivation || 
    (pipError && pipError.includes('activate'));
  
  // Get a user friendly status message
  const getStatusMessage = () => {
    switch (pipStatus) {
      case 'pending':
      case 'needsActivation':
        return 'Click to activate PiP';
      case 'initializing':
        return 'Initializing...';
      case 'loading':
        return 'Loading stream...';
      case 'restoring':
      case 'activating':
        return 'Activating PiP...';
      case 'error':
        return pipError || 'PiP Error';
      default:
        return pipError || null;
    }
  };
  
  const statusMessage = getStatusMessage();
  
  return (
    <div 
      className={`fixed bottom-4 right-4 z-50 ${statusClass} p-3 rounded-lg shadow-lg text-white 
        transition-all duration-300 ${isClickable ? 'cursor-pointer animate-pulse hover:bg-blue-800' : ''}`}
      onClick={isClickable ? activatePendingPiP : undefined}
    >
      <div className="flex flex-col">
        {/* Channel name */}
        <div 
          className="flex items-center gap-2 mb-1"
          onDoubleClick={handleHeaderDoubleClick}
        >
          {statusIcon}
          <span className="font-medium text-sm">
            {pipChannel ? (pipChannel.name || 'Picture in Picture') : 'PiP'}
          </span>
          
          {/* Status indicator */}
          {pipStatus && pipStatus !== 'active' && pipStatus !== 'inactive' && !showDebug && (
            <span className="text-xs bg-black/30 px-1.5 py-0.5 rounded">
              {pipStatus}
            </span>
          )}
          
          {/* Only show exit button if PiP is actually active or loading */}
          {(pipVideo || ['loading', 'initializing', 'playing'].includes(pipStatus)) && (
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Don't trigger parent onClick
                exitPiP();
              }}
              className="ml-auto p-1 rounded-full hover:bg-gray-700 transition-colors"
              title="Close PiP"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        
        {/* Debug info */}
        {showDebug && (
          <div className="bg-black/50 p-2 rounded mb-2 text-xs">
            <div>Status: <span className="text-blue-300">{pipStatus}</span></div>
            <div>Has Video: <span className="text-blue-300">{pipVideo ? 'Yes' : 'No'}</span></div>
            <div>Has Channel: <span className="text-blue-300">{pipChannel ? 'Yes' : 'No'}</span></div>
            <div>Doc PiP Element: <span className="text-blue-300">
              {document.pictureInPictureElement ? 'Yes' : 'No'}
            </span></div>
            <div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  activatePendingPiP();
                }}
                className="mt-1 px-2 py-0.5 bg-blue-800 hover:bg-blue-700 rounded text-xs flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Retry Activation
              </button>
            </div>
          </div>
        )}
        
        {/* Special message for pending activation */}
        {showActivationMessage && (
          <div className="flex items-center gap-2 bg-blue-800/50 px-2 py-1.5 rounded">
            <Maximize className="w-4 h-4 text-blue-300" />
            <span className="text-sm text-blue-100">Click to activate PiP</span>
          </div>
        )}
        
        {/* Status message */}
        {statusMessage && !showActivationMessage && (
          <div className="flex items-center gap-1 bg-black/30 px-2 py-0.5 rounded">
            {pipStatus === 'error' ? (
              <AlertTriangle className="w-3 h-3 text-yellow-400" />
            ) : (
              <StatusIcon status={pipStatus} />
            )}
            <span className="text-xs text-gray-300">{statusMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper component to show appropriate icon for each status
function StatusIcon({ status }) {
  switch (status) {
    case 'loading':
    case 'initializing':
    case 'restoring':
    case 'activating':
      return <Loader className="w-3 h-3 text-blue-400 animate-spin" />;
    case 'active':
    case 'ready':
    case 'playing':
      return <Tv2 className="w-3 h-3 text-blue-400" />;
    default:
      return <Tv2 className="w-3 h-3 text-gray-400" />;
  }
}