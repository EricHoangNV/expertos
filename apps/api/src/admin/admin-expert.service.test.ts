import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@expertos/db";
import { AdminExpertService } from "./admin-expert.service";
import type { AdminAuditService } from "./admin-audit.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
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

const EXPERT_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";

function makeTx() {
  return {
    expert: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  return { service: new AdminExpertService(rls, audit, logger), run, record, info };
}

/** A full `DETAIL_SELECT`-shaped row. */
function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPERT_ID,
    slug: "dr-lan",
    displayName: "Dr. Lan",
    title: "Cardiologist",
    bio: "Bio text",
    active: true,
    userId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    user: { email: "lan@x.io" },
    _count: { voiceProfiles: 2, documents: 5 },
    ...overrides,
  };
}

describe("AdminExpertService.list", () => {
  it("maps experts newest-first with the voice-profile count, no filters", async () => {
    const tx = makeTx();
    const created = new Date("2026-01-01T00:00:00.000Z");
    tx.expert.findMany.mockResolvedValue([
      {
        id: EXPERT_ID,
        slug: "dr-lan",
        displayName: "Dr. Lan",
        title: "Cardiologist",
        active: true,
        createdAt: created,
        _count: { voiceProfiles: 2 },
      },
      {
        id: "e2",
        slug: "mr-binh",
        displayName: "Mr. Binh",
        title: null,
        active: false,
        createdAt: created,
        _count: { voiceProfiles: 0 },
      },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(tx.expert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 50, skip: 0, orderBy: { createdAt: "desc" } }),
    );
    expect(result).toEqual([
      {
        id: EXPERT_ID,
        slug: "dr-lan",
        displayName: "Dr. Lan",
        title: "Cardiologist",
        active: true,
        voiceProfileCount: 2,
        createdAt: created.toISOString(),
      },
      {
        id: "e2",
        slug: "mr-binh",
        displayName: "Mr. Binh",
        title: null,
        active: false,
        voiceProfileCount: 0,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("builds an active + case-insensitive slug/name search filter", async () => {
    const tx = makeTx();
    tx.expert.findMany.mockResolvedValue([]);
    const { service } = makeService(tx);

    await service.list(ADMIN, { limit: 25, offset: 5, active: false, search: "lan" });

    expect(tx.expert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: false,
          OR: [
            { slug: { contains: "lan", mode: "insensitive" } },
            { displayName: { contains: "lan", mode: "insensitive" } },
          ],
        },
        take: 25,
        skip: 5,
      }),
    );
  });

  it("omits the active predicate when the filter is not supplied", async () => {
    const tx = makeTx();
    tx.expert.findMany.mockResolvedValue([]);
    const { service } = makeService(tx);

    await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(tx.expert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("AdminExpertService.get", () => {
  it("maps a full detail (operator email + content counts)", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(detailRow());
    const { service } = makeService(tx);

    const result = await service.get(ADMIN, EXPERT_ID);

    expect(result).toEqual({
      id: EXPERT_ID,
      slug: "dr-lan",
      displayName: "Dr. Lan",
      title: "Cardiologist",
      bio: "Bio text",
      active: true,
      userId: USER_ID,
      linkedUserEmail: "lan@x.io",
      voiceProfileCount: 2,
      documentCount: 5,
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
    });
  });

  it("maps a null operator link to a null email", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(detailRow({ userId: null, user: null }));
    const { service } = makeService(tx);

    const result = await service.get(ADMIN, EXPERT_ID);

    expect(result.userId).toBeNull();
    expect(result.linkedUserEmail).toBeNull();
  });

  it("throws 404 when the expert does not exist", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.get(ADMIN, EXPERT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminExpertService.create", () => {
  it("creates an expert in the actor's tenant and audits it", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue({ id: USER_ID });
    tx.expert.create.mockResolvedValue(detailRow());
    const { service, record } = makeService(tx);

    const result = await service.create(ADMIN, {
      slug: "dr-lan",
      displayName: "Dr. Lan",
      title: "Cardiologist",
      bio: "Bio text",
      userId: USER_ID,
    });

    expect(tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
    expect(tx.expert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId: ADMIN.tenantId,
          slug: "dr-lan",
          displayName: "Dr. Lan",
          title: "Cardiologist",
          bio: "Bio text",
          userId: USER_ID,
        },
      }),
    );
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({ action: "expert.created", targetType: "expert", targetId: EXPERT_ID }),
    );
    expect(result.slug).toBe("dr-lan");
  });

  it("creates an unlinked expert without a user lookup, nulling optional fields", async () => {
    const tx = makeTx();
    tx.expert.create.mockResolvedValue(detailRow({ userId: null, user: null, title: null, bio: null }));
    const { service } = makeService(tx);

    await service.create(ADMIN, { slug: "dr-lan", displayName: "Dr. Lan" });

    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.expert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: null, bio: null, userId: null }),
      }),
    );
  });

  it("throws 404 when the operator account to link does not exist", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service, record } = makeService(tx);

    await expect(
      service.create(ADMIN, { slug: "dr-lan", displayName: "Dr. Lan", userId: USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expert.create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("maps a unique-constraint (P2002) violation to a 409", async () => {
    const tx = makeTx();
    tx.expert.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }),
    );
    const { service, record } = makeService(tx);

    await expect(
      service.create(ADMIN, { slug: "dr-lan", displayName: "Dr. Lan" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(record).not.toHaveBeenCalled();
  });

  it("rethrows a non-unique create error unchanged", async () => {
    const tx = makeTx();
    tx.expert.create.mockRejectedValue(new Error("boom"));
    const { service } = makeService(tx);

    await expect(service.create(ADMIN, { slug: "dr-lan", displayName: "Dr. Lan" })).rejects.toThrow(
      "boom",
    );
  });
});

describe("AdminExpertService.update", () => {
  it("patches free-text fields, clearing on empty string, and audits the changed fields", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.expert.update.mockResolvedValue(detailRow({ title: null }));
    const { service, record } = makeService(tx);

    await service.update(ADMIN, EXPERT_ID, { displayName: "Dr. Lan Pham", title: "", bio: "New bio" });

    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXPERT_ID },
        data: { displayName: "Dr. Lan Pham", title: null, bio: "New bio" },
      }),
    );
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({
        action: "expert.updated",
        metadata: { fields: ["displayName", "title", "bio"] },
      }),
    );
  });

  it("keeps a non-empty title and clears bio on an empty string", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.expert.update.mockResolvedValue(detailRow({ bio: null }));
    const { service } = makeService(tx);

    await service.update(ADMIN, EXPERT_ID, { title: "Surgeon", bio: "" });

    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: "Surgeon", bio: null } }),
    );
  });

  it("disconnects the operator on a null userId and connects on a uuid", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.expert.update.mockResolvedValue(detailRow());
    const { service } = makeService(tx);

    await service.update(ADMIN, EXPERT_ID, { userId: null });
    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { user: { disconnect: true } } }),
    );

    tx.user.findUnique.mockResolvedValue({ id: USER_ID });
    await service.update(ADMIN, EXPERT_ID, { userId: USER_ID });
    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { user: { connect: { id: USER_ID } } } }),
    );
  });

  it("throws 404 when the expert does not exist", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.update(ADMIN, EXPERT_ID, { displayName: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expert.update).not.toHaveBeenCalled();
  });

  it("throws 404 when the operator account to link does not exist", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.update(ADMIN, EXPERT_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expert.update).not.toHaveBeenCalled();
  });

  it("maps a unique-constraint (P2002) violation to a 409", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.user.findUnique.mockResolvedValue({ id: USER_ID });
    tx.expert.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }),
    );
    const { service, record } = makeService(tx);

    await expect(
      service.update(ADMIN, EXPERT_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("AdminExpertService.setActive", () => {
  it("deactivates an expert and audits it as expert.deactivated", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ active: true });
    tx.expert.update.mockResolvedValue(detailRow({ active: false }));
    const { service, record } = makeService(tx);

    const result = await service.setActive(ADMIN, EXPERT_ID, { active: false });

    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERT_ID }, data: { active: false } }),
    );
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({ action: "expert.deactivated", targetId: EXPERT_ID }),
    );
    expect(result.active).toBe(false);
  });

  it("activates an expert and audits it as expert.activated", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ active: false });
    tx.expert.update.mockResolvedValue(detailRow({ active: true }));
    const { service, record } = makeService(tx);

    await service.setActive(ADMIN, EXPERT_ID, { active: true });

    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({ action: "expert.activated" }),
    );
  });

  it("throws 404 when the expert does not exist", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.setActive(ADMIN, EXPERT_ID, { active: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expert.update).not.toHaveBeenCalled();
  });
});

describe("AdminExpertService calendar (M16)", () => {
  const prevKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = prevKey;
  });

  it("getCalendar maps the row to a DTO without the ciphertext", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({
      tidycalApiTokenEnc: "iv:tag:ct",
      tidycalApiTokenLast4: "1234",
      tidycalLink: "https://tidycal.com/e",
    });
    const { service } = makeService(tx);

    expect(await service.getCalendar(ADMIN, EXPERT_ID)).toEqual({
      apiTokenConfigured: true,
      apiTokenLast4: "1234",
      tidycalLink: "https://tidycal.com/e",
    });
  });

  it("getCalendar 404s a missing expert", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);
    await expect(service.getCalendar(ADMIN, EXPERT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updateCalendar encrypts the token, audits field names only (never the value)", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue({ id: EXPERT_ID });
    tx.expert.update.mockResolvedValue({
      tidycalApiTokenEnc: "iv:tag:ct",
      tidycalApiTokenLast4: "9876",
      tidycalLink: null,
    });
    const { service, record } = makeService(tx);

    await service.updateCalendar(ADMIN, EXPERT_ID, { apiToken: "secret_tok_9876" });

    const updateArg = tx.expert.update.mock.calls[0][0];
    expect(updateArg.data.tidycalApiTokenEnc).not.toContain("secret_tok_9876");
    expect(updateArg.data.tidycalApiTokenLast4).toBe("9876");
    const auditArg = record.mock.calls[0][2];
    expect(auditArg).toMatchObject({ action: "expert.calendar_updated", targetId: EXPERT_ID });
    expect(JSON.stringify(auditArg.metadata)).not.toContain("secret_tok_9876");
  });

  it("updateCalendar 404s a missing expert (no write, no audit)", async () => {
    const tx = makeTx();
    tx.expert.findUnique.mockResolvedValue(null);
    const { service, record } = makeService(tx);
    await expect(
      service.updateCalendar(ADMIN, EXPERT_ID, { apiToken: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expert.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
