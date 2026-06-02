import {
  createTranslator,
  DEFAULT_LOCALE,
  isLocale,
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
