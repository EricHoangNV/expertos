import type { AppSettingsUpdateInput } from "@expertos/shared";
import type { PrismaClient } from "@expertos/db";
import { SettingsService } from "./settings.service";
import type { RlsService } from "../auth/rls.service";
import type { AdminAuditService } from "../admin/admin-audit.service";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "admin@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

const UPDATED_AT = new Date("2026-06-01T12:00:00.000Z");

function makeTx() {
  return {
    appSettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
}

function makeService(
  tx: ReturnType<typeof makeTx>,
  opts: { embeddingProvider?: string; prismaFindFirst?: jest.Mock } = {},
) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const prismaFindFirst = opts.prismaFindFirst ?? jest.fn();
  const prisma = { appSettings: { findFirst: prismaFindFirst } } as unknown as PrismaClient;
  const service = new SettingsService(prisma, rls, audit, opts.embeddingProvider ?? "hashing");
  return { service, run, record, prismaFindFirst };
}

/** A fully-specified update body (the schema validates ranges/allowlist before this point). */
function input(over: Partial<AppSettingsUpdateInput> = {}): AppSettingsUpdateInput {
  return {
    llmTemperature: 0.2,
    defaultChatModel: "gpt-4o-mini",
    retrievalScoreFloor: 0,
    ...over,
  };
}

/** Mirror back whatever the service writes (`update`/`create`), so the persisted shape is assertable. */
function echoWrite(tx: ReturnType<typeof makeTx>, id: string) {
  const impl = ({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id,
      llmTemperature: data.llmTemperature,
      defaultChatModel: data.defaultChatModel,
      retrievalScoreFloor: data.retrievalScoreFloor,
      updatedAt: UPDATED_AT,
    });
  tx.appSettings.update.mockImplementation(impl);
  tx.appSettings.create.mockImplementation(impl);
}

describe("SettingsService.getSettings", () => {
  it("maps the singleton row to a DTO (stamping embeddingProvider) under the actor's RLS", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue({
      id: "set-1",
      llmTemperature: 0.4,
      defaultChatModel: "gpt-4o",
      retrievalScoreFloor: 0.02,
      updatedAt: UPDATED_AT,
    });
    const { service, run } = makeService(tx, { embeddingProvider: "openai" });

    const result = await service.getSettings(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result).toEqual({
      llmTemperature: 0.4,
      defaultChatModel: "gpt-4o",
      retrievalScoreFloor: 0.02,
      embeddingProvider: "openai",
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it("returns launch defaults (null updatedAt) when the settings row has never been seeded", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const result = await service.getSettings(ADMIN);

    expect(result).toEqual({
      llmTemperature: 0.2,
      defaultChatModel: "gpt-4o-mini",
      retrievalScoreFloor: 0,
      embeddingProvider: "hashing",
      updatedAt: null,
    });
  });

  it("falls back to the default model when a stored value is off the allowlist", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue({
      id: "set-1",
      llmTemperature: 0.3,
      defaultChatModel: "gpt-3.5-legacy",
      retrievalScoreFloor: 0,
      updatedAt: UPDATED_AT,
    });
    const { service } = makeService(tx);

    const result = await service.getSettings(ADMIN);

    expect(result.defaultChatModel).toBe("gpt-4o-mini");
  });
});

describe("SettingsService.updateSettings", () => {
  it("updates the existing singleton row and records an audit entry in the same tx", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue({ id: "set-1" });
    echoWrite(tx, "set-1");
    const { service, record } = makeService(tx);

    const result = await service.updateSettings(
      ADMIN,
      input({ llmTemperature: 0.5, defaultChatModel: "gpt-4o", retrievalScoreFloor: 0.01 }),
    );

    expect(tx.appSettings.update.mock.calls[0][0]).toMatchObject({ where: { id: "set-1" } });
    expect(tx.appSettings.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      llmTemperature: 0.5,
      defaultChatModel: "gpt-4o",
      retrievalScoreFloor: 0.01,
    });
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({
        action: "app_settings.updated",
        targetType: "app_settings",
        targetId: "set-1",
      }),
    );
  });

  it("creates the row when the DB was never seeded (no existing singleton)", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue(null);
    echoWrite(tx, "set-new");
    const { service, record } = makeService(tx);

    const result = await service.updateSettings(ADMIN, input());

    expect(tx.appSettings.create).toHaveBeenCalledTimes(1);
    expect(tx.appSettings.update).not.toHaveBeenCalled();
    expect(result.llmTemperature).toBe(0.2);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("busts the getCached snapshot so the saved value is live on the next read", async () => {
    const tx = makeTx();
    tx.appSettings.findFirst.mockResolvedValue({ id: "set-1" });
    echoWrite(tx, "set-1");
    // The global-client read returns the OLD value, then the NEW value after the save.
    const prismaFindFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "set-1",
        llmTemperature: 0.2,
        defaultChatModel: "gpt-4o-mini",
        retrievalScoreFloor: 0,
        updatedAt: UPDATED_AT,
      })
      .mockResolvedValueOnce({
        id: "set-1",
        llmTemperature: 0.9,
        defaultChatModel: "gpt-4o",
        retrievalScoreFloor: 0.05,
        updatedAt: UPDATED_AT,
      });
    const { service } = makeService(tx, { prismaFindFirst });

    const before = await service.getCached();
    expect(before.llmTemperature).toBe(0.2);

    await service.updateSettings(
      ADMIN,
      input({ llmTemperature: 0.9, defaultChatModel: "gpt-4o", retrievalScoreFloor: 0.05 }),
    );

    const after = await service.getCached();
    expect(after).toEqual({ llmTemperature: 0.9, defaultChatModel: "gpt-4o", retrievalScoreFloor: 0.05 });
    expect(prismaFindFirst).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsService.getCached", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reads the runtime triple from the global client and serves it from cache within the TTL", async () => {
    const tx = makeTx();
    const prismaFindFirst = jest.fn().mockResolvedValue({
      id: "set-1",
      llmTemperature: 0.3,
      defaultChatModel: "gpt-4o",
      retrievalScoreFloor: 0.04,
      updatedAt: UPDATED_AT,
    });
    const { service } = makeService(tx, { prismaFindFirst });

    const first = await service.getCached();
    const second = await service.getCached();

    expect(first).toEqual({ llmTemperature: 0.3, defaultChatModel: "gpt-4o", retrievalScoreFloor: 0.04 });
    expect(second).toBe(first);
    expect(prismaFindFirst).toHaveBeenCalledTimes(1); // second served from cache
  });

  it("re-reads the row once the 30s TTL has elapsed", async () => {
    const tx = makeTx();
    const prismaFindFirst = jest.fn().mockResolvedValue({
      id: "set-1",
      llmTemperature: 0.3,
      defaultChatModel: "gpt-4o",
      retrievalScoreFloor: 0,
      updatedAt: UPDATED_AT,
    });
    const { service } = makeService(tx, { prismaFindFirst });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    await service.getCached();
    nowSpy.mockReturnValue(1_000_000 + 31_000); // past the 30s TTL
    await service.getCached();

    expect(prismaFindFirst).toHaveBeenCalledTimes(2);
  });

  it("serves launch defaults when the settings row has never been seeded", async () => {
    const tx = makeTx();
    const prismaFindFirst = jest.fn().mockResolvedValue(null);
    const { service } = makeService(tx, { prismaFindFirst });

    const result = await service.getCached();

    expect(result).toEqual({ llmTemperature: 0.2, defaultChatModel: "gpt-4o-mini", retrievalScoreFloor: 0 });
  });
});
