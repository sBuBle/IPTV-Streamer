import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("config", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(7000);
    expect(c.streamPolicy).toBe("all-labeled");
    expect(c.providers.i24news.account).toBe("5377161796001");
    expect(c.providers.i24news.liveVideoIds).toEqual({});
  });

  it("parses lists and trims the base URL", () => {
    const c = loadConfig({ BASE_URL: "https://tv.example.com/", I24_LIVE_VIDEO_IDS: "en:111, he:222", ENABLED_PROVIDERS: "knesset" });
    expect(c.baseUrl).toBe("https://tv.example.com");
    expect(c.providers.i24news.liveVideoIds).toEqual({ en: "111", he: "222" });
    expect(c.enabledProviders).toEqual(["knesset"]);
  });

  it("rejects invalid values with readable issues", () => {
    expect(() => loadConfig({ PORT: "abc", KNESSET_LIVE_URL: "not a url", ADMIN_TOKEN: "short" })).toThrow(ConfigError);
    try {
      loadConfig({ I24_LIVE_VIDEO_IDS: "en" });
    } catch (err) {
      expect((err as ConfigError).issues.join()).toMatch(/I24_LIVE_VIDEO_IDS/);
    }
  });
});
