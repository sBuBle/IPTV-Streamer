export type FetchFn = typeof fetch;

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }

  /** Network errors, timeouts, 429 and 5xx are worth retrying. */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Extra attempts after the first one. Only used for retryable failures. */
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  fetch?: FetchFn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function combineSignals(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([t, outer]) : t;
}

/** GET with timeout, status check and bounded retries. Returns the response with its body unread. */
export async function httpGet(url: string, opts: RequestOptions): Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 1;
  let lastError: HttpError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep((opts.retryDelayMs ?? 300) * 2 ** (attempt - 1));
    try {
      const res = await doFetch(url, {
        headers: opts.headers,
        redirect: "follow",
        signal: combineSignals(opts.timeoutMs, opts.signal),
      });
      if (res.ok) return res;
      await res.body?.cancel().catch(() => {});
      lastError = new HttpError(`HTTP ${res.status} for ${redactUrl(url)}`, res.status, url);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      lastError = new HttpError(`Request failed for ${redactUrl(url)}: ${msg}`, undefined, url);
    }
    if (!lastError.retryable) break;
  }
  throw lastError!;
}

export async function getText(url: string, opts: RequestOptions): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const res = await httpGet(url, opts);
  return { text: await res.text(), finalUrl: res.url || url, contentType: res.headers.get("content-type") ?? "" };
}

export async function getJson(url: string, opts: RequestOptions): Promise<unknown> {
  const res = await httpGet(url, opts);
  return res.json();
}

/** Strips query strings (they often hold signed tokens) so URLs are safe to log. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.search ? `${u.origin}${u.pathname}?…` : `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}
