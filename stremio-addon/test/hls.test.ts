import { describe, expect, it } from "vitest";
import { extractManifestUrls } from "../src/media/extract.js";
import { detectDrm, lowestVariant, NotAPlaylistError, parsePlaylist, sniffSegment } from "../src/media/hls.js";

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="he",NAME="Hebrew",URI="audio/he.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,CODECS="avc1.42c00d,mp4a.40.2"
https://cdn.example.com/180/index.m3u8?token=abc
`;

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6.0,
seg100.ts
#EXTINF:6.0,
seg101.ts
`;

describe("HLS parsing", () => {
  it("parses a master playlist and resolves relative URIs", () => {
    const p = parsePlaylist(MASTER, "https://live.example.com/ch/master.m3u8");
    expect(p.kind).toBe("master");
    if (p.kind !== "master") return;
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0]).toMatchObject({ uri: "https://live.example.com/ch/720/index.m3u8", bandwidth: 2500000, resolution: { width: 1280, height: 720 } });
    expect(p.audio[0]).toMatchObject({ language: "he", uri: "https://live.example.com/ch/audio/he.m3u8" });
    expect(p.subtitles).toHaveLength(1);
    expect(lowestVariant(p).uri).toBe("https://cdn.example.com/180/index.m3u8?token=abc");
  });

  it("parses a live media playlist", () => {
    const p = parsePlaylist(MEDIA, "https://live.example.com/ch/720/index.m3u8");
    expect(p).toMatchObject({ kind: "media", targetDuration: 6, endList: false });
    if (p.kind !== "media") return;
    expect(p.segments[1]).toBe("https://live.example.com/ch/720/seg101.ts");
    expect(p.keys[0]).toMatchObject({ method: "AES-128", uri: "https://live.example.com/ch/720/key.bin" });
    expect(detectDrm(p.keys)).toBeUndefined();
  });

  it("refuses an HTML page served as a playlist", () => {
    expect(() => parsePlaylist("<!doctype html><html>video page</html>", "https://x/y.m3u8")).toThrow(NotAPlaylistError);
    expect(() => parsePlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:6\n", "https://x/y.m3u8")).toThrow(/no segments/);
  });

  it("detects DRM systems but not plain AES-128", () => {
    expect(detectDrm([{ method: "SAMPLE-AES", keyFormat: "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" }])).toBe("Widevine");
    expect(detectDrm([{ method: "SAMPLE-AES", keyFormat: "com.apple.streamingkeydelivery", uri: "skd://x" }])).toBe("FairPlay");
    expect(detectDrm([{ method: "SAMPLE-AES-CTR", keyFormat: "com.microsoft.playready" }])).toBe("PlayReady");
    expect(detectDrm([{ method: "AES-128", uri: "https://k" }, { method: "NONE" }])).toBeUndefined();
  });

  it("sniffs segment containers", () => {
    const ts = new Uint8Array(376);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(sniffSegment(ts)).toBe("mpegts");
    expect(sniffSegment(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]))).toBe("fmp4");
    expect(sniffSegment(new TextEncoder().encode("<html><body>not video</body></html>"))).toBe("unknown");
  });
});

describe("manifest extraction from pages", () => {
  it("finds manifest URLs and ignores page links", () => {
    const html = `<a href="https://site.example/live">Live</a>
      <script>var cfg={"src":"https:\\/\\/kneset.gostreaming.tv\\/p\\/playlist.m3u8?x=1&amp;y=2"};</script>
      <video src="//cdn.example.com/a/manifest.mpd"></video>`;
    expect(extractManifestUrls(html, "https://site.example/live")).toEqual([
      "https://kneset.gostreaming.tv/p/playlist.m3u8?x=1&y=2",
      "https://cdn.example.com/a/manifest.mpd",
    ]);
  });
});
