const PALETTE = ["#1d4ed8", "#0f766e", "#7c3aed", "#b91c1c", "#a16207", "#0e7490"];

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** A plain name card used until a channel has an official logo configured. Not a broadcaster logo. */
export function namePoster(name: string, seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = PALETTE[hash % PALETTE.length];
  const words = name.split(" ");
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [name];
  const tspans = lines
    .map((l, i) => `<tspan x="256" dy="${i === 0 ? (lines.length === 1 ? 0 : -28) : 64}">${escapeXml(l)}</tspan>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="48" fill="${bg}"/>
<text x="256" y="276" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${tspans}</text>
</svg>`;
}
