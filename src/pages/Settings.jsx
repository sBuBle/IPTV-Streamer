import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Trash2, Plus, RefreshCw, Globe, AlertCircle, Upload } from 'lucide-preact';
import { getPlaylists, removePlaylist } from '../utils/playlist';
import { fetchPlaylist } from '../utils/simpleParser';
import { get, set } from '../utils/idbStorage';

export default function SettingsPage() {
  const [playlists, setPlaylists] = useState([]);
  const [newPlaylistUrl, setNewPlaylistUrl] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshingId, setRefreshingId] = useState(null);
  const [refreshSuccess, setRefreshSuccess] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadPlaylists();
    checkStorageUsage();
    
    // Check for URL param and pre-fill form
    try {
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('url');
      
      if (urlParam) {
        setNewPlaylistUrl(urlParam);
        // Try to generate a reasonable name from the URL
        const urlObj = new URL(urlParam);
        const hostName = urlObj.hostname.replace('www.', '').split('.')[0];
        setNewPlaylistName(`${hostName.charAt(0).toUpperCase() + hostName.slice(1)} Playlist`);
        
        // Clear the URL parameter to avoid reapplying on refresh
        window.history.replaceState({}, document.title, '/settings');
      }
    } catch (err) {
      console.error('Error parsing URL parameters:', err);
    }
  }, []);

  async function loadPlaylists() {
    try {
      const savedPlaylists = await getPlaylists();
      setPlaylists(savedPlaylists);
    } catch (err) {
      console.error('Failed to load playlists:', err);
      setError('Failed to load playlists. Please try again.');
    }
  }

  async function checkStorageUsage() {
    try {
      // Check if we're in a browser that supports the estimate() API
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageInfo({
          usage: estimate.usage,
          quota: estimate.quota,
          percent: Math.round((estimate.usage / estimate.quota) * 100)
        });
      }
    } catch (err) {
      console.error("Error checking storage usage", err);
    }
  }

  async function handleAddPlaylist(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Validate URL format
      if (!newPlaylistUrl.match(/^https?:\/\/.+/i)) {
        throw new Error('Please enter a valid URL starting with http:// or https://');
      }

      // Auto-correct common URL format issues
      let correctedUrl = newPlaylistUrl;
      
      // Fix GitHub raw URLs with refs/heads/ in them (common mistake)
      if (correctedUrl.includes('raw.githubusercontent.com') && correctedUrl.includes('refs/heads/')) {
        const originalUrl = correctedUrl;
        correctedUrl = correctedUrl.replace('/refs/heads/', '/');
        console.log(`Corrected GitHub URL format: ${originalUrl} -> ${correctedUrl}`);
        setError(`Corrected URL format to: ${correctedUrl}`);
      }

      // Check if URL exists before trying to parse it as a playlist
      try {
        const testResponse = await fetch(correctedUrl, { 
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          mode: 'no-cors' // Try to at least check if resource exists
        });
        console.log('Resource check response:', testResponse);
      } catch (e) {
        console.warn('Resource existence check failed:', e);
        // Continue anyway as this is just a preliminary check
      }
      
      console.log('Adding playlist:', { url: correctedUrl, name: newPlaylistName });
      
      // Try to fetch with CORS proxy first if it's a GitHub raw URL (common source of CORS issues)
      let playlistData;
      let useProxy = false;
      
      // Try all available methods sequentially
      const fetchMethods = [
        { name: 'Direct fetch', url: correctedUrl, useProxy: false },
        { name: 'CORS proxy', url: `https://corsproxy.io/?${encodeURIComponent(correctedUrl)}`, useProxy: true },
        { name: 'Alternative proxy', url: `https://cors-anywhere.herokuapp.com/${correctedUrl}`, useProxy: true },
        { name: 'IPTV-org API', url: `https://api.iptv-org.workers.dev/?url=${encodeURIComponent(correctedUrl)}`, useProxy: true }
      ];
      
      let successfulMethod = null;
      let lastError = null;
      
      for (const method of fetchMethods) {
        try {
          console.log(`Trying ${method.name}: ${method.url}`);
          playlistData = await fetchPlaylist(method.url);
          
          if (playlistData?.segments && playlistData.segments.length > 0) {
            console.log(`${method.name} successful with ${playlistData.segments.length} channels`);
            successfulMethod = method;
            useProxy = method.useProxy;
            break;
          } else {
            console.warn(`${method.name} returned empty playlist`);
          }
        } catch (err) {
          console.warn(`${method.name} failed:`, err);
          lastError = err;
        }
      }
      
      if (!successfulMethod) {
        throw new Error(`Could not load playlist from any source. Last error: ${lastError?.message}`);
      }
      
      // Import necessary function to save playlist
      const { savePlaylist } = await import('../utils/playlist');
      
      // Pass the proxy flag to savePlaylist if we needed to use it
      const savedPlaylist = await savePlaylist(correctedUrl, newPlaylistName || 'My Playlist', useProxy);
      console.log('Playlist saved successfully:', savedPlaylist);
      
      // Verify channels were saved
      const allChannels = await get('channels') || {};
      const channelCount = allChannels[savedPlaylist.id]?.length || 0;
      console.log(`Channels saved for playlist ${savedPlaylist.id}: ${channelCount}`);
      
      await loadPlaylists();
      
      // Clear form after successful addition and show a more helpful success message
      setNewPlaylistUrl('');
      setNewPlaylistName('');
      setError(`Added playlist successfully with ${channelCount} channels. Click on it to view.`);
      
      // After 3 seconds, clear the success message
      setTimeout(() => {
        setError('');
      }, 3000);
    } catch (err) {
      console.error('Failed to add playlist:', err);
      
      // Provide helpful suggestions based on the error
      let errorMessage = `Failed to add playlist: ${err.message}`;
      
      if (err.message.includes('Not Found') || err.message.includes('404')) {
        errorMessage += "\n\nThe specified URL does not exist. Please verify it's correct.";
      } else if (err.message.includes('valid M3U8')) {
        errorMessage += "\n\nThe content at this URL is not a valid M3U8 playlist. Try viewing the URL in your browser to see what's there.";
        
        // For GitHub files, suggest checking the raw URL
        if (newPlaylistUrl.includes('github.com') && !newPlaylistUrl.includes('raw.githubusercontent.com')) {
          errorMessage += "\n\nFor GitHub files, try using the 'Raw' view URL instead of the repository URL.";
        }
      } else if (err.message.includes('CORS')) {
        errorMessage += "\n\nCORS policy prevents accessing this URL. Try using a publicly accessible URL.";
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemovePlaylist(id) {
    try {
      await removePlaylist(id);
      await loadPlaylists();
    } catch (err) {
      console.error('Failed to remove playlist:', err);
      setError(`Failed to remove playlist: ${err.message}`);
    }
  }

  async function handleRefreshPlaylist(playlistId) {
    setRefreshingId(playlistId);
    setRefreshError(null);
    
    try {
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) {
        throw new Error('Playlist not found');
      }
      
      // Import refreshPlaylist function
      const { refreshPlaylist } = await import('../utils/playlist');
      await refreshPlaylist(playlistId);
      
      // Update the playlist's last refreshed timestamp
      const updatedPlaylists = playlists.map(p => 
        p.id === playlistId ? { ...p, lastRefreshed: new Date().toISOString() } : p
      );
      
      setPlaylists(updatedPlaylists);
      setRefreshSuccess(playlistId);
      setTimeout(() => setRefreshSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to refresh playlist:', err);
      setRefreshError(`Failed to refresh: ${err.message}`);
    } finally {
      setRefreshingId(null);
    }
  }

  async function clearAllData() {
    if (confirm('This will delete all playlists and cached data. This action cannot be undone. Continue?')) {
      try {
        // Get all keys and clear them
        const keys = await get('playlists') || [];
        await set('playlists', []);
        await set('channels', {});
        await set('rawPlaylists', {});
        await set('favorites', []);
        
        // You might want to keep watchHistory for user convenience
        
        loadPlaylists();
        alert('All data has been cleared successfully.');
      } catch (err) {
        console.error('Failed to clear data:', err);
        alert('Failed to clear data: ' + err.message);
      }
    }
  }

  async function verifyStorage() {
    try {
      const allData = {
        playlists: await get('playlists') || [],
        channels: await get('channels') || {},
        rawPlaylists: await get('rawPlaylists') || {}
      };
      
      console.log('IndexedDB storage contents:', allData);
      
      // Create a report that can be copied by the user
      const dataReport = {
        playlists: allData.playlists.map(p => ({
          id: p.id,
          name: p.name,
          url: p.url,
          addedAt: p.addedAt,
          lastRefreshed: p.lastRefreshed
        })),
        channelCounts: Object.entries(allData.channels).map(([playlistId, channels]) => ({
          playlistId,
          channelCount: channels?.length || 0
        }))
      };
      
      alert(`Storage check complete. See console (F12) for details.\n\nFound ${dataReport.playlists.length} playlists and ${dataReport.channelCounts.length} channel groups.`);
      
      return allData;
    } catch (err) {
      console.error('Error verifying storage:', err);
      alert(`Error accessing storage: ${err.message}`);
      return null;
    }
  }

  async function handleFileUpload(e) {
    console.log('File input change event triggered');
    
    const file = e.target.files[0];
    if (!file) {
      console.log('No file selected');
      return;
    }

    // Validate file type
    const validTypes = ['.m3u', '.m3u8', '.txt', 'text/plain', 'application/octet-stream', 'application/x-mpegurl'];
    const fileType = file.type || file.name.split('.').pop();
    
    console.log('File selected:', {
      name: file.name,
      type: file.type,
      size: file.size,
      extension: file.name.split('.').pop()
    });
    
    setUploadedFile(file);
    setUploadedFileName(file.name);
    
    // Pre-fill the playlist name field with the file name (without extension)
    const nameWithoutExt = file.name.replace(/\.(m3u8?|txt)$/i, '');
    setNewPlaylistName(nameWithoutExt || 'Local Playlist');
  }

  async function handleAddLocalPlaylist(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!uploadedFile) {
        throw new Error('No file selected');
      }

      console.log('Processing file:', uploadedFile.name);
      
      // Create a file reader
      const fileReader = new FileReader();
      
      // Use a promise to handle file reading
      const fileContents = await new Promise((resolve, reject) => {
        fileReader.onload = (event) => resolve(event.target.result);
        fileReader.onerror = (error) => reject(new Error('Failed to read file: ' + error.message));
        fileReader.readAsText(uploadedFile);
      });
      
      if (!fileContents || fileContents.length === 0) {
        throw new Error('File is empty');
      }

      console.log(`Successfully read file: ${fileContents.length} bytes`);
      
      // Basic validation of file content
      if (!fileContents.includes('#EXTINF') && !fileContents.includes('http')) {
        throw new Error('File does not appear to be a valid playlist - missing #EXTINF tags or URLs');
      }

      // Parse the content
      const { parseM3U8 } = await import('../utils/simpleParser');
      console.log('Parsing playlist content...');
      const manifest = parseM3U8(fileContents);
      console.log('Parse result:', { 
        hasSegments: !!manifest.segments, 
        segmentCount: manifest.segments?.length || 0 
      });
      
      if (!manifest.segments || manifest.segments.length === 0) {
        throw new Error('No channels found in the file. Check format and try again.');
      }
      
      // Generate unique identifiers for this playlist
      const timestamp = Date.now();
      const pseudoUrl = `file://${uploadedFile.name}_${timestamp}`;
      const { generateStablePlaylistId } = await import('../utils/playlist');
      const playlistId = generateStablePlaylistId(pseudoUrl);
      
      console.log(`Generated playlist ID: ${playlistId}`);
      
      // Create a playlist object
      const newPlaylist = {
        id: playlistId,
        url: pseudoUrl,
        name: newPlaylistName || 'Local Playlist',
        addedAt: new Date().toISOString(),
        isLocal: true,
        fileSize: uploadedFile.size,
        fileName: uploadedFile.name
      };
      
      // Create channel objects manually
      const channels = manifest.segments.map((segment, index) => {
        // Create a unique ID for each channel
        const uniqueId = `${playlistId}_${index}`;
        
        return {
          id: uniqueId,
          name: segment.title || `Channel ${index + 1}`,
          url: segment.uri || '',
          group: segment.attributes?.['group-title'] || 'Uncategorized',
          playlistId: playlistId,
          attributes: segment.attributes || {},
          tvgId: segment.attributes?.['tvg-id'],
          tvgName: segment.attributes?.['tvg-name'],
          tvgLogo: segment.attributes?.['tvg-logo']
        };
      });
      
      console.log(`Created ${channels.length} channels`);
      
      // Save everything to IndexedDB in sequence
      try {
        // 1. Save playlist metadata
        const existingPlaylists = await get('playlists') || [];
        console.log('Saving playlist metadata...');
        await set('playlists', [...existingPlaylists, newPlaylist]);
        
        // 2. Save channels data
        console.log('Saving channel data...');
        const allChannels = await get('channels') || {};
        allChannels[playlistId] = channels;
        await set('channels', allChannels);
        
        // 3. Save raw playlist data
        console.log('Saving raw playlist data...');
        const rawPlaylists = await get('rawPlaylists') || {};
        rawPlaylists[playlistId] = manifest;
        await set('rawPlaylists', rawPlaylists);
        
        console.log('All data saved successfully!');
      } catch (storageError) {
        console.error('Failed to save data to IndexedDB:', storageError);
        throw new Error(`Storage error: ${storageError.message}. Try clearing browser data.`);
      }
      
      await loadPlaylists();
      
      // Clear form and show success message
      setUploadedFile(null);
      setUploadedFileName('');
      setNewPlaylistName('');
      setError(`Playlist "${newPlaylistName}" added with ${channels.length} channels. Click on it to view.`);
      
      setTimeout(() => setError(''), 3000);
    } catch (err) {
      console.error('Error processing local file:', err);
      setError(`Error adding local playlist: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">Playlist Management</h2>
      
      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Add New Playlist</h3>
          <a 
            href="/countries" 
            class="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Globe class="w-4 h-4" />
            Browse by Country
          </a>
        </div>
        
        <div class="flex items-center justify-between mb-6">
          <div class="flex justify-start space-x-4">
            <button
              type="button" // Add type="button" to prevent form submission
              class={`px-3 py-1 rounded-lg ${!uploadedFile ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              onClick={() => setUploadedFile(null)}
            >
              From URL
            </button>
            <button
              type="button" // Add type="button" to prevent form submission
              class={`px-3 py-1 rounded-lg ${uploadedFile ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              onClick={() => {
                // More robust file input activation with fallbacks
                try {
                  if (fileInputRef.current) {
                    console.log('Triggering file input click using ref');
                    fileInputRef.current.click();
                  } else {
                    console.warn('File input ref is null, trying alternative methods');
                    
                    // Fallback 1: Try to get by ID
                    const fileInput = document.getElementById('file-upload');
                    if (fileInput) {
                      console.log('Found input by ID, clicking');
                      fileInput.click();
                      return;
                    }
                    
                    // Fallback 2: Create a temporary input
                    console.log('Creating temporary file input');
                    const tempInput = document.createElement('input');
                    tempInput.type = 'file';
                    tempInput.accept = '.m3u,.m3u8,.txt';
                    tempInput.style.display = 'none';
                    tempInput.onchange = handleFileUpload;
                    
                    document.body.appendChild(tempInput);
                    tempInput.click();
                    
                    // Clean up after selection
                    setTimeout(() => {
                      document.body.removeChild(tempInput);
                    }, 5000);
                  }
                } catch (err) {
                  console.error('Error opening file dialog:', err);
                  alert('Could not open file selector. Please try the "Browse" button instead.');
                }
              }}
            >
              From File
            </button>
          </div>
        </div>
        
        {!uploadedFile ? (
          <form onSubmit={handleAddPlaylist} class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-2">Playlist Name</label>
              <input
                type="text"
                value={newPlaylistName}
                onInput={e => setNewPlaylistName(e.target.value)}
                placeholder="My Playlist"
                class="w-full px-4 py-2 bg-gray-700 rounded-lg border border-gray-600"
                required
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-2">M3U8 Playlist URL</label>
              <input
                type="url"
                value={newPlaylistUrl}
                onInput={e => setNewPlaylistUrl(e.target.value)}
                placeholder="https://example.com/playlist.m3u8"
                class="w-full px-4 py-2 bg-gray-700 rounded-lg border border-gray-600"
                required
              />
            </div>
            
            {error && (
              <div class="text-red-400 text-sm whitespace-pre-line">{error}</div>
            )}
            
            <button
              type="submit"
              disabled={loading}
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              {loading ? <RefreshCw class="w-4 h-4 animate-spin" /> : <Plus class="w-4 h-4" />}
              Add Playlist
            </button>
          </form>
        ) : (
          <form onSubmit={handleAddLocalPlaylist} class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-2">Playlist Name</label>
              <input
                type="text"
                value={newPlaylistName}
                onInput={e => setNewPlaylistName(e.target.value)}
                placeholder="My Local Playlist"
                class="w-full px-4 py-2 bg-gray-700 rounded-lg border border-gray-600"
                required
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-2">M3U8 File</label>
              <div class="flex flex-col">
                <div class="bg-gray-700 rounded-lg border border-gray-600 px-4 py-2 flex items-center justify-between">
                  <div class="flex items-center">
                    <Upload class="w-4 h-4 text-gray-400 mr-2" />
                    <span class={uploadedFileName ? 'text-white' : 'text-gray-400'}>
                      {uploadedFileName || 'Select an M3U8 file...'}
                    </span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => {
                      try {
                        // Try ref first
                        if (fileInputRef.current) {
                          fileInputRef.current.click();
                          return;
                        }
                        
                        // Try by ID next
                        const fileInput = document.getElementById('file-upload');
                        if (fileInput) {
                          fileInput.click();
                          return;
                        }
                        
                        // Last resort - create temporary input
                        const tempInput = document.createElement('input');
                        tempInput.type = 'file';
                        tempInput.accept = '.m3u,.m3u8,.txt';
                        tempInput.style.display = 'none';
                        tempInput.onchange = handleFileUpload;
                        document.body.appendChild(tempInput);
                        tempInput.click();
                        
                        // Clean up
                        setTimeout(() => document.body.removeChild(tempInput), 5000);
                      } catch (err) {
                        console.error('Browse button error:', err);
                      }
                    }}
                    class="text-blue-400 text-sm hover:text-blue-300"
                  >
                    Browse
                  </button>
                </div>
                <input
                  type="file"
                  ref={fileInputRef} // Use ref instead of id
                  id="file-upload" // Keep the ID for backward compatibility
                  name="file-upload" // Added name attribute
                  accept=".m3u,.m3u8,.txt,text/plain,application/octet-stream,application/x-mpegurl"
                  class="hidden"
                  onChange={handleFileUpload}
                />
                <p class="text-xs text-gray-400 mt-1">
                  Accepts .m3u, .m3u8, and .txt files
                </p>
              </div>
            </div>
            
            {error && (
              <div class="text-red-400 text-sm whitespace-pre-line">{error}</div>
            )}
            
            <button
              type="submit"
              disabled={loading || !uploadedFile}
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <RefreshCw class="w-4 h-4 animate-spin" /> : <Plus class="w-4 h-4" />}
              Add Local Playlist
            </button>
          </form>
        )}
        {uploadedFile && (
          <div class="mt-4 text-sm text-gray-400">
            Having trouble with file upload? 
            <button
              type="button"
              onClick={() => {
                const tempInput = document.createElement('input');
                tempInput.type = 'file';
                tempInput.accept = '.m3u,.m3u8,.txt';
                tempInput.onchange = handleFileUpload;
                document.body.appendChild(tempInput);
                tempInput.click();
                setTimeout(() => document.body.removeChild(tempInput), 5000);
              }}
              class="ml-2 text-blue-400 underline hover:text-blue-300"
            >
              Try alternative upload method
            </button>
          </div>
        )}
      </div>

      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <h3 class="text-lg font-semibold mb-4">Managed Playlists</h3>
        
        {playlists.length === 0 ? (
          <div class="flex items-center gap-4 bg-gray-700 p-4 rounded-lg">
            <AlertCircle class="w-6 h-6 text-yellow-400" />
            <p class="text-gray-300">No playlists added yet. Add your first playlist above.</p>
          </div>
        ) : (
          <div class="space-y-4">
            {playlists.map(playlist => (
              <div key={playlist.id} class="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                <div>
                  <h4 class="font-medium">{playlist.name}</h4>
                  <p class="text-sm text-gray-400">{playlist.url}</p>
                  <p class="text-xs text-gray-500">
                    Added: {new Date(playlist.addedAt).toLocaleDateString()}
                    {playlist.lastRefreshed && ` • Refreshed: ${new Date(playlist.lastRefreshed).toLocaleDateString()}`}
                  </p>
                  {refreshSuccess === playlist.id && (
                    <p class="text-xs text-green-400 mt-1">Refreshed successfully!</p>
                  )}
                  {refreshError && refreshingId === playlist.id && (
                    <p class="text-xs text-red-400 mt-1">{refreshError}</p>
                  )}
                </div>
                <div class="flex items-center gap-2">
                  <button
                    onClick={() => handleRefreshPlaylist(playlist.id)}
                    disabled={refreshingId === playlist.id}
                    class={`p-2 ${refreshingId === playlist.id ? 'text-gray-500' : 'text-blue-400 hover:text-blue-300'} transition-colors`}
                    title="Refresh playlist"
                  >
                    <RefreshCw class={`w-5 h-5 ${refreshingId === playlist.id ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleRemovePlaylist(playlist.id)}
                    class="p-2 text-red-400 hover:text-red-300 transition-colors"
                    title="Remove playlist"
                  >
                    <Trash2 class="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div class="bg-gray-800 rounded-lg p-6">
        <h3 class="text-lg font-semibold mb-4">Storage Management</h3>
        
        {storageInfo && (
          <div class="mb-4">
            <div class="w-full bg-gray-700 h-2 rounded-lg overflow-hidden mb-2">
              <div 
                class={`h-full ${storageInfo.percent > 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${storageInfo.percent}%` }}
              ></div>
            </div>
            <div class="text-sm text-gray-400">
              {Math.round(storageInfo.usage / (1024 * 1024))} MB used of {Math.round(storageInfo.quota / (1024 * 1024))} MB ({storageInfo.percent}%)
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={clearAllData}
            class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Clear All Data
          </button>
          
          <button
            onClick={verifyStorage}
            class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Verify Storage
          </button>
        </div>
        
        <div className="mt-6 p-4 bg-gray-700 rounded-lg">
          <h4 className="font-medium mb-2">Troubleshooting</h4>
          <p className="text-sm text-gray-300 mb-3">If playlists aren't showing up:</p>
          <ol className="text-sm text-gray-400 list-decimal pl-5 space-y-1">
            <li>Try refreshing the page</li>
            <li>Check your browser's console for errors (F12)</li>
            <li>Use the "Verify Storage" button to check if data was saved properly</li>
            <li>Try adding the playlist again with a different name</li>
            <li>Some playlists may not work due to CORS restrictions</li>
          </ol>
        </div>
      </div>
    </div>
  );
}