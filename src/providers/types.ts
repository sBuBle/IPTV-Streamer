import type { Config } from "../config.js";
import type { GeoAvailability, LiveChannel, ResolvedStream } from "../domain/types.js";
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
 * VOD capability. Navigation is Provider -> Program -> Season -> Episode -> Playback.
 * Ids must be stable: they end up in Stremio libraries and watch history.
 */
export interface VodCapability {
  /** Every program the provider offers right now. Called rarely; the result is cached. */
  listPrograms(ctx: ProviderContext): Promise<VodProgram[]>;
  /** Program metadata with all its episodes, or undefined when the program no longer exists. */
  getProgram(programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined>;
  /** Fresh playback URLs for one episode (or the movie itself, with episodeId = the program's single episode). */
  resolveEpisodeStreams(programId: string, episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]>;
}

export interface VodProgram {
  /** Unique within the provider; only A-Z, a-z, 0-9, "_" and "-". */
  id: string;
  provider: string;
  kind: "series" | "movie";
  title: string;
  /** Original-language title when `title` is a translation. */
  originalTitle?: string;
  poster?: string;
  posterShape?: "poster" | "landscape" | "square";
  background?: string;
  logo?: string;
  description?: string;
  /** English genre names used for catalog filters (Drama, News, ...). */
  genres: string[];
  year?: number;
  /** ISO 639-1 language of the program. */
  language: string;
  /** The program's page on the broadcaster's site. */
  website?: string;
  geo: GeoAvailability;
  /** Epoch ms of the newest episode, when known. Used to sort "recently updated". */
  updatedAt?: number;
}

export interface VodEpisode {
  /** Unique within the program; only A-Z, a-z, 0-9, "_" and "-". */
  id: string;
  season: number;
  episode: number;
  title: string;
  /** ISO 8601 date the episode was first published or broadcast. */
  released?: string;
  thumbnail?: string;
  description?: string;
  durationSec?: number;
}

export interface VodProgramDetail extends VodProgram {
  episodes: VodEpisode[];
  /** Names for season numbers when the broadcaster names them ("October 2026", "2024"). */
  seasonNames?: Record<number, string>;
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
