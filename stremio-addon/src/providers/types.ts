import type { Config } from "../config.js";
import type { LiveChannel, ResolvedStream } from "../domain/types.js";
import type { Logger } from "../logger.js";
import type { FetchFn } from "../util/http.js";

export interface ProviderContext {
  fetch: FetchFn;
  logger: Logger;
  config: Config;
  /** Aborted when the provider's time budget runs out. */
  signal: AbortSignal;
}

/** A problem that stops a provider from working, shown in diagnostics (e.g. missing config). */
export interface ProviderIssue {
  severity: "warning" | "error";
  message: string;
}

export interface LiveCapability {
  listChannels(ctx: ProviderContext): Promise<LiveChannel[]>;
  resolveStreams(channelId: string, ctx: ProviderContext): Promise<ResolvedStream[]>;
}

/**
 * VOD capability, implemented from Phase 3 (Kan) on.
 * Navigation is Provider -> Program -> Season -> Episode -> Playback.
 */
export interface VodCapability {
  listPrograms(ctx: ProviderContext, page: { skip: number; limit: number }): Promise<VodProgram[]>;
  getProgram(programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined>;
  resolveEpisodeStreams(episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]>;
}

export interface VodProgram {
  id: string;
  provider: string;
  kind: "series" | "movie";
  title: string;
  titleHe?: string;
  poster?: string;
  description?: string;
  genres: string[];
  year?: number;
}

export interface VodEpisode {
  id: string;
  season: number;
  episode: number;
  title: string;
  released?: string;
  thumbnail?: string;
  description?: string;
}

export interface VodProgramDetail extends VodProgram {
  episodes: VodEpisode[];
}

export interface ProviderAdapter {
  /** Stable id used in Stremio ids; never change it once released. */
  readonly id: string;
  readonly name: string;
  /** Config problems found at startup. A provider with errors is skipped, not fatal. */
  issues(): ProviderIssue[];
  readonly live?: LiveCapability;
  readonly vod?: VodCapability;
}
