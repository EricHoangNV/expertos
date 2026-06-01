import { UsageLogService } from "./usage-log.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "./logger.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "fb-1",
  email: "u@example.com",
  displayName: "U",
  role: "user",
  locale: "en",
};

describe("UsageLogService", () => {
  it("persists a usage row scoped to the acting user", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, {
      featureKey: "chat.answer",
      model: "gpt-x",
      promptTokens: 10,
      completionTokens: 20,
      costMicros: 1234,
      conversationId: "22222222-2222-2222-2222-222222222222",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: USER.tenantId,
        userId: USER.id,
        featureKey: "chat.answer",
        model: "gpt-x",
        promptTokens: 10,
        completionTokens: 20,
        costMicros: 1234,
        conversationId: "22222222-2222-2222-2222-222222222222",
      },
    });
  });

  it("defaults optional fields to null", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, { featureKey: "cache.hit" });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: USER.tenantId,
        userId: USER.id,
        featureKey: "cache.hit",
        model: null,
        promptTokens: null,
        completionTokens: null,
        costMicros: null,
        conversationId: null,
      },
    });
  });

  it("models cost_micros from the token counts when the caller omits it (OD#4 / M6.5)", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, {
      featureKey: "chat.answer",
      model: "echo-dev",
      promptTokens: 1000,
      completionTokens: 1000,
    });

    // echo-dev is the standard tier: 15 micros/prompt-token + 60 micros/completion-token.
    expect(create.mock.calls[0][0].data.costMicros).toBe(1000 * 15 + 1000 * 60);
  });

  it("records a named-model cache hit (0 tokens) at zero modeled cost, not null", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, {
      featureKey: "chat.answer",
      model: "echo-dev",
      promptTokens: 0,
      completionTokens: 0,
    });

    expect(create.mock.calls[0][0].data.costMicros).toBe(0);
  });

  it("models a named model with no token counts at zero cost", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, {
      featureKey: "chat.answer",
      model: "echo-dev",
    });

    expect(create.mock.calls[0][0].data.costMicros).toBe(0);
  });

  it("leaves cost_micros null when no model is named (nothing to price)", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { usageLog: { create } };
    const rls = {
      run: jest.fn((_user: AuthUser, work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as RlsService;
    const logger = { error: jest.fn() } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, {
      featureKey: "cache.hit",
      promptTokens: 50,
    });

    expect(create.mock.calls[0][0].data.costMicros).toBeNull();
  });

  it("swallows and logs write failures (never breaks the request)", async () => {
    const rls = {
      run: jest.fn().mockRejectedValue(new Error("db down")),
    } as unknown as RlsService;
    const error = jest.fn();
    const logger = { error } as unknown as StructuredLogger;

    await expect(
      new UsageLogService(rls, logger).record(USER, { featureKey: "chat.answer" }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe("Failed to record usage log");
    expect((error.mock.calls[0][1] as { error: Error }).error).toBeInstanceOf(Error);
  });

  it("wraps a non-Error rejection before logging", async () => {
    const rls = {
      run: jest.fn().mockRejectedValue("string failure"),
    } as unknown as RlsService;
    const error = jest.fn();
    const logger = { error } as unknown as StructuredLogger;

    await new UsageLogService(rls, logger).record(USER, { featureKey: "x" });

    expect((error.mock.calls[0][1] as { error: Error }).error.message).toBe(
      "string failure",
    );
  });
});
