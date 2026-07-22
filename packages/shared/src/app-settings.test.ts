import { CHAT_MODELS, chatModelSchema, appSettingsUpdateSchema } from "./app-settings";

describe("chatModelSchema", () => {
  it("accepts the two allowlisted chat models", () => {
    expect(chatModelSchema.parse("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(chatModelSchema.parse("gpt-4o")).toBe("gpt-4o");
  });

  it("exposes exactly the priced allowlist", () => {
    expect(CHAT_MODELS).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });

  it("rejects an off-allowlist model (no pricing-table entry)", () => {
    expect(chatModelSchema.safeParse("gpt-4-turbo").success).toBe(false);
    expect(chatModelSchema.safeParse("claude-opus-4-8").success).toBe(false);
  });
});

describe("appSettingsUpdateSchema", () => {
  const valid = {
    llmTemperature: 0.2,
    defaultChatModel: "gpt-4o-mini" as const,
    retrievalScoreFloor: 0,
    betaGateEnabled: true,
  };

  it("accepts in-range settings", () => {
    expect(appSettingsUpdateSchema.parse(valid)).toEqual(valid);
  });

  it("accepts the temperature bounds [0, 2]", () => {
    expect(appSettingsUpdateSchema.safeParse({ ...valid, llmTemperature: 0 }).success).toBe(true);
    expect(appSettingsUpdateSchema.safeParse({ ...valid, llmTemperature: 2 }).success).toBe(true);
  });

  it("rejects a temperature above the OpenAI sampling ceiling", () => {
    expect(appSettingsUpdateSchema.safeParse({ ...valid, llmTemperature: 2.5 }).success).toBe(false);
    expect(appSettingsUpdateSchema.safeParse({ ...valid, llmTemperature: -0.1 }).success).toBe(false);
  });

  it("accepts the score floor bounds [0, 1]", () => {
    expect(appSettingsUpdateSchema.safeParse({ ...valid, retrievalScoreFloor: 0 }).success).toBe(true);
    expect(appSettingsUpdateSchema.safeParse({ ...valid, retrievalScoreFloor: 1 }).success).toBe(true);
  });

  it("rejects an out-of-range score floor", () => {
    expect(appSettingsUpdateSchema.safeParse({ ...valid, retrievalScoreFloor: 1.5 }).success).toBe(
      false,
    );
    expect(appSettingsUpdateSchema.safeParse({ ...valid, retrievalScoreFloor: -0.01 }).success).toBe(
      false,
    );
  });

  it("rejects an off-allowlist default model", () => {
    expect(
      appSettingsUpdateSchema.safeParse({ ...valid, defaultChatModel: "gpt-4o-pro" }).success,
    ).toBe(false);
  });

  it("requires the beta gate flag to be a boolean", () => {
    expect(appSettingsUpdateSchema.safeParse({ ...valid, betaGateEnabled: false }).success).toBe(
      true,
    );
    expect(appSettingsUpdateSchema.safeParse({ ...valid, betaGateEnabled: "on" }).success).toBe(
      false,
    );
    const withoutFlag: Partial<typeof valid> = { ...valid };
    delete withoutFlag.betaGateEnabled;
    expect(appSettingsUpdateSchema.safeParse(withoutFlag).success).toBe(false);
  });
});
