import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { route } from 'preact-router';
import {
  Trash2, RefreshCw, Upload, PlayCircle, History, DatabaseBackup, Keyboard, Download, RotateCcw,
} from 'lucide-preact';
import { savePlaylist } from '../utils/playlist';
import { get, set } from '../utils/idbStorage';
import { useSettings, updateSettings, resetSettings, DEFAULT_SETTINGS } from '../utils/settings';
import { Section, Card, Row, Toggle, Segmented, Notice } from '../components/SettingsUI';

const SECTIONS = [
  { id: 'playback', label: 'Playback', icon: PlayCircle },
  { id: 'history', label: 'History & privacy', icon: History },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
];

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
  const [counts, setCounts] = useState({ history: 0, favorites: 0 });
  const [confirmClear, setConfirmClear] = useState(null); // 'history' | 'favorites'
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState(null);
  const importRef = useRef(null);

  // Old "Add to playlists" links point at /settings?url=…
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('url')) {
      route(`/playlists${window.location.search}`, true);
      return;
    }
    loadCounts();
  }, []);

  async function loadCounts() {
    const [history, favorites] = await Promise.all([get('watchHistory'), get('favorites')]);
    setCounts({
      history: Array.isArray(history) ? history.length : 0,
      favorites: Array.isArray(favorites) ? favorites.length : 0,
    });
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
      await loadCounts();
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

  const isDefault = Object.keys(DEFAULT_SETTINGS).every(key => settings[key] === DEFAULT_SETTINGS[key]);

  return (
    <div class="max-w-4xl mx-auto pb-12">
      {/* Header, as in the FigCraft frames */}
      <div class="mb-6">
        <h2 class="text-3xl md:text-4xl font-bold tracking-[-0.015em] text-[var(--color-text)]">Settings</h2>
        <p class="mt-2 text-base text-[var(--color-muted)]">Playback, privacy and backups for this device. Playlists have <a href="/playlists" class="text-[var(--color-lilac)] hover:underline">their own page</a>.</p>
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
