export interface HlsVariant {
  uri: string;
  bandwidth?: number;
  resolution?: { width: number; height: number };
  codecs?: string;
  frameRate?: number;
}

export interface HlsKey {
  method: string;
  keyFormat?: string;
  uri?: string;
}

export interface HlsMaster {
  kind: "master";
  variants: HlsVariant[];
  audio: Array<{ uri?: string; language?: string; name?: string }>;
  subtitles: Array<{ uri?: string; language?: string; name?: string }>;
  sessionKeys: HlsKey[];
}

export interface HlsMedia {
  kind: "media";
  targetDuration?: number;
  segments: string[];
  keys: HlsKey[];
  endList: boolean;
  /** EXT-X-MAP init segment for fMP4 streams. */
  initSegment?: string;
}

export type HlsPlaylist = HlsMaster | HlsMedia;

export class NotAPlaylistError extends Error {
  constructor(reason: string) {
    super(`Not an HLS playlist: ${reason}`);
    this.name = "NotAPlaylistError";
  }
}

/** Parses an attribute list like BANDWIDTH=1280000,CODECS="avc1.4d401f,mp4a.40.2". */
export function parseAttributes(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const raw = m[2] ?? "";
    out[m[1]!] = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  }
  return out;
}

function resolve(uri: string, base: string): string {
  return new URL(uri, base).toString();
}

function parseKey(attrs: Record<string, string>, base: string): HlsKey {
  return {
    method: attrs.METHOD ?? "NONE",
    keyFormat: attrs.KEYFORMAT,
    uri: attrs.URI ? resolve(attrs.URI, base) : undefined,
  };
}

/** Parses a master or media playlist. Throws NotAPlaylistError for anything else (an HTML page, JSON, ...). */
export function parsePlaylist(text: string, baseUrl: string): HlsPlaylist {
  const body = text.replace(/^﻿/, "");
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") {
    const head = body.slice(0, 40).replace(/\s+/g, " ");
    throw new NotAPlaylistError(`first line is not #EXTM3U (starts with "${head}")`);
  }

  const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));
  if (isMaster) {
    const master: HlsMaster = { kind: "master", variants: [], audio: [], subtitles: [], sessionKeys: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
        const uri = lines.slice(i + 1).find((l) => !l.startsWith("#"));
        if (!uri) continue;
        const res = attrs.RESOLUTION?.match(/^(\d+)x(\d+)$/);
        master.variants.push({
          uri: resolve(uri, baseUrl),
          bandwidth: attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : undefined,
          resolution: res ? { width: Number(res[1]), height: Number(res[2]) } : undefined,
          codecs: attrs.CODECS,
          frameRate: attrs["FRAME-RATE"] ? Number(attrs["FRAME-RATE"]) : undefined,
        });
      } else if (line.startsWith("#EXT-X-MEDIA:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-MEDIA:".length));
        const entry = { uri: attrs.URI ? resolve(attrs.URI, baseUrl) : undefined, language: attrs.LANGUAGE, name: attrs.NAME };
        if (attrs.TYPE === "AUDIO") master.audio.push(entry);
        else if (attrs.TYPE === "SUBTITLES") master.subtitles.push(entry);
      } else if (line.startsWith("#EXT-X-SESSION-KEY:")) {
        master.sessionKeys.push(parseKey(parseAttributes(line.slice("#EXT-X-SESSION-KEY:".length)), baseUrl));
      }
    }
    if (master.variants.length === 0) throw new NotAPlaylistError("master playlist has no variants");
    return master;
  }

  const media: HlsMedia = { kind: "media", segments: [], keys: [], endList: false };
  for (const line of lines) {
    if (line.startsWith("#EXT-X-TARGETDURATION:")) media.targetDuration = Number(line.split(":")[1]);
    else if (line.startsWith("#EXT-X-KEY:")) media.keys.push(parseKey(parseAttributes(line.slice("#EXT-X-KEY:".length)), baseUrl));
    else if (line.startsWith("#EXT-X-MAP:")) {
      const uri = parseAttributes(line.slice("#EXT-X-MAP:".length)).URI;
      if (uri) media.initSegment = resolve(uri, baseUrl);
    } else if (line === "#EXT-X-ENDLIST") media.endList = true;
    else if (!line.startsWith("#")) media.segments.push(resolve(line, baseUrl));
  }
  if (media.segments.length === 0) throw new NotAPlaylistError("media playlist has no segments");
  return media;
}

const DRM_KEYFORMATS: Array<[RegExp, string]> = [
  [/edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i, "Widevine"],
  [/9a04f079-9840-4286-ab92-e65be0885f95/i, "PlayReady"],
  [/com\.microsoft\.playready/i, "PlayReady"],
  [/com\.apple\.streamingkeydelivery/i, "FairPlay"],
];

/**
 * Returns the DRM system name if the keys indicate DRM, otherwise undefined.
 * Plain AES-128 with a reachable key is standard HLS encryption that players handle, so it is not DRM.
 */
export function detectDrm(keys: HlsKey[]): string | undefined {
  for (const k of keys) {
    if (k.method === "NONE") continue;
    for (const [re, name] of DRM_KEYFORMATS) if (k.keyFormat && re.test(k.keyFormat)) return name;
    if (k.uri?.startsWith("skd://")) return "FairPlay";
    if (k.method.startsWith("SAMPLE-AES") && k.keyFormat && k.keyFormat !== "identity") return `unknown (${k.keyFormat})`;
  }
  return undefined;
}

/** Picks the variant with the lowest bandwidth, which is the cheapest one to probe. */
export function lowestVariant(master: HlsMaster): HlsVariant {
  return [...master.variants].sort((a, b) => (a.bandwidth ?? Infinity) - (b.bandwidth ?? Infinity))[0]!;
}

/** Recognizes MPEG-TS, fragmented MP4, ADTS AAC and ID3-prefixed segments by their first bytes. */
export function sniffSegment(bytes: Uint8Array): "mpegts" | "fmp4" | "aac" | "unknown" {
  if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47)) return "mpegts";
  if (bytes.length >= 8) {
    const box = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (["ftyp", "styp", "moof", "sidx", "moov"].includes(box)) return "fmp4";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "aac";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "aac";
  return "unknown";
}
