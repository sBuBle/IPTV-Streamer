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

/** "none" or an empty value turns a default URL off. */
const urlOrNone = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v === "" || v === "none" || z.url().safeParse(v).success, "expected a URL or \"none\"");

function disabledOrUrl(v: string): string | undefined {
  return v === "" || v === "none" ? undefined : v;
}

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

  /** Insight API behind video.i24news.tv. */
  I24_API_URL: z.url().default("https://insight-api-shared.univtec.com"),
  I24_TENANT: z.string().default("i24israel"),
  /** Region home pages that list the live channels, as region:pageId. */
  I24_PAGES: keyValueList.prefault("all:69f250bfaa852e43acd716b9,french:69f250caaa852e43acd716bc,arabic:69f250d1aa852e43acd716bf"),

  /** Direct HLS manifest for the Knesset channel, used as backup. "none" disables it. */
  KNESSET_LIVE_URL: urlOrNone.default("https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8"),
  /** A page that embeds the Knesset player; the manifest URL is read from it at request time. "none" disables it. */
  KNESSET_LIVE_PAGE: urlOrNone.default("https://www.knesset.tv/"),
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
      apiUrl: string;
      tenant: string;
      pages: Record<string, string>;
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
        apiUrl: e.I24_API_URL,
        tenant: e.I24_TENANT,
        pages: e.I24_PAGES,
      },
      knesset: {
        liveUrl: disabledOrUrl(e.KNESSET_LIVE_URL),
        livePage: disabledOrUrl(e.KNESSET_LIVE_PAGE),
      },
    },
  };
}
