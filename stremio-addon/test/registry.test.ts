import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { channel, staticProvider, testConfig } from "./helpers.js";

describe("ProviderRegistry", () => {
  it("isolates a failing provider and records its error", async () => {
    const bad = staticProvider("bad", [], {}, { fail: true });
    const reg = new ProviderRegistry([bad], { config: testConfig(), logger: silentLogger });
    const r = await reg.call(bad, "listChannels", (ctx) => bad.live!.listChannels(ctx));
    expect(r).toEqual({ ok: false, error: "bad is down" });
    expect(reg.healthReport()[0]).toMatchObject({ failures: 1, consecutiveFailures: 1, lastError: "listChannels: bad is down" });
  });

  it("times out a hanging provider and aborts its signal", async () => {
    let aborted = false;
    const hang: ProviderAdapter = {
      id: "hang",
      name: "Hang",
      issues: () => [],
      live: {
        listChannels: (ctx) =>
          new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () => {
              aborted = true;
              resolve([]);
            });
          }),
        resolveStreams: async () => [],
      },
    };
    const reg = new ProviderRegistry([hang], { config: testConfig({ PROVIDER_TIMEOUT_MS: "50" }), logger: silentLogger });
    const r = await reg.call(hang, "listChannels", (ctx) => hang.live!.listChannels(ctx));
    expect(r.ok).toBe(false);
    expect(aborted).toBe(true);
  });

  it("disables providers with config errors or outside ENABLED_PROVIDERS", () => {
    const broken: ProviderAdapter = { ...staticProvider("broken", [], {}), issues: () => [{ severity: "error", message: "missing key" }] };
    const ok = staticProvider("ok", [channel({ id: "a", provider: "ok" })], {});
    const other = staticProvider("other", [], {});
    const reg = new ProviderRegistry([broken, ok, other], { config: testConfig({ ENABLED_PROVIDERS: "ok,broken" }), logger: silentLogger });
    expect(reg.enabled().map((p) => p.id)).toEqual(["ok"]);
    expect(reg.healthReport().find((h) => h.id === "broken")?.issues[0]?.message).toBe("missing key");
  });
});
