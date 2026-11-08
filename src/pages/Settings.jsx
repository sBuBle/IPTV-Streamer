import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  Trash2, Plus, RefreshCw, AlertCircle, Upload, Link2, ListVideo, PlayCircle, History,
  DatabaseBackup, Keyboard, Pencil, Check, X, Copy, Download, RotateCcw, ChevronRight, CheckCircle2,
} from 'lucide-preact';
import { getPlaylists, removePlaylist, renamePlaylist, refreshPlaylist, savePlaylist, generateStablePlaylistId } from '../utils/playlist';
import { fetchPlaylist, parseM3U8 } from '../utils/simpleParser';
import { get, set } from '../utils/idbStorage';
import { useSettings, updateSettings, resetSettings, DEFAULT_SETTINGS } from '../utils/settings';

// ---------------------------------------------------------------------------
// FigCraft building blocks (tokens from src/index.css)
// ---------------------------------------------------------------------------

const field = 'w-full h-11 px-4 rounded-xl bg-[var(--color-ink)] border border-white/8 text-sm text-[var(--color-text)] placeholder:text-[var(--color-subtle)] focus:outline-none focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/25 transition';
const iconButton = 'h-9 w-9 rounded-[10px] flex items-center justify-center text-[var(--color-muted)] hover:text-white hover:bg-white/8 transition disabled:opacity-40 disabled:pointer-events-none';
const pill = 'shrink-0 inline-flex items-center h-[22px] px-2 rounded-full bg-white/6 text-[11px] font-semibold text-[var(--color-muted)] whitespace-nowrap';

const SECTIONS = [
  { id: 'playlists', label: 'Playlists', icon: ListVideo },
  { id: 'playback', label: 'Playback', icon: PlayCircle },
  { id: 'history', label: 'History & privacy', icon: History },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
];

function Section({ id, icon: Icon, title, description, action, children }) {
  return (
    <section id={id} class="scroll-mt-6">
      <div class="flex items-end gap-3 mb-3">
        <div class="flex-1 min-w-0">
          <h3 class="flex items-center gap-2 text-xl font-semibold text-[var(--color-text)]">
            <Icon class="w-5 h-5 text-[var(--color-lilac)]" aria-hidden="true" />
            {title}
          </h3>
          {description && <p class="mt-1 text-sm text-[var(--color-muted)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Card({ children, class: extra = '' }) {
  return (
    <div class={`rounded-2xl bg-[var(--color-card)] border border-[var(--color-hairline)] ${extra}`}>
      {children}
    </div>
  );
}

// One preference: label + hint on the left, control on the right
function Row({ title, hint, children, stack = false }) {
  return (
    <div class={`flex ${stack ? 'flex-col sm:flex-row sm:items-center' : 'items-center'} gap-3 sm:gap-6 px-5 py-4 border-t border-[var(--color-hairline)] first:border-t-0`}>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-[var(--color-text)]">{title}</div>
        {hint && <div class="mt-0.5 text-[13px] text-[var(--color-muted)]">{hint}</div>}
      </div>
      <div class="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      class={`relative w-11 h-6 rounded-full transition ${
        checked ? 'bg-[linear-gradient(135deg,#8b5cf6,#f43f5e)] shadow-[var(--shadow-glow)]' : 'bg-white/10 ring-1 ring-inset ring-white/10'
      }`}
    >
      <span class={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div class="inline-flex flex-wrap p-1 gap-1 rounded-xl bg-[var(--color-ink)] border border-[var(--color-hairline)]" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          class={`h-8 px-3 rounded-[9px] flex items-center gap-1.5 text-[13px] font-semibold transition ${
            value === option.value ? 'bg-white/10 text-white' : 'text-[var(--color-muted)] hover:text-white'
          }`}
        >
          {option.icon && <option.icon class="w-4 h-4" aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  const ok = notice.type === 'success';
  return (
    <div
      role="status"
      class={`flex items-start gap-3 p-4 rounded-2xl border text-sm ${
        ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' : 'bg-rose-500/10 border-rose-500/30 text-rose-100'
      }`}
    >
      {ok
        ? <CheckCircle2 class="w-5 h-5 shrink-0 text-emerald-400" />
        : <AlertCircle class="w-5 h-5 shrink-0 text-[var(--color-live)]" />}
      <p class="flex-1 whitespace-pre-line">{notice.text}</p>
      <button type="button" onClick={onClose} class="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
        <X class="w-4 h-4" />
      </button>
    </div>
  );
}

const formatDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

  // /settings?url=… (from "Add to playlists" links) pre-fills the form
  useEffect(() => {
    try {
      const urlParam = new URLSearchParams(window.location.search).get('url');
      if (!urlParam) return;
      setUrl(urlParam);
      const host = new URL(urlParam).hostname.replace(/^www\./, '').split('.')[0];
      setName(`${host.charAt(0).toUpperCase()}${host.slice(1)} Playlist`);
      window.history.replaceState(window.history.state, document.title, '/settings');
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
// Backup
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 1;

async function buildBackup() {
  const [playlists, favorites, watchHistory, channels] = await Promise.all([
    get('playlists'), get('favorites'), get('watchHistory'), get('channels'),
  ]);
  const list = Array.isArray(playlists) ? playlists : [];
  // Local file playlists can't be downloaded again, so keep their channels
  const localChannels = Object.fromEntries(
    list.filter(p => p.isLocal).map(p => [p.id, channels?.[p.id] || []])
  );
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem('app-settings') || '{}'); } catch { /* none */ }
  return {
    app: 'iptv-streamer',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: preferences,
    playlists: list,
    localChannels,
    favorites: Array.isArray(favorites) ? favorites : [],
    watchHistory: Array.isArray(watchHistory) ? watchHistory : [],
  };
}

async function restoreBackup(data) {
  if (!data || data.app !== 'iptv-streamer') throw new Error("This file isn't an IPTV Streamer backup.");
  const summary = { playlists: 0, failed: 0, favorites: 0, history: 0 };

  if (data.settings && typeof data.settings === 'object') updateSettings(data.settings);

  // Favorites and history: merge, keeping what's already here
  const favorites = (await get('favorites')) || [];
  const favoriteIds = new Set(favorites.map(f => f.id));
  const newFavorites = (data.favorites || []).filter(f => f?.id && !favoriteIds.has(f.id));
  if (newFavorites.length) await set('favorites', [...favorites, ...newFavorites]);
  summary.favorites = newFavorites.length;

  const history = (await get('watchHistory')) || [];
  const seen = new Set(history.map(item => item?.channel?.id));
  const newHistory = (data.watchHistory || []).filter(item => item?.channel?.id && !seen.has(item.channel.id));
  if (newHistory.length) {
    await set('watchHistory', [...history, ...newHistory].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
  }
  summary.history = newHistory.length;

  // Playlists: local ones come with their channels, URL ones are downloaded again
  const existing = (await get('playlists')) || [];
  const existingUrls = new Set(existing.map(p => p.url));
  for (const playlist of data.playlists || []) {
    if (!playlist?.url || existingUrls.has(playlist.url)) continue;
    try {
      if (playlist.isLocal) {
        const channels = data.localChannels?.[playlist.id];
        if (!Array.isArray(channels)) throw new Error('missing channels');
        const current = (await get('playlists')) || [];
        await set('playlists', [...current, playlist]);
        const all = (await get('channels')) || {};
        all[playlist.id] = channels;
        await set('channels', all);
      } else {
        await savePlaylist(playlist.url, playlist.name, !!playlist.useProxy);
      }
      existingUrls.add(playlist.url);
      summary.playlists++;
    } catch (err) {
      console.warn(`Could not restore ${playlist.name}:`, err);
      summary.failed++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const settings = useSettings();
  const [playlists, setPlaylists] = useState([]);
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [listNotice, setListNotice] = useState(null);
  const [counts, setCounts] = useState({ history: 0, favorites: 0 });
  const [confirmClear, setConfirmClear] = useState(null); // 'history' | 'favorites'
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState(null);
  const importRef = useRef(null);

  useEffect(() => {
    loadPlaylists();
    loadCounts();
  }, []);

  async function loadPlaylists() {
    try {
      setPlaylists(await getPlaylists());
    } catch (err) {
      console.error('Failed to load playlists:', err);
      setListNotice({ type: 'error', text: 'Your playlists could not be loaded. Reload the page to try again.' });
    }
  }

  async function loadCounts() {
    const [history, favorites] = await Promise.all([get('watchHistory'), get('favorites')]);
    setCounts({
      history: Array.isArray(history) ? history.length : 0,
      favorites: Array.isArray(favorites) ? favorites.length : 0,
    });
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
      setListNotice({ type: 'success', text: `Updated “${playlist.name}”: ${result.channelCount.toLocaleString()} channels.` });
      return true;
    } catch (err) {
      setListNotice({ type: 'error', text: `Couldn't update “${playlist.name}”: ${err.message}` });
      return false;
    } finally {
      setRefreshing(playlist.id, false);
      loadPlaylists();
    }
  }

  async function refreshAll() {
    const remote = playlists.filter(p => !p.isLocal);
    setListNotice(null);
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
    setListNotice(ok === remote.length
      ? { type: 'success', text: `Updated ${ok} playlist${ok === 1 ? '' : 's'}.` }
      : { type: 'error', text: `Updated ${ok} of ${remote.length} playlists. The others couldn't be reached.` });
  }

  async function remove(playlist) {
    try {
      await removePlaylist(playlist.id);
      await loadPlaylists();
    } catch (err) {
      setListNotice({ type: 'error', text: `Couldn't remove the playlist: ${err.message}` });
    }
  }

  async function rename(playlist, name) {
    try {
      await renamePlaylist(playlist.id, name);
      await loadPlaylists();
    } catch (err) {
      setListNotice({ type: 'error', text: err.message });
    }
  }

  async function clearStore(kind) {
    await set(kind === 'history' ? 'watchHistory' : 'favorites', []);
    setConfirmClear(null);
    loadCounts();
  }

  async function exportBackup() {
    setBackupBusy(true);
    setBackupNotice(null);
    try {
      const data = await buildBackup();
      downloadJson(data, `iptv-streamer-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setBackupNotice({
        type: 'success',
        text: `Saved ${data.playlists.length} playlists, ${data.favorites.length} favorites and ${data.watchHistory.length} history items.`,
      });
    } catch (err) {
      setBackupNotice({ type: 'error', text: `Couldn't create the backup: ${err.message}` });
    } finally {
      setBackupBusy(false);
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    setBackupNotice(null);
    try {
      const summary = await restoreBackup(JSON.parse(await file.text()));
      await Promise.all([loadPlaylists(), loadCounts()]);
      setBackupNotice({
        type: summary.failed ? 'error' : 'success',
        text: `Restored ${summary.playlists} playlists, ${summary.favorites} favorites and ${summary.history} history items.` +
          (summary.failed ? `\n${summary.failed} playlist${summary.failed === 1 ? '' : 's'} couldn't be downloaded.` : ''),
      });
    } catch (err) {
      setBackupNotice({ type: 'error', text: err instanceof SyntaxError ? "This file isn't a valid backup." : err.message });
    } finally {
      setBackupBusy(false);
    }
  }

  const remoteCount = playlists.filter(p => !p.isLocal).length;
  const isDefault = Object.keys(DEFAULT_SETTINGS).every(key => settings[key] === DEFAULT_SETTINGS[key]);

  return (
    <div class="max-w-4xl mx-auto pb-12">
      {/* Header, as in the FigCraft frames */}
      <div class="mb-6">
        <h2 class="text-3xl md:text-4xl font-bold tracking-[-0.015em] text-[var(--color-text)]">Settings</h2>
        <p class="mt-2 text-base text-[var(--color-muted)]">Manage your playlists, playback and data on this device.</p>
      </div>

      {/* Section chips */}
      <nav class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-8" aria-label="Settings sections">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            class="shrink-0 h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] bg-white/[0.04] border border-[var(--color-line)] hover:text-white hover:border-violet-400/40 transition"
          >
            <Icon class="w-4 h-4" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>

      <div class="flex flex-col gap-10">
        <Section
          id="playlists"
          icon={ListVideo}
          title="Playlists"
          description="Add M3U playlists from a link or a file on this device."
          action={remoteCount > 0 && (
            <button type="button" onClick={refreshAll} disabled={refreshingIds.size > 0} class="btn btn-secondary h-9 px-3 disabled:opacity-50">
              <RefreshCw class={`w-4 h-4 ${refreshingIds.size > 0 ? 'animate-spin' : ''}`} />
              <span class="hidden sm:inline">Update all</span>
            </button>
          )}
        >
          <div class="flex flex-col gap-4">
            <AddPlaylist onAdded={loadPlaylists} />

            <Notice notice={listNotice} onClose={() => setListNotice(null)} />

            <Card>
              <div class="flex items-center gap-2 px-5 pt-4 pb-3">
                <span class="text-sm font-semibold text-[var(--color-text)] flex-1">Your playlists</span>
                <span class={pill}>{playlists.length}</span>
              </div>
              {playlists.length === 0 ? (
                <div class="mx-4 mb-4 rounded-xl border border-dashed border-[var(--color-line)] p-5 text-sm text-[var(--color-muted)]">
                  No playlists yet. Add one above, or <a href="/countries" class="text-[var(--color-lilac)] hover:underline">browse channels by country</a>.
                </div>
              ) : (
                <div class="border-t border-[var(--color-hairline)]">
                  {playlists.map(playlist => (
                    <PlaylistRow
                      key={playlist.id}
                      playlist={playlist}
                      refreshing={refreshingIds.has(playlist.id)}
                      onRefresh={() => refreshOne(playlist)}
                      onRemove={() => remove(playlist)}
                      onRename={name => rename(playlist, name)}
                    />
                  ))}
                </div>
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
        </Section>

        <Section id="playback" icon={PlayCircle} title="Playback" description="How channels start and stream in the player.">
          <Card>
            <Row title="Start muted" hint="Channels begin without sound. Tap the speaker to turn it on.">
              <Toggle label="Start muted" checked={settings.startMuted} onChange={value => updateSettings({ startMuted: value })} />
            </Row>
            <Row title="Low-latency mode" hint="Stay closer to the live edge. Turn off if streams stutter.">
              <Toggle label="Low-latency mode" checked={settings.lowLatency} onChange={value => updateSettings({ lowLatency: value })} />
            </Row>
            <Row title="Buffer size" hint="A larger buffer rides out a slow connection but uses more memory." stack>
              <Segmented
                label="Buffer size"
                value={settings.bufferSize}
                onChange={value => updateSettings({ bufferSize: value })}
                options={[{ value: 'small', label: 'Small' }, { value: 'balanced', label: 'Balanced' }, { value: 'large', label: 'Large' }]}
              />
            </Row>
            <Row title="Show “Up next”" hint="List other channels from the same country next to the player.">
              <Toggle label="Show Up next" checked={settings.showUpNext} onChange={value => updateSettings({ showUpNext: value })} />
            </Row>
          </Card>
        </Section>

        <Section id="history" icon={History} title="History & privacy" description="Everything stays in this browser. Nothing is sent anywhere.">
          <Card>
            <Row title="Remember watched channels" hint="Keep a list of what you watched in History and on Home.">
              <Toggle label="Remember watched channels" checked={settings.recordHistory} onChange={value => updateSettings({ recordHistory: value })} />
            </Row>
            <Row title="Keep up to" hint="Older channels drop off the history list." stack>
              <Segmented
                label="History length"
                value={settings.historyLimit}
                onChange={value => updateSettings({ historyLimit: value })}
                options={[25, 50, 100, 200].map(n => ({ value: n, label: String(n) }))}
              />
            </Row>
            {[
              { kind: 'history', title: 'Watch history', count: counts.history, noun: 'channel' },
              { kind: 'favorites', title: 'Favorites', count: counts.favorites, noun: 'favorite' },
            ].map(({ kind, title, count, noun }) => (
              <Row key={kind} title={title} hint={`${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'} saved`}>
                {confirmClear === kind ? (
                  <div class="flex items-center gap-2">
                    <button type="button" onClick={() => clearStore(kind)} class="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-white bg-rose-500/80 hover:bg-rose-500 transition">Clear</button>
                    <button type="button" onClick={() => setConfirmClear(null)} class="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-[var(--color-muted)] hover:text-white hover:bg-white/8 transition">Cancel</button>
                  </div>
                ) : (
                  <button type="button" disabled={count === 0} onClick={() => setConfirmClear(kind)} class="btn btn-secondary h-9 px-3 disabled:opacity-40 disabled:pointer-events-none">
                    <Trash2 class="w-4 h-4" /> Clear
                  </button>
                )}
              </Row>
            ))}
          </Card>
        </Section>

        <Section id="backup" icon={DatabaseBackup} title="Backup" description="Move your playlists, favorites, history and settings to another browser or device.">
          <div class="flex flex-col gap-4">
            <Card class="p-5 flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={exportBackup} disabled={backupBusy} class="btn btn-primary justify-center disabled:opacity-50">
                <Download class="w-4 h-4" /> Export backup
              </button>
              <button type="button" onClick={() => importRef.current?.click()} disabled={backupBusy} class="btn btn-secondary justify-center disabled:opacity-50">
                {backupBusy ? <RefreshCw class="w-4 h-4 animate-spin" /> : <Upload class="w-4 h-4" />} Import backup
              </button>
              <input ref={importRef} type="file" accept="application/json,.json" class="sr-only" onChange={importBackup} tabIndex={-1} />
              <p class="sm:self-center text-[13px] text-[var(--color-muted)]">Importing adds to what's here. Nothing is overwritten.</p>
            </Card>
            <Notice notice={backupNotice} onClose={() => setBackupNotice(null)} />
            <Card>
              <Row title="Reset settings" hint="Put playback, history and update options back to their defaults. Your playlists and favorites stay.">
                <button type="button" disabled={isDefault} onClick={resetSettings} class="btn btn-secondary h-9 px-3 disabled:opacity-40 disabled:pointer-events-none">
                  <RotateCcw class="w-4 h-4" /> Reset
                </button>
              </Row>
            </Card>
          </div>
        </Section>

        <Section id="shortcuts" icon={Keyboard} title="Keyboard shortcuts" description="Work in the player and on the Browse page.">
          <Card class="p-2 grid grid-cols-1 sm:grid-cols-2">
            {[
              [['Space', 'K'], 'Play / pause'],
              [['F'], 'Full screen'],
              [['M'], 'Mute / unmute'],
              [['↑', '↓'], 'Volume up / down'],
              [['←', '→'], 'Skip 10 s (recordings)'],
              [['I'], 'Stream details'],
              [['/'], 'Search on Browse'],
              [['Esc'], 'Close the menu'],
            ].map(([keys, label]) => (
              <div key={label} class="flex items-center gap-3 px-3 py-2.5">
                <span class="flex gap-1 w-24 shrink-0">
                  {keys.map(key => (
                    <kbd key={key} class="h-6 min-w-6 px-1.5 inline-flex items-center justify-center rounded-md border border-[var(--color-line)] bg-white/[0.04] text-xs font-semibold text-[var(--color-text)] font-sans">{key}</kbd>
                  ))}
                </span>
                <span class="text-sm text-[var(--color-muted)]">{label}</span>
              </div>
            ))}
          </Card>
        </Section>
      </div>
    </div>
  );
}
