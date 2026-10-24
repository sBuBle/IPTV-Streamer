// Fetches each request in the list and writes status, headers and body to the output folder.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [listPath, outDir] = process.argv.slice(2);
const requests = JSON.parse(readFileSync(listPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const index = [];
for (const [i, r] of requests.entries()) {
  const name = r.name ?? `r${i}`;
  try {
    const res = await fetch(r.url, {
      method: r.method ?? "GET",
      headers: { "user-agent": UA, ...(r.headers ?? {}) },
      body: r.body === undefined ? undefined : typeof r.body === "string" ? r.body : JSON.stringify(r.body),
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(`${outDir}/${name}.body`, buf.subarray(0, 3_000_000));
    index.push({ name, url: r.url, status: res.status, finalUrl: res.url, headers: Object.fromEntries(res.headers), bytes: buf.length });
  } catch (err) {
    index.push({ name, url: r.url, error: String(err) });
  }
}
writeFileSync(`${outDir}/index.json`, JSON.stringify(index, null, 2));
