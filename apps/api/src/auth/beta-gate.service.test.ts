import type { PrismaClient } from "@expertos/db";
import { BetaGateService } from "./beta-gate.service";

function makeFakePrisma(row: { betaGateEnabled: boolean } | null): {
  prisma: PrismaClient;
  findFirst: jest.Mock;
} {
  const findFirst = jest.fn().mockResolvedValue(row);
  const prisma = { appSettings: { findFirst } } as unknown as PrismaClient;
  return { prisma, findFirst };
}

describe("BetaGateService.isEnabled", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("reads the flag from the app_settings singleton", async () => {
    const { prisma } = makeFakePrisma({ betaGateEnabled: false });
    await expect(new BetaGateService(prisma).isEnabled()).resolves.toBe(false);
  });

  it("defaults to enabled (gate closed) when the row is unseeded", async () => {
    const { prisma } = makeFakePrisma(null);
    await expect(new BetaGateService(prisma).isEnabled()).resolves.toBe(true);
  });

  it("serves repeat reads from the cache within the TTL", async () => {
    const { prisma, findFirst } = makeFakePrisma({ betaGateEnabled: true });
    const gate = new BetaGateService(prisma);

    await gate.isEnabled();
    await gate.isEnabled();

    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the 30s TTL expires", async () => {
    jest.useFakeTimers();
    const { prisma, findFirst } = makeFakePrisma({ betaGateEnabled: true });
    const gate = new BetaGateService(prisma);

    await gate.isEnabled();
    jest.advanceTimersByTime(30_001);
    await gate.isEnabled();

    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("bust() drops the snapshot so the next read hits the DB", async () => {
    const { prisma, findFirst } = makeFakePrisma({ betaGateEnabled: true });
    const gate = new BetaGateService(prisma);

    await gate.isEnabled();
    findFirst.mockResolvedValue({ betaGateEnabled: false });
    gate.bust();

    await expect(gate.isEnabled()).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
