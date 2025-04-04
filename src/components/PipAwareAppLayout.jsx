import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { usePictureInPicture } from '../contexts/PictureInPictureContext';

export function PipAwareAppLayout({ children }) {
  const { pipVideo, isPipActive } = usePictureInPicture();
  const [currentPath, setCurrentPath] = useState(location.pathname);

  // Track current path to detect navigation
  useEffect(() => {
    setCurrentPath(location.pathname);
    
    // Listen for route changes
    const handleRouteChange = () => {
      setCurrentPath(location.pathname);
    };
    
    window.addEventListener('popstate', handleRouteChange);
    
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, [location.pathname]);

  // Add class to body when PiP is active 
  useEffect(() => {
    if (isPipActive) {
      document.body.classList.add('pip-active');
    } else {
      document.body.classList.remove('pip-active');
    }

    return () => {
      document.body.classList.remove('pip-active');
    };
  }, [isPipActive, currentPath]);

  return (
    <div className={`app-layout ${isPipActive ? 'has-pip' : ''}`}>
      {children}
    </div>
  );
}
