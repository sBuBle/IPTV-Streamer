/**
 * Small regex-based HTML helpers. They run on Workers and Node without a DOM, and are only meant for the
 * well-formed server-rendered pages of the broadcasters we read.
 */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/** Text content of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function textOf(html: string | undefined): string {
  if (!html) return "";
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Value of an attribute in a single tag string, decoded. */
export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  const v = m?.[1] ?? m?.[2];
  return v === undefined ? undefined : decodeEntities(v);
}

/** Content of <meta property|name="..." content="...">. */
export function metaContent(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, "property") === key || attr(tag, "name") === key) return attr(tag, "content");
  }
  return undefined;
}

/** Every <a ...>...</a> whose href matches `hrefPattern`, with its attributes and inner HTML. */
export function anchors(html: string, hrefPattern: RegExp): Array<{ href: string; tag: string; inner: string; index: number }> {
  const out: Array<{ href: string; tag: string; inner: string; index: number }> = [];
  for (const m of html.matchAll(/<a\s[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href || !hrefPattern.test(href)) continue;
    const start = m.index + m[0].length;
    const end = html.indexOf("</a>", start);
    out.push({ href, tag: m[0], inner: end === -1 ? "" : html.slice(start, end), index: m.index });
  }
  return out;
}

/** First <img> src in a fragment, made absolute. */
export function firstImage(html: string, baseUrl: string): string | undefined {
  const tag = html.match(/<img\s[^>]*>/i)?.[0];
  const src = tag && (attr(tag, "src") ?? attr(tag, "data-src"));
  return src ? absoluteUrl(src, baseUrl) : undefined;
}

export function absoluteUrl(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url, baseUrl).toString();
  } catch {
    return undefined;
  }
}
