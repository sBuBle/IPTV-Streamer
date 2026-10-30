/**
 * Finds HLS/DASH manifest URLs embedded in an HTML page or player script.
 * Only URLs that end in a manifest extension are returned; a page URL is never treated as a stream.
 */
export function extractManifestUrls(html: string, pageUrl: string): string[] {
  const text = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const re = /(?:https?:)?\/\/[^\s"'<>()\\]+?\.(?:m3u8|mpd)(?:\?[^\s"'<>()\\]*)?(?=["'\s<>)\\]|$)/gi;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) {
    try {
      out.add(new URL(m[0].startsWith("//") ? `https:${m[0]}` : m[0], pageUrl).toString());
    } catch {
      // ignore malformed matches
    }
  }
  return [...out];
}
