import { resolveRetentionPolicy } from "./retention.config";

describe("resolveRetentionPolicy", () => {
  it("defaults to the published windows when unset (2yr conversations/usage, 1yr transcripts/concierge)", () => {
    expect(resolveRetentionPolicy({})).toEqual({
      conversationDays: 730,
      usageLogDays: 730,
      consultationTranscriptDays: 365,
      conciergeRecordDays: 365,
    });
  });

  it("honours positive integer overrides", () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_CONVERSATION_DAYS: "365",
        RETENTION_USAGE_LOG_DAYS: "180",
        RETENTION_CONSULTATION_TRANSCRIPT_DAYS: "200",
        RETENTION_CONCIERGE_DAYS: "100",
      }),
    ).toEqual({
      conversationDays: 365,
      usageLogDays: 180,
      consultationTranscriptDays: 200,
      conciergeRecordDays: 100,
    });
  });

  it("ignores non-positive / unparseable overrides so a typo can't collapse the window", () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_CONVERSATION_DAYS: "0",
        RETENTION_USAGE_LOG_DAYS: "not-a-number",
        RETENTION_CONSULTATION_TRANSCRIPT_DAYS: "-5",
        RETENTION_CONCIERGE_DAYS: "",
      }),
    ).toEqual({
      conversationDays: 730,
      usageLogDays: 730,
      consultationTranscriptDays: 365,
      conciergeRecordDays: 365,
    });
  });

  it("floors a fractional override", () => {
    expect(resolveRetentionPolicy({ RETENTION_CONVERSATION_DAYS: "90.9" })).toEqual({
      conversationDays: 90,
      usageLogDays: 730,
      consultationTranscriptDays: 365,
      conciergeRecordDays: 365,
    });
  });
});
