import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { VoiceProfileService } from "./voice-profile.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type {
  VoiceProfileCreateInput,
  VoiceProfileListQueryInput,
} from "@expertos/shared";

const EXPERT_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROFILE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EXPERT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TENANT = "00000000-0000-0000-0000-000000000000";

const OWNER: AuthUser = {
  id: EXPERT_UID,
  tenantId: TENANT,
  firebaseUid: "fb-owner",
  email: "owner@expertos.local",
  displayName: "Owner",
  role: "expert",
  locale: "en",
};
const OTHER_EXPERT: AuthUser = { ...OWNER, id: "dddddddd-dddd-dddd-dddd-dddddddddddd", firebaseUid: "fb-other" };
const ADMIN: AuthUser = { ...OWNER, id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", firebaseUid: "fb-admin", role: "admin" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    expertId: EXPERT_ID,
    language: "en",
    name: "Direct & practical",
    description: null,
    guidelines: "Be direct.",
    status: "draft",
    approvedBy: null,
    approvedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    expert: { displayName: "Dr. Lan", userId: EXPERT_UID },
    ...overrides,
  };
}

interface Tx {
  expert: { findUnique: jest.Mock };
  voiceProfile: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
}

function makeHarness() {
  const tx: Tx = {
    expert: { findUnique: jest.fn().mockResolvedValue({ userId: EXPERT_UID }) },
    voiceProfile: {
      create: jest.fn().mockResolvedValue(row()),
      update: jest.fn().mockResolvedValue(row()),
      findUnique: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([row()]),
    },
  };
  const run = jest.fn((_user: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  const service = new VoiceProfileService(rls, logger);
  return { service, tx, run, info };
}

const CREATE: VoiceProfileCreateInput = {
  expertId: EXPERT_ID,
  language: "en",
  name: "Direct & practical",
};

describe("VoiceProfileService.create", () => {
  it("authors a draft for an expert the actor owns and maps it to a summary", async () => {
    const h = makeHarness();
    const result = await h.service.create(OWNER, { ...CREATE, guidelines: "Be direct." });

    expect(h.tx.voiceProfile.create).toHaveBeenCalledTimes(1);
    const data = h.tx.voiceProfile.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: TENANT,
      expertId: EXPERT_ID,
      language: "en",
      status: "draft",
      description: null,
      guidelines: "Be direct.",
    });
    expect(result).toMatchObject({ id: PROFILE_ID, expertName: "Dr. Lan", status: "draft", language: "en" });
    expect(h.info).toHaveBeenCalledWith("voice profile created", expect.objectContaining({ profileId: PROFILE_ID }));
  });

  it("lets an admin author a profile for an unlinked expert", async () => {
    const h = makeHarness();
    h.tx.expert.findUnique.mockResolvedValue({ userId: null });
    await expect(h.service.create(ADMIN, CREATE)).resolves.toBeDefined();
    expect(h.tx.voiceProfile.create).toHaveBeenCalled();
  });

  it("rejects authoring for an expert the actor does not own", async () => {
    const h = makeHarness();
    await expect(h.service.create(OTHER_EXPERT, CREATE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.tx.voiceProfile.create).not.toHaveBeenCalled();
  });

  it("404s when the expert does not exist", async () => {
    const h = makeHarness();
    h.tx.expert.findUnique.mockResolvedValue(null);
    await expect(h.service.create(OWNER, CREATE)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("VoiceProfileService.update", () => {
  it("edits a draft and clears description/guidelines on empty string", async () => {
    const h = makeHarness();
    await h.service.update(OWNER, PROFILE_ID, { name: "New", description: "", guidelines: "" });

    const data = h.tx.voiceProfile.update.mock.calls[0][0].data;
    expect(data).toEqual({ name: "New", description: null, guidelines: null });
  });

  it("only sets provided fields and keeps non-empty text", async () => {
    const h = makeHarness();
    await h.service.update(OWNER, PROFILE_ID, { description: "A practical voice.", guidelines: "Tighter." });
    expect(h.tx.voiceProfile.update.mock.calls[0][0].data).toEqual({
      description: "A practical voice.",
      guidelines: "Tighter.",
    });
  });

  it("409s when the profile is not a draft", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "published" }));
    await expect(h.service.update(OWNER, PROFILE_ID, { name: "x" })).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.voiceProfile.update).not.toHaveBeenCalled();
  });

  it("404s when the profile does not exist", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(null);
    await expect(h.service.update(OWNER, PROFILE_ID, { name: "x" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("403s when a non-owner expert edits the profile", async () => {
    const h = makeHarness();
    await expect(h.service.update(OTHER_EXPERT, PROFILE_ID, { name: "x" })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("VoiceProfileService transitions", () => {
  it("submit: draft → expert_review", async () => {
    const h = makeHarness();
    await h.service.submit(OWNER, PROFILE_ID);
    expect(h.tx.voiceProfile.update.mock.calls[0][0].data).toEqual({ status: "expert_review" });
    expect(h.info).toHaveBeenCalledWith("voice profile submitted for review", expect.objectContaining({ status: "expert_review" }));
  });

  it("submit: 409 when not a draft", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "expert_review" }));
    await expect(h.service.submit(OWNER, PROFILE_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("approve: expert_review → published and stamps the sign-off", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "expert_review" }));
    await h.service.approve(OWNER, PROFILE_ID);
    const data = h.tx.voiceProfile.update.mock.calls[0][0].data;
    expect(data.status).toBe("published");
    expect(data.approvedBy).toBe(OWNER.id);
    expect(data.approvedAt).toBeInstanceOf(Date);
  });

  it("approve: 409 when not in review (message names the action)", async () => {
    const h = makeHarness();
    await expect(h.service.approve(OWNER, PROFILE_ID)).rejects.toThrow(/approve a draft profile/);
  });

  it("an admin can sign off on someone else's profile", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "expert_review", expert: { displayName: "Dr. Lan", userId: EXPERT_UID } }));
    await expect(h.service.approve(ADMIN, PROFILE_ID)).resolves.toMatchObject({ id: PROFILE_ID });
  });

  it("requestChanges: expert_review → draft", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "expert_review" }));
    await h.service.requestChanges(OWNER, PROFILE_ID);
    expect(h.tx.voiceProfile.update.mock.calls[0][0].data).toEqual({ status: "draft" });
  });

  it("requestChanges: 409 when not in review", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(row({ status: "published" }));
    await expect(h.service.requestChanges(OWNER, PROFILE_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s a transition on a missing profile", async () => {
    const h = makeHarness();
    h.tx.voiceProfile.findUnique.mockResolvedValue(null);
    await expect(h.service.submit(OWNER, PROFILE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("VoiceProfileService.list", () => {
  const QUERY: VoiceProfileListQueryInput = { limit: 50 };

  it("restricts an expert to their own profiles and maps the rows", async () => {
    const h = makeHarness();
    const result = await h.service.list(OWNER, { ...QUERY, status: "expert_review", expertId: EXPERT_ID, language: "vi" });

    const args = h.tx.voiceProfile.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: "expert_review",
      expertId: EXPERT_ID,
      language: "vi",
      expert: { userId: OWNER.id },
    });
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: PROFILE_ID, expertName: "Dr. Lan" });
    expect(h.info).toHaveBeenCalledWith("voice profile list completed", expect.objectContaining({ status: "expert_review", count: 1 }));
  });

  it("lets an admin see every profile in the tenant (no ownership filter)", async () => {
    const h = makeHarness();
    await h.service.list(ADMIN, QUERY);
    expect(h.tx.voiceProfile.findMany.mock.calls[0][0].where).toEqual({});
    expect(h.info).toHaveBeenCalledWith("voice profile list completed", expect.objectContaining({ status: "any" }));
  });
});
