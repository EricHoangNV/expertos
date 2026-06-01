import { resolveRetentionPolicy } from "./retention.config";

describe("resolveRetentionPolicy", () => {
  it("defaults to the published 2-year (730-day) windows when unset", () => {
    expect(resolveRetentionPolicy({})).toEqual({
      conversationDays: 730,
      usageLogDays: 730,
    });
  });

  it("honours positive integer overrides", () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_CONVERSATION_DAYS: "365",
        RETENTION_USAGE_LOG_DAYS: "180",
      }),
    ).toEqual({ conversationDays: 365, usageLogDays: 180 });
  });

  it("ignores non-positive / unparseable overrides so a typo can't collapse the window", () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_CONVERSATION_DAYS: "0",
        RETENTION_USAGE_LOG_DAYS: "not-a-number",
      }),
    ).toEqual({ conversationDays: 730, usageLogDays: 730 });
  });

  it("floors a fractional override", () => {
    expect(resolveRetentionPolicy({ RETENTION_CONVERSATION_DAYS: "90.9" })).toEqual({
      conversationDays: 90,
      usageLogDays: 730,
    });
  });
});
