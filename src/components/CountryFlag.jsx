import { h } from 'preact';

// URL of every 4:3 flag SVG. Only the URLs end up in the bundle; each flag is
// fetched by the browser when its <img> scrolls into view (instead of shipping
// all ~270 flags inside a 470 kB stylesheet up front).
const FLAG_URLS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
});

const byCode = {};
for (const [path, url] of Object.entries(FLAG_URLS)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -4);
  byCode[code] = url;
}

export function getFlagUrl(code) {
  return code ? byCode[String(code).toLowerCase()] || null : null;
}

export default function CountryFlag({ code, class: className = '' }) {
  const src = getFlagUrl(code);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      class={`block w-full h-full object-cover ${className}`}
    />
  );
}
