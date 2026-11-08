import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Trash2, Plus, RefreshCw, Upload, Link2, ListVideo, Pencil, Check, X, Copy, ChevronRight } from 'lucide-preact';
import { getPlaylists, removePlaylist, renamePlaylist, refreshPlaylist, savePlaylist, generateStablePlaylistId } from '../utils/playlist';
import { fetchPlaylist, parseM3U8 } from '../utils/simpleParser';
import { get, set } from '../utils/idbStorage';
import { useSettings, updateSettings } from '../utils/settings';
import { Card, Row, Segmented, Notice, field, iconButton, pill } from '../components/SettingsUI';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Fetch a remote playlist directly first, then through public CORS proxies
async function loadRemotePlaylist(url) {
  const attempts = [
    { url, useProxy: false },
    { url: `https://corsproxy.io/?${encodeURIComponent(url)}`, useProxy: true },
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const data = await fetchPlaylist(attempt.url);
      if (data?.segments?.length > 0) return attempt.useProxy;
      lastError = new Error('The playlist has no channels');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Could not load the playlist');
}

function friendlyAddError(err, url) {
  const message = err?.message || String(err);
  if (/already exists/i.test(message)) return 'This playlist is already in your list.';
  if (/not found|404/i.test(message)) return `Couldn't find a playlist at that address. Check the URL and try again.`;
  if (/valid M3U8|no channels/i.test(message)) {
    let text = "That address doesn't contain an M3U playlist.";
    if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
      text += ' For GitHub files, use the "Raw" link.';
    }
    return text;
  }
  return `Couldn't add the playlist: ${message}`;
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

function AddPlaylist({ onAdded }) {
  const [mode, setMode] = useState('url');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);

  // /playlists?url=… (from "Add to playlists" links) pre-fills the form
  useEffect(() => {
    try {
      const urlParam = new URLSearchParams(window.location.search).get('url');
      if (!urlParam) return;
      setUrl(urlParam);
      const host = new URL(urlParam).hostname.replace(/^www\./, '').split('.')[0];
      setName(`${host.charAt(0).toUpperCase()}${host.slice(1)} Playlist`);
      window.history.replaceState(window.history.state, document.title, '/playlists');
    } catch { /* ignore a bad link */ }
  }, []);

  function pickFile(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    if (!name) setName(picked.name.replace(/\.(m3u8?|txt)$/i, '') || 'Local Playlist');
  }

  async function addFromUrl() {
    let target = url.trim();
    if (!/^https?:\/\/.+/i.test(target)) throw new Error('Enter a link that starts with http:// or https://');
    // GitHub raw links copied with refs/heads/ in them
    if (target.includes('raw.githubusercontent.com') && target.includes('/refs/heads/')) {
      target = target.replace('/refs/heads/', '/');
    }
    const useProxy = await loadRemotePlaylist(target);
    const saved = await savePlaylist(target, name.trim() || 'My Playlist', useProxy);
    const channels = (await get('channels')) || {};
    return { name: saved.name, count: channels[saved.id]?.length || 0 };
  }

  async function addFromFile() {
    if (!file) throw new Error('Choose a playlist file first');
    const text = await file.text();
    if (!text.includes('#EXTINF') && !text.includes('http')) {
      throw new Error("This file doesn't look like an M3U playlist.");
    }
    const manifest = parseM3U8(text);
    if (!manifest.segments?.length) throw new Error('No channels found in this file.');

    const pseudoUrl = `file://${file.name}_${Date.now()}`;
    const playlistId = generateStablePlaylistId(pseudoUrl);
    const playlistName = name.trim() || 'Local Playlist';
    const channels = manifest.segments.map((segment, index) => ({
      id: `${playlistId}_${index}`,
      name: segment.title || `Channel ${index + 1}`,
      url: segment.uri || '',
      group: segment.attributes?.['group-title'] || 'Uncategorized',
      playlistId,
      attributes: segment.attributes || {},
      tvgId: segment.attributes?.['tvg-id'],
      tvgName: segment.attributes?.['tvg-name'],
      tvgLogo: segment.attributes?.['tvg-logo'],
    }));

    const playlists = (await get('playlists')) || [];
    await set('playlists', [...playlists, {
      id: playlistId,
      url: pseudoUrl,
      name: playlistName,
      addedAt: new Date().toISOString(),
      isLocal: true,
      fileSize: file.size,
      fileName: file.name,
      channelCount: channels.length,
    }]);
    const allChannels = (await get('channels')) || {};
    allChannels[playlistId] = channels;
    await set('channels', allChannels);
    const raw = (await get('rawPlaylists')) || {};
    raw[playlistId] = manifest;
    await set('rawPlaylists', raw);
    return { name: playlistName, count: channels.length };
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = mode === 'url' ? await addFromUrl() : await addFromFile();
      setNotice({ type: 'success', text: `Added “${result.name}” with ${result.count.toLocaleString()} channels.` });
      setName('');
      setUrl('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onAdded();
    } catch (err) {
      console.error('Failed to add playlist:', err);
      setNotice({ type: 'error', text: mode === 'url' ? friendlyAddError(err, url) : err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card class="p-5">
      <form onSubmit={submit} class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="text-sm font-semibold text-[var(--color-text)] flex-1">Add a playlist</div>
          <Segmented
            label="Add from"
            value={mode}
            onChange={value => { setMode(value); setNotice(null); }}
            options={[{ value: 'url', label: 'From URL', icon: Link2 }, { value: 'file', label: 'From file', icon: Upload }]}
          />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-[var(--color-muted)]">Name</span>
            <input class={field} value={name} onInput={e => setName(e.target.value)} placeholder="My Playlist" />
          </label>
          {mode === 'url' ? (
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold text-[var(--color-muted)]">M3U / M3U8 link</span>
              <input type="url" required class={field} value={url} onInput={e => setUrl(e.target.value)} placeholder="https://example.com/playlist.m3u8" />
            </label>
          ) : (
            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold text-[var(--color-muted)]">Playlist file (.m3u, .m3u8, .txt)</span>
              <label class={`${field} flex items-center gap-2 cursor-pointer hover:border-violet-400/40`}>
                <Upload class="w-4 h-4 shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
                <span class={`flex-1 truncate ${file ? '' : 'text-[var(--color-subtle)]'}`}>{file ? file.name : 'Choose a file…'}</span>
                <span class="text-[13px] font-semibold text-[var(--color-lilac)]">Browse</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,.txt,text/plain,application/x-mpegurl,audio/x-mpegurl"
                  class="sr-only"
                  onChange={pickFile}
                />
              </label>
            </div>
          )}
        </div>

        <Notice notice={notice} onClose={() => setNotice(null)} />

        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || (mode === 'file' && !file)} class="btn btn-primary disabled:opacity-50 disabled:pointer-events-none">
            {busy ? <RefreshCw class="w-4 h-4 animate-spin" /> : <Plus class="w-4 h-4" />}
            {busy ? 'Adding…' : 'Add playlist'}
          </button>
          <a href="/countries" class="see-all">Or browse free channels by country <ChevronRight class="w-4 h-4" /></a>
        </div>
      </form>
    </Card>
  );
}

function PlaylistRow({ playlist, refreshing, onRefresh, onRemove, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(playlist.name);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function saveName(event) {
    event.preventDefault();
    if (draft.trim() && draft.trim() !== playlist.name) await onRename(draft);
    setEditing(false);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(playlist.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  const meta = [
    playlist.channelCount ? `${playlist.channelCount.toLocaleString()} channels` : null,
    `Added ${formatDate(playlist.addedAt)}`,
    playlist.lastRefreshed ? `Updated ${formatDate(playlist.lastRefreshed)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div class="flex items-center gap-3 px-4 py-3 border-t border-[var(--color-hairline)] first:border-t-0">
      <div class="w-10 h-10 shrink-0 rounded-xl brand-gradient flex items-center justify-center text-white">
        {playlist.isLocal ? <Upload class="w-[18px] h-[18px]" /> : <ListVideo class="w-[18px] h-[18px]" />}
      </div>
      <div class="flex-1 min-w-0">
        {editing ? (
          <form onSubmit={saveName} class="flex items-center gap-1">
            <input
              class={`${field} h-9 px-3`}
              value={draft}
              onInput={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setDraft(playlist.name); setEditing(false); } }}
              aria-label="Playlist name"
              autoFocus
            />
            <button type="submit" class={iconButton} title="Save name" aria-label="Save name"><Check class="w-4 h-4" /></button>
            <button type="button" class={iconButton} onClick={() => { setDraft(playlist.name); setEditing(false); }} title="Cancel" aria-label="Cancel"><X class="w-4 h-4" /></button>
          </form>
        ) : (
          <a href={`/playlist/${encodeURIComponent(playlist.id)}`} class="block truncate text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-lilac)]">
            {playlist.name}
          </a>
        )}
        <div class="mt-0.5 truncate text-[12px] text-[var(--color-subtle)]" title={playlist.isLocal ? playlist.fileName : playlist.url}>
          {playlist.isLocal ? `Local file · ${playlist.fileName || 'playlist'}` : playlist.url}
        </div>
        <div class="mt-0.5 text-[12px] text-[var(--color-muted)]">{meta}</div>
      </div>

      {confirming ? (
        <div class="flex items-center gap-2 shrink-0">
          <span class="hidden sm:inline text-[13px] text-[var(--color-muted)]">Remove?</span>
          <button type="button" onClick={onRemove} class="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-white bg-rose-500/80 hover:bg-rose-500 transition">Remove</button>
          <button type="button" onClick={() => setConfirming(false)} class="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-[var(--color-muted)] hover:text-white hover:bg-white/8 transition">Keep</button>
        </div>
      ) : (
        <div class="flex items-center gap-0.5 shrink-0">
          {!playlist.isLocal && (
            <button type="button" onClick={onRefresh} disabled={refreshing} class={iconButton} title="Update now" aria-label={`Update ${playlist.name}`}>
              <RefreshCw class={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          {!playlist.isLocal && (
            <button type="button" onClick={copyUrl} class={`${iconButton} hidden sm:flex`} title={copied ? 'Copied' : 'Copy link'} aria-label="Copy playlist link">
              {copied ? <Check class="w-4 h-4 text-emerald-400" /> : <Copy class="w-4 h-4" />}
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)} class={iconButton} title="Rename" aria-label={`Rename ${playlist.name}`}>
            <Pencil class="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setConfirming(true)} class={`${iconButton} hover:text-[var(--color-live)]`} title="Remove" aria-label={`Remove ${playlist.name}`}>
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlaylistsPage() {
  const settings = useSettings();
  const [playlists, setPlaylists] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [notice, setNotice] = useState(null);

  useEffect(() => { loadPlaylists(); }, []);

  async function loadPlaylists() {
    try {
      setPlaylists(await getPlaylists());
    } catch (err) {
      console.error('Failed to load playlists:', err);
      setNotice({ type: 'error', text: 'Your playlists could not be loaded. Reload the page to try again.' });
    } finally {
      setLoaded(true);
    }
  }

  const setRefreshing = (id, on) => setRefreshingIds(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  async function refreshOne(playlist) {
    setRefreshing(playlist.id, true);
    try {
      const result = await refreshPlaylist(playlist.id);
      setNotice({ type: 'success', text: `Updated “${playlist.name}”: ${result.channelCount.toLocaleString()} channels.` });
    } catch (err) {
      setNotice({ type: 'error', text: `Couldn't update “${playlist.name}”: ${err.message}` });
    } finally {
      setRefreshing(playlist.id, false);
      loadPlaylists();
    }
  }

  async function refreshAll() {
    const remote = playlists.filter(p => !p.isLocal);
    setNotice(null);
    remote.forEach(p => setRefreshing(p.id, true));
    let ok = 0;
    for (const playlist of remote) {
      try {
        await refreshPlaylist(playlist.id);
        ok++;
      } catch (err) {
        console.warn(`Refresh failed for ${playlist.name}:`, err);
      } finally {
        setRefreshing(playlist.id, false);
      }
    }
    await loadPlaylists();
    setNotice(ok === remote.length
      ? { type: 'success', text: `Updated ${ok} playlist${ok === 1 ? '' : 's'}.` }
      : { type: 'error', text: `Updated ${ok} of ${remote.length} playlists. The others couldn't be reached.` });
  }

  async function remove(playlist) {
    try {
      await removePlaylist(playlist.id);
      await loadPlaylists();
    } catch (err) {
      setNotice({ type: 'error', text: `Couldn't remove the playlist: ${err.message}` });
    }
  }

  async function rename(playlist, name) {
    try {
      await renamePlaylist(playlist.id, name);
      await loadPlaylists();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
  }

  const remoteCount = playlists.filter(p => !p.isLocal).length;
  const totalChannels = playlists.reduce((sum, p) => sum + (Number(p.channelCount) || 0), 0);

  return (
    <div class="max-w-4xl mx-auto pb-12">
      {/* Header, as in the FigCraft frames */}
      <div class="flex flex-col sm:flex-row sm:items-end gap-4 mb-8">
        <div class="flex-1 min-w-0">
          <h2 class="text-3xl md:text-4xl font-bold tracking-[-0.015em] text-[var(--color-text)]">Playlists</h2>
          <p class="mt-2 text-base text-[var(--color-muted)]">
            {playlists.length > 0
              ? <>{playlists.length} playlist{playlists.length === 1 ? '' : 's'}{totalChannels > 0 && <> · {totalChannels.toLocaleString()} channels</>}. Add M3U playlists from a link or a file.</>
              : 'Add M3U playlists from a link or a file on this device.'}
          </p>
        </div>
        {remoteCount > 0 && (
          <button type="button" onClick={refreshAll} disabled={refreshingIds.size > 0} class="btn btn-secondary self-start sm:self-auto disabled:opacity-50">
            <RefreshCw class={`w-4 h-4 ${refreshingIds.size > 0 ? 'animate-spin' : ''}`} />
            Update all
          </button>
        )}
      </div>

      <div class="flex flex-col gap-4">
        <AddPlaylist onAdded={loadPlaylists} />

        <Notice notice={notice} onClose={() => setNotice(null)} />

        <div class="flex items-center gap-2 mt-4">
          <h3 class="text-xl font-semibold text-[var(--color-text)] flex-1">Your playlists</h3>
          {playlists.length > 0 && <span class={pill}>{playlists.length}</span>}
        </div>

        <Card>
          {!loaded ? (
            <div class="h-[72px] m-1 rounded-xl bg-white/[0.03] animate-pulse" />
          ) : playlists.length === 0 ? (
            <div class="m-4 rounded-xl border border-dashed border-[var(--color-line)] p-5 text-sm text-[var(--color-muted)]">
              No playlists yet. Add one above, or <a href="/countries" class="text-[var(--color-lilac)] hover:underline">browse channels by country</a>.
            </div>
          ) : (
            playlists.map(playlist => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                refreshing={refreshingIds.has(playlist.id)}
                onRefresh={() => refreshOne(playlist)}
                onRemove={() => remove(playlist)}
                onRename={name => rename(playlist, name)}
              />
            ))
          )}
        </Card>

        <Card>
          <Row title="Update automatically" hint="When the app opens, download playlists again if they're older than this. Local files are skipped." stack>
            <Segmented
              label="Update automatically"
              value={settings.autoRefreshDays}
              onChange={value => updateSettings({ autoRefreshDays: value })}
              options={[{ value: 0, label: 'Off' }, { value: 1, label: 'Daily' }, { value: 7, label: 'Weekly' }]}
            />
          </Row>
        </Card>
      </div>
    </div>
  );
}
