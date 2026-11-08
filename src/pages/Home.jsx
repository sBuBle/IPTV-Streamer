import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { get } from '../utils/idbStorage';
import { Play, Globe, ChevronRight, ListPlus } from 'lucide-preact';
import { getPlaylists } from '../utils/playlist';
import ChannelCard from '../components/ChannelCard';
import { CATEGORY_CHIPS } from '../components/categories';
import { watchPath } from '../utils/watchLinks';
import { useChannelLogos } from '../utils/channelLogos';

export default function Home() {
  const [playlists, setPlaylists] = useState([]);
  const [recentlyWatched, setRecentlyWatched] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalChannels: 0,
    totalPlaylists: 0,
    countriesCount: 0,
    categoriesCount: 0
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Load playlists
        const savedPlaylists = await getPlaylists();
        setPlaylists(savedPlaylists);
        
        // Load recently watched channels
        const history = await get('watchHistory') || [];
        
        // Filter out any entries that don't have a valid channel object
        const validHistory = history.filter(item => item && item.channel && item.channel.id);
        setRecentlyWatched(validHistory.slice(0, 10)); // Show top 10 recently watched
        
        // Load favorites
        const favs = await get('favorites') || [];
        
        // Filter out any invalid favorites
        const validFavs = favs.filter(item => item && item.id);
        setFavorites(validFavs.slice(0, 10)); // Show top 10 favorites
        
        // Calculate stats
        const uniqueChannels = new Set([
          ...validHistory.filter(item => item.channel).map(item => item.channel.id),
          ...validFavs.map(item => item.id)
        ]);
        
        // Get country and category counts from localStorage if available
        const countriesCount = localStorage.getItem('countriesCount') || 0;
        const categoriesCount = localStorage.getItem('categoriesCount') || 0;
        
        setStats({
          totalChannels: uniqueChannels.size,
          totalPlaylists: savedPlaylists.length,
          countriesCount: parseInt(countriesCount, 10),
          categoriesCount: parseInt(categoriesCount, 10)
        });
      } catch (error) {
        console.error('Failed to load home page data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  const favoriteIds = new Set(favorites.map(f => f && f.id));
  const historyLogo = useChannelLogos(recentlyWatched, item => item?.channel);
  const favoriteLogo = useChannelLogos(favorites);

  const card = (channel, meta) => {
    if (!channel || !channel.id) return null;
    return (
      <ChannelCard
        key={channel.id}
        href={watchPath(channel)}
        name={channel.name}
        logo={historyLogo(channel) || favoriteLogo(channel)}
        group={channel.group}
        country={channel.country}
        favorite={favoriteIds.has(channel.id)}
        meta={meta}
      />
    );
  };

  const Section = ({ title, href, children }) => (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {href && (
          <a href={href} className="see-all">See all <ChevronRight size={16} /></a>
        )}
      </div>
      {children}
    </section>
  );

  const Empty = ({ art, title, children }) => (
    <div className="rounded-[14px] border border-[var(--color-hairline)] bg-[var(--color-card)] p-6 text-center text-[var(--color-muted)]">
      <img src={art} alt="" width="320" height="200" className="w-36 h-auto mx-auto mb-1" />
      <p className="text-[var(--color-text)] font-medium">{title}</p>
      {children}
    </div>
  );

  const grid = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4';

  return (
    <div className="max-w-[1200px]">
      {/* Hero */}
      <section className="hero relative overflow-hidden rounded-2xl mb-8 px-6 py-10 md:px-12 md:py-12 md:min-h-[296px] flex items-center border border-[var(--color-hairline)]">
        <div className="relative max-w-xl">
          <span className="live-badge mb-4 uppercase">
            Live{stats.totalChannels > 0 ? ` · ${stats.totalChannels} in your library` : ' now'}
          </span>
          <h1 className="text-4xl md:text-5xl font-bold leading-[1.05] tracking-[-0.02em] mb-3">
            Live TV from every <span className="brand-text">corner of the world</span>
          </h1>
          <p className="text-[var(--color-muted)] mb-7">
            Free, public channels from 190+ countries: news, sport, movies and more.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={recentlyWatched[0] ? watchPath(recentlyWatched[0].channel) : '/countries'} className="btn btn-primary">
              <Play size={18} className="fill-white" />
              {recentlyWatched[0] ? 'Continue watching' : 'Start watching'}
            </a>
            <a href="/countries" className="btn btn-secondary">
              <Globe size={18} />
              Browse countries
            </a>
          </div>
        </div>
      </section>

      <Section title="Continue watching" href={recentlyWatched.length ? '/history' : undefined}>
        {loading ? (
          <div className={grid}>{[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-[14px] bg-[var(--color-card)] animate-pulse" />)}</div>
        ) : recentlyWatched.length === 0 ? (
          <Empty art="/brand/pages/empty-history.svg" title="Nothing watched yet">
            <a href="/countries" className="see-all mt-1">Browse channels to get started <ChevronRight size={16} /></a>
          </Empty>
        ) : (
          <div className={grid}>
            {recentlyWatched.slice(0, 4).map(item => card(item.channel, item.timestamp
              ? new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
              : undefined))}
          </div>
        )}
      </Section>

      <Section title="Favorites" href={favorites.length ? '/favorites' : undefined}>
        {loading ? null : favorites.length === 0 ? (
          <Empty art="/brand/pages/empty-favorites.svg" title="No favorite channels yet">
            <p className="text-sm mt-1">Tap the heart while watching a channel to keep it here.</p>
          </Empty>
        ) : (
          <div className={grid}>{favorites.slice(0, 8).map(ch => card(ch))}</div>
        )}
      </Section>

      <Section title="Browse by category">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {CATEGORY_CHIPS.map(cat => (
            <a
              key={cat.id}
              href={`/category/${cat.id}`}
              className="flex items-center gap-3 p-3 rounded-[14px] border border-[var(--color-hairline)] bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] hover:border-violet-500/40 transition"
            >
              <img src={cat.icon} alt="" width="40" height="40" className="w-10 h-10 shrink-0" />
              <span className="text-sm font-semibold truncate">{cat.name}</span>
            </a>
          ))}
        </div>
      </Section>

      <Section title="Your playlists" href="/settings">
        {playlists.length === 0 ? (
          <Empty art="/brand/pages/empty-channels.svg" title="No playlists added yet">
            <a href="/settings" className="btn btn-secondary mt-3"><ListPlus size={18} /> Add playlist</a>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {playlists.map(playlist => (
              <a
                key={playlist.id}
                href={`/playlist/${encodeURIComponent(playlist.id)}`}
                className="p-4 rounded-[14px] border border-[var(--color-hairline)] bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] hover:border-violet-500/40 transition"
              >
                <h3 className="font-semibold">{playlist.name}</h3>
                <p className="text-sm text-[var(--color-muted)] truncate mt-1">{playlist.url}</p>
                <span className="text-xs text-[var(--color-subtle)] mt-2 block">
                  Added {new Date(playlist.addedAt).toLocaleDateString()}
                </span>
              </a>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
