import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** "en:123,fr:456" -> { en: "123", fr: "456" } */
const keyValueList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const out: Record<string, string> = {};
    for (const pair of (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const idx = pair.indexOf(":");
      if (idx <= 0 || idx === pair.length - 1) {
        ctx.addIssue({ code: "custom", message: `expected key:value, got "${pair}"` });
        continue;
      }
      out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return out;
  });

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))
  .pipe(z.url().optional());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(7000),
  HOST: z.string().default("0.0.0.0"),
  /** Public HTTPS origin of the add-on, e.g. https://iltv.example.com. Falls back to the request origin. */
  BASE_URL: optionalUrl,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /**
   * verified-only: only streams with a passing playback check are returned to Stremio.
   * all-labeled: unverified streams are returned too, labeled as unverified.
   */
  STREAM_POLICY: z.enum(["verified-only", "all-labeled"]).default("all-labeled"),
  VERIFIED_MAX_AGE_HOURS: z.coerce.number().positive().default(72),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  DATABASE_PATH: z.string().default("./data/addon.db"),
  /** Bearer token for /admin routes. Admin routes are disabled when unset. */
  ADMIN_TOKEN: optionalString.pipe(z.string().min(16).optional()),
  /** Minutes between background stream probes. 0 disables. */
  HEALTH_PROBE_INTERVAL_MIN: z.coerce.number().min(0).default(30),
  /** Comma-separated provider ids. Empty means all. */
  ENABLED_PROVIDERS: csv,
  /** Label stored with checks run from this host, e.g. "IL" or "DE". */
  VERIFIER_LOCATION: optionalString,

  I24_BRIGHTCOVE_ACCOUNT: z.string().default("5377161796001"),
  I24_BRIGHTCOVE_PLAYER_ID: optionalString,
  I24_BRIGHTCOVE_POLICY_KEY: optionalString,
  /** Live feed video ids per language: "en:<id>,fr:<id>,ar:<id>,he:<id>". */
  I24_LIVE_VIDEO_IDS: keyValueList,

  /** Direct HLS manifest for the Knesset channel. */
  KNESSET_LIVE_URL: optionalUrl,
  /** A page that embeds the Knesset player; the manifest URL is read from it at request time. */
  KNESSET_LIVE_PAGE: optionalUrl,
});

export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  host: string;
  baseUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  streamPolicy: "verified-only" | "all-labeled";
  verifiedMaxAgeMs: number;
  requestTimeoutMs: number;
  providerTimeoutMs: number;
  databasePath: string;
  adminToken?: string;
  healthProbeIntervalMs: number;
  enabledProviders: string[];
  verifierLocation?: string;
  providers: {
    i24news: {
      account: string;
      playerId?: string;
      policyKey?: string;
      liveVideoIds: Record<string, string>;
    };
    knesset: {
      liveUrl?: string;
      livePage?: string;
    };
  };
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    baseUrl: e.BASE_URL?.replace(/\/+$/, ""),
    logLevel: e.LOG_LEVEL,
    streamPolicy: e.STREAM_POLICY,
    verifiedMaxAgeMs: e.VERIFIED_MAX_AGE_HOURS * 3600_000,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    providerTimeoutMs: e.PROVIDER_TIMEOUT_MS,
    databasePath: e.DATABASE_PATH,
    adminToken: e.ADMIN_TOKEN,
    healthProbeIntervalMs: e.HEALTH_PROBE_INTERVAL_MIN * 60_000,
    enabledProviders: e.ENABLED_PROVIDERS,
    verifierLocation: e.VERIFIER_LOCATION,
    providers: {
      i24news: {
        account: e.I24_BRIGHTCOVE_ACCOUNT,
        playerId: e.I24_BRIGHTCOVE_PLAYER_ID,
        policyKey: e.I24_BRIGHTCOVE_POLICY_KEY,
        liveVideoIds: e.I24_LIVE_VIDEO_IDS,
      },
      knesset: {
        liveUrl: e.KNESSET_LIVE_URL,
        livePage: e.KNESSET_LIVE_PAGE,
      },
    },
  };
}
