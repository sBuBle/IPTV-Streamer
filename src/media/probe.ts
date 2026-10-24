import type { ResolvedStream } from "../domain/types.js";
import { errorMessage } from "../providers/registry.js";
import { httpGet, type FetchFn } from "../util/http.js";
import { detectDrm, lowestVariant, parsePlaylist, sniffSegment, type HlsMaster } from "./hls.js";

export type ProbeStage = "manifest" | "variant" | "segment" | "done";

export interface ProbeResult {
  ok: boolean;
  /** The stage that failed, or "done". */
  stage: ProbeStage;
  error?: string;
  drm?: string;
  variants?: Array<{ height?: number; bandwidth?: number; codecs?: string }>;
  audioTracks?: number;
  subtitleTracks?: number;
  segmentType?: string;
  segmentBytes?: number;
  live?: boolean;
  durationMs: number;
}

const SEGMENT_SAMPLE_BYTES = 64 * 1024;

async function readPrefix(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - offset);
    out.set(c.subarray(0, n), offset);
    offset += n;
    if (offset >= out.length) break;
  }
  return out;
}

/**
 * Downloads the manifest, one variant playlist and the start of one media segment.
 * A passing probe means the stream is reachable and looks like media. It is NOT proof of playback;
 * only a decode check (see verify/playback.ts) can mark a stream verified.
 */
export async function probeHls(
  stream: Pick<ResolvedStream, "url" | "headers">,
  opts: { timeoutMs: number; fetch?: FetchFn; now?: () => number },
): Promise<ProbeResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const req = { headers: stream.headers, timeoutMs: opts.timeoutMs, retries: 0, fetch: opts.fetch };
  const fail = (stage: ProbeStage, error: string, extra: Partial<ProbeResult> = {}): ProbeResult => ({
    ok: false,
    stage,
    error,
    ...extra,
    durationMs: now() - started,
  });

  let master: HlsMaster | undefined;
  let mediaUrl = stream.url;
  let mediaText: string;
  try {
    const res = await httpGet(stream.url, req);
    const text = await res.text();
    const playlist = parsePlaylist(text, res.url || stream.url);
    if (playlist.kind === "master") {
      master = playlist;
      const drm = detectDrm(playlist.sessionKeys);
      if (drm) return fail("manifest", `DRM-protected (${drm})`, { drm });
      mediaUrl = lowestVariant(playlist).uri;
      mediaText = "";
    } else {
      mediaText = text;
    }
  } catch (err) {
    return fail("manifest", errorMessage(err));
  }

  const summary: Partial<ProbeResult> = master
    ? {
        variants: master.variants.map((v) => ({ height: v.resolution?.height, bandwidth: v.bandwidth, codecs: v.codecs })),
        audioTracks: master.audio.length,
        subtitleTracks: master.subtitles.length,
      }
    : {};

  let segmentUrl: string;
  let encrypted = false;
  try {
    let base = mediaUrl;
    if (master) {
      const res = await httpGet(mediaUrl, req);
      mediaText = await res.text();
      base = res.url || mediaUrl;
    }
    const media = parsePlaylist(mediaText, base);
    if (media.kind !== "media") return fail("variant", "variant URL returned another master playlist", summary);
    const drm = detectDrm(media.keys);
    if (drm) return fail("variant", `DRM-protected (${drm})`, { ...summary, drm });
    summary.live = !media.endList;
    encrypted = media.keys.some((k) => k.method === "AES-128");
    // For live streams the newest segments are at the end; the first may already be gone.
    segmentUrl = media.endList ? media.segments[0]! : media.segments[Math.max(0, media.segments.length - 3)]!;
  } catch (err) {
    return fail("variant", errorMessage(err), summary);
  }

  try {
    const res = await httpGet(segmentUrl, req);
    const bytes = await readPrefix(res, SEGMENT_SAMPLE_BYTES);
    const type = encrypted ? "aes-128-encrypted" : sniffSegment(bytes);
    if (bytes.length === 0) return fail("segment", "segment is empty", summary);
    if (type === "unknown") return fail("segment", "segment does not look like MPEG-TS, fMP4 or AAC", { ...summary, segmentBytes: bytes.length });
    return { ok: true, stage: "done", ...summary, segmentType: type, segmentBytes: bytes.length, durationMs: now() - started };
  } catch (err) {
    return fail("segment", errorMessage(err), summary);
  }
}
