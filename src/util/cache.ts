interface Entry<V> {
  value: V;
  expiresAt: number;
}

/** Small in-memory TTL cache with request coalescing. One instance per process or Worker isolate. */
export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();
  /** Last successfully loaded value per key, kept after expiry so an outage can fall back to it. */
  private readonly good = new Map<string, V>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Remembers `value` as the last good value for `key`, even after its entry expires. */
  remember(key: string, value: V): void {
    this.good.delete(key);
    if (this.good.size >= this.maxEntries) {
      const oldest = this.good.keys().next().value;
      if (oldest !== undefined) this.good.delete(oldest);
    }
    this.good.set(key, value);
  }

  /** The last value passed to `remember`, however old. */
  lastGood(key: string): V | undefined {
    return this.good.get(key);
  }

  /**
   * Returns the cached value, or runs `load` once even if many callers ask at the same time.
   * With `staleWhileRevalidate`, an expired key that has a remembered good value returns that value at once
   * and reloads in the background. Never use it for values that stop working when they expire (signed URLs).
   */
  async getOrLoad(key: string, load: () => Promise<{ value: V; ttlMs: number }>, opts: { staleWhileRevalidate?: boolean } = {}): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    const stale = opts.staleWhileRevalidate ? this.good.get(key) : undefined;
    if (stale !== undefined) {
      if (!pending) this.start(key, load).catch(() => {});
      return stale;
    }
    if (pending) return pending;
    return this.start(key, load);
  }

  private start(key: string, load: () => Promise<{ value: V; ttlMs: number }>): Promise<V> {
    const p = load()
      .then(({ value, ttlMs }) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
