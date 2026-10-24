import { describe, expect, it } from "vitest";
import { matchesQuery, normalizeForSearch } from "../src/util/text.js";

describe("search normalization", () => {
  it("strips niqqud, folds final letters and punctuation", () => {
    expect(normalizeForSearch("עָרוּץ הַכְּנֶסֶת")).toBe("ערוצ הכנסת");
    expect(normalizeForSearch("i24NEWS: English")).toBe("i24news english");
    expect(normalizeForSearch('צה"ל')).toBe("צה ל");
  });

  it("matches word prefixes in Hebrew and English", () => {
    expect(matchesQuery("כנסת", ["Knesset Channel", "ערוץ הכנסת"])).toBe(true);
    expect(matchesQuery("הכנ", ["ערוץ הכנסת"])).toBe(true);
    expect(matchesQuery("ערוץ", ["ערוץ הכנסת"])).toBe(true);
    expect(matchesQuery("i24 eng", ["i24NEWS English", "i24"])).toBe(true);
    expect(matchesQuery("kan", ["Knesset Channel"])).toBe(false);
  });
});
