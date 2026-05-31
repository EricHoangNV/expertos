import { getDatabaseUrl } from "./config";

describe("getDatabaseUrl", () => {
  it("returns the configured URL", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgresql://x" })).toBe(
      "postgresql://x",
    );
  });

  it("throws when unset", () => {
    expect(() => getDatabaseUrl({})).toThrow("DATABASE_URL is not set");
  });

  it("throws when blank", () => {
    expect(() => getDatabaseUrl({ DATABASE_URL: "  " })).toThrow(
      "DATABASE_URL is not set",
    );
  });

  it("falls back to process.env when no argument is passed", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://from-process-env";
    try {
      expect(getDatabaseUrl()).toBe("postgresql://from-process-env");
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});
