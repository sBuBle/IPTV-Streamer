import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { FetchFn } from "../util/http.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue } from "./types.js";

export interface ProviderHealth {
  id: string;
  name: string;
  enabled: boolean;
  issues: ProviderIssue[];
  calls: number;
  failures: number;
  consecutiveFailures: number;
  lastOkAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastDurationMs?: number;
}

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string };

export class ProviderTimeoutError extends Error {
  constructor(provider: string, op: string, ms: number) {
    super(`${provider}.${op} timed out after ${ms} ms`);
    this.name = "ProviderTimeoutError";
  }
}

/**
 * Holds all adapters and runs every call to them inside a time budget and a try/catch,
 * so one broken provider can never take the add-on down.
 */
export class ProviderRegistry {
  private readonly health = new Map<string, ProviderHealth>();
  private readonly adapters: ProviderAdapter[];

  constructor(
    adapters: ProviderAdapter[],
    private readonly deps: { config: Config; logger: Logger; fetch?: FetchFn; now?: () => number },
  ) {
    const enabledIds = deps.config.enabledProviders;
    this.adapters = adapters;
    for (const a of adapters) {
      let issues: ProviderIssue[];
      try {
        issues = a.issues();
      } catch (err) {
        issues = [{ severity: "error", message: `issues() threw: ${errorMessage(err)}` }];
      }
      const enabled = (enabledIds.length === 0 || enabledIds.includes(a.id)) && !issues.some((i) => i.severity === "error");
      this.health.set(a.id, { id: a.id, name: a.name, enabled, issues, calls: 0, failures: 0, consecutiveFailures: 0 });
      if (issues.length) deps.logger.warn("provider has issues", { provider: a.id, enabled, issues });
    }
  }

  private get now() {
    return this.deps.now ?? Date.now;
  }

  enabled(): ProviderAdapter[] {
    return this.adapters.filter((a) => this.health.get(a.id)?.enabled);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.enabled().find((a) => a.id === id);
  }

  healthReport(): ProviderHealth[] {
    return [...this.health.values()].map((h) => ({ ...h, issues: [...h.issues] }));
  }

  /** Runs `fn` for a provider with a timeout. Never throws. */
  async call<T>(adapter: ProviderAdapter, op: string, fn: (ctx: ProviderContext) => Promise<T>): Promise<CallResult<T>> {
    const h = this.health.get(adapter.id)!;
    const timeoutMs = this.deps.config.providerTimeoutMs;
    const controller = new AbortController();
    const ctx: ProviderContext = {
      fetch: this.deps.fetch ?? fetch,
      logger: this.deps.logger.child({ provider: adapter.id, op }),
      config: this.deps.config,
      signal: controller.signal,
      deadline: Date.now() + timeoutMs,
    };
    const started = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    h.calls++;
    try {
      const value = await Promise.race([
        fn(ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // Reject before aborting, so a provider that returns early on abort cannot win the race.
            reject(new ProviderTimeoutError(adapter.id, op, timeoutMs));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
      h.consecutiveFailures = 0;
      h.lastOkAt = this.now();
      return { ok: true, value };
    } catch (err) {
      const message = errorMessage(err);
      h.failures++;
      h.consecutiveFailures++;
      h.lastErrorAt = this.now();
      h.lastError = `${op}: ${message}`;
      ctx.logger.error("provider call failed", { error: err });
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
      h.lastDurationMs = this.now() - started;
    }
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
