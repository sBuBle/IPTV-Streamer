import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("config", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(7000);
    expect(c.streamPolicy).toBe("all-labeled");
    expect(c.providers.i24news.pages.all).toBe("69f250bfaa852e43acd716b9");
    expect(c.providers.knesset.livePage).toBe("https://www.knesset.tv/");
  });

  it("parses lists and trims the base URL", () => {
    const c = loadConfig({ BASE_URL: "https://tv.example.com/", I24_PAGES: "all:111, french:222", ENABLED_PROVIDERS: "knesset", KNESSET_LIVE_PAGE: "none" });
    expect(c.baseUrl).toBe("https://tv.example.com");
    expect(c.providers.i24news.pages).toEqual({ all: "111", french: "222" });
    expect(c.providers.knesset.livePage).toBeUndefined();
    expect(c.enabledProviders).toEqual(["knesset"]);
  });

  it("rejects invalid values with readable issues", () => {
    expect(() => loadConfig({ PORT: "abc", KNESSET_LIVE_URL: "not a url", ADMIN_TOKEN: "short" })).toThrow(ConfigError);
    try {
      loadConfig({ I24_PAGES: "all" });
    } catch (err) {
      expect((err as ConfigError).issues.join()).toMatch(/I24_PAGES/);
    }
  });
});
