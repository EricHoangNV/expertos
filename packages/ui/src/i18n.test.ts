import {
  createTranslator,
  DEFAULT_LOCALE,
  formatCurrency,
  formatDateTime,
  formatNumber,
  isLocale,
  localeTag,
  LOCALES,
  translate,
  type Messages,
} from "./i18n";

const CATALOG: Messages = {
  chat: {
    emptyTitle: "Start a new conversation",
    askPlaceholder: "Ask {name} anything about {topic}",
    nested: { deep: "leaf" },
  },
  plain: "no namespace",
};

describe("locale helpers", () => {
  it("exposes the supported locales with EN as the default", () => {
    expect(LOCALES).toEqual(["en", "vi"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("narrows only the two supported locale strings", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("vi")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("translate", () => {
  it("resolves a top-level and a nested dot-path to its leaf string", () => {
    expect(translate(CATALOG, "plain")).toBe("no namespace");
    expect(translate(CATALOG, "chat.emptyTitle")).toBe("Start a new conversation");
    expect(translate(CATALOG, "chat.nested.deep")).toBe("leaf");
  });

  it("interpolates named {placeholders}, leaving unknown tokens verbatim", () => {
    expect(
      translate(CATALOG, "chat.askPlaceholder", { name: "Mai", topic: "tax" }),
    ).toBe("Ask Mai anything about tax");
    // Missing param → the token is preserved (not blanked).
    expect(translate(CATALOG, "chat.askPlaceholder", { name: "Mai" })).toBe(
      "Ask Mai anything about {topic}",
    );
  });

  it("coerces numeric params to strings", () => {
    expect(translate({ q: "{n} left" }, "q", { n: 3 })).toBe("3 left");
  });

  it("falls back to the key when missing or when the path lands on a branch", () => {
    expect(translate(CATALOG, "chat.missing")).toBe("chat.missing");
    expect(translate(CATALOG, "chat")).toBe("chat");
    // A path that descends through a leaf string returns the key, not a crash.
    expect(translate(CATALOG, "plain.further")).toBe("plain.further");
  });
});

describe("locale-aware formatters (M13.5)", () => {
  it("maps each locale to its BCP-47 region tag", () => {
    expect(localeTag("en")).toBe("en-US");
    expect(localeTag("vi")).toBe("vi-VN");
  });

  it("formats numbers with the locale's grouping and decimal separators", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("vi", 1234.5)).toBe("1.234,5");
  });

  it("guards non-finite numbers with an empty string, not 'NaN'", () => {
    expect(formatNumber("en", Number.NaN)).toBe("");
    expect(formatNumber("en", Number.POSITIVE_INFINITY)).toBe("");
  });

  it("formats currency by locale, honoring the currency's own fraction digits", () => {
    // Normalize the no-break spaces (U+00A0/U+202F) Intl inserts around symbols.
    const norm = (s: string) => s.replace(/\s/g, " ");
    expect(formatCurrency("en", 4.99, "usd")).toBe("$4.99");
    // VI places the symbol after the amount and uses a comma decimal.
    expect(norm(formatCurrency("vi", 4.99, "USD"))).toBe("4,99 US$");
    // VND has zero fraction digits — a major-unit amount renders without decimals.
    expect(norm(formatCurrency("vi", 499000, "VND"))).toBe("499.000 ₫");
  });

  it("guards non-finite currency amounts", () => {
    expect(formatCurrency("en", Number.NaN, "USD")).toBe("");
  });

  it("formats date+time by locale (day-first for VI) and survives bad input", () => {
    const en = formatDateTime("en", "2026-06-02T15:04:00Z");
    const vi = formatDateTime("vi", "2026-06-02T15:04:00Z");
    expect(en).toContain("2026");
    expect(vi).toContain("2026");
    expect(en).not.toBe(vi);
    // Accepts a Date instance too.
    expect(formatDateTime("en", new Date("2026-06-02T15:04:00Z"))).toBe(en);
    // Unparseable input → empty string, never "Invalid Date".
    expect(formatDateTime("en", "not-a-date")).toBe("");
  });

  it("honors caller-supplied Intl.DateTimeFormat options", () => {
    expect(formatDateTime("en", "2026-06-02T15:04:00Z", { year: "numeric" })).toBe("2026");
  });
});

describe("createTranslator", () => {
  it("binds a namespace prefix so callers omit it", () => {
    const t = createTranslator(CATALOG, "chat");
    expect(t("emptyTitle")).toBe("Start a new conversation");
    expect(t("askPlaceholder", { name: "Mai", topic: "tax" })).toBe(
      "Ask Mai anything about tax",
    );
  });

  it("works without a namespace", () => {
    const t = createTranslator(CATALOG);
    expect(t("plain")).toBe("no namespace");
    expect(t("chat.nested.deep")).toBe("leaf");
  });
});
