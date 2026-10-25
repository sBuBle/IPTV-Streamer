import { execFile } from "node:child_process";
import type { ResolvedStream } from "../domain/types.js";

export interface DecodedStream {
  type: "video" | "audio" | "subtitle" | "other";
  codec?: string;
  width?: number;
  height?: number;
  channels?: number;
  framesDecoded: number;
}

export interface PlaybackResult {
  ok: boolean;
  error?: string;
  streams: DecodedStream[];
  videoFrames: number;
  audioFrames: number;
  secondsRequested: number;
  durationMs: number;
}

export interface PlaybackOptions {
  /** Seconds of media to decode from the start. */
  seconds?: number;
  timeoutMs?: number;
  ffprobePath?: string;
  /** Minimum decoded video frames; 25 is about one second at 25 fps. */
  minVideoFrames?: number;
  minAudioFrames?: number;
  requireAudio?: boolean;
}

interface FfprobeOutput {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    channels?: number;
    nb_read_frames?: string;
  }>;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const reason = err.killed ? `timed out after ${timeoutMs} ms` : (stderr.trim().split("\n").slice(-3).join(" | ") || err.message);
        reject(new Error(reason));
      } else resolve({ stdout, stderr });
    });
  });
}

/**
 * Real playback check: ffprobe opens the stream like a player would and decodes the first seconds of
 * every video and audio track (-count_frames). Passing means frames were actually decoded, which an
 * HTTP 200 or a valid playlist alone cannot show. This is the only check that marks a stream verified.
 */
export async function verifyPlayback(stream: Pick<ResolvedStream, "url" | "headers">, opts: PlaybackOptions = {}): Promise<PlaybackResult> {
  const seconds = opts.seconds ?? 8;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const started = Date.now();
  const args = ["-v", "error", "-rw_timeout", "15000000"];
  const headers = { ...(stream.headers ?? {}) };
  const ua = Object.entries(headers).find(([k]) => k.toLowerCase() === "user-agent");
  if (ua) {
    args.push("-user_agent", ua[1]);
    delete headers[ua[0]];
  }
  const headerBlob = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  if (headerBlob) args.push("-headers", headerBlob);
  args.push(
    "-count_frames",
    "-read_intervals",
    `%+${seconds}`,
    "-show_entries",
    "stream=codec_type,codec_name,width,height,channels,nb_read_frames",
    "-of",
    "json",
    stream.url,
  );

  const base = { streams: [] as DecodedStream[], videoFrames: 0, audioFrames: 0, secondsRequested: seconds };
  let out: FfprobeOutput;
  try {
    const { stdout } = await run(opts.ffprobePath ?? "ffprobe", args, timeoutMs);
    out = JSON.parse(stdout) as FfprobeOutput;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ...base, durationMs: Date.now() - started };
  }

  const streams: DecodedStream[] = (out.streams ?? []).map((s) => ({
    type: s.codec_type === "video" || s.codec_type === "audio" || s.codec_type === "subtitle" ? s.codec_type : "other",
    codec: s.codec_name,
    width: s.width,
    height: s.height,
    channels: s.channels,
    framesDecoded: Number(s.nb_read_frames ?? 0) || 0,
  }));
  const videoFrames = Math.max(0, ...streams.filter((s) => s.type === "video").map((s) => s.framesDecoded));
  const audioFrames = Math.max(0, ...streams.filter((s) => s.type === "audio").map((s) => s.framesDecoded));
  const minVideo = opts.minVideoFrames ?? 25;
  const minAudio = opts.minAudioFrames ?? 10;
  const requireAudio = opts.requireAudio ?? true;

  let error: string | undefined;
  if (!streams.some((s) => s.type === "video")) error = "no video track";
  else if (videoFrames < minVideo) error = `only ${videoFrames} video frames decoded (need ${minVideo})`;
  else if (requireAudio && !streams.some((s) => s.type === "audio")) error = "no audio track";
  else if (requireAudio && audioFrames < minAudio) error = `only ${audioFrames} audio frames decoded (need ${minAudio})`;

  return { ok: !error, error, streams, videoFrames, audioFrames, secondsRequested: seconds, durationMs: Date.now() - started };
}
