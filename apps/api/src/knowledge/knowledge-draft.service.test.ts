import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { KnowledgeDraftService } from "./knowledge-draft.service";
import { EmptyDocumentError, type IngestionService } from "../ingestion/ingestion.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";

const TENANT = "00000000-0000-0000-0000-000000000000";
const DRAFT_ID = "11111111-1111-1111-1111-111111111111";
const CONV_ID = "22222222-2222-2222-2222-222222222222";

const ACTOR: AuthUser = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tenantId: TENANT,
  firebaseUid: "fb-actor",
  email: "expert@expertos.local",
  displayName: "Reviewer",
  role: "expert",
  locale: "en",
};

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    title: "Pricing FAQ",
    content: "The standard plan is $20/mo.",
    language: "en",
    status: "draft",
    conversationId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

interface Tx {
  knowledgeDraft: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  conversation: { findUnique: jest.Mock };
  document: { findFirst: jest.Mock };
}

function makeHarness() {
  const tx: Tx = {
    knowledgeDraft: {
      create: jest.fn().mockResolvedValue(draftRow()),
      findMany: jest.fn().mockResolvedValue([draftRow()]),
      findUnique: jest.fn().mockResolvedValue(draftRow()),
      update: jest.fn().mockResolvedValue(draftRow()),
    },
    conversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV_ID }) },
    document: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const run = jest.fn((_user: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const ingest = jest.fn().mockResolvedValue({ documentId: "doc", documentVersionId: "v" });
  const ingestion = { ingest } as unknown as IngestionService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  const service = new KnowledgeDraftService(rls, ingestion, logger);
  return { service, tx, ingest, info };
}

describe("KnowledgeDraftService.create", () => {
  it("captures a draft tied to a visible source conversation", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.create.mockResolvedValue(draftRow({ conversationId: CONV_ID }));

    const dto = await h.service.create(ACTOR, {
      title: "Pricing FAQ",
      content: "The standard plan is $20/mo.",
      conversationId: CONV_ID,
      language: "en",
    });

    expect(h.tx.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: CONV_ID },
      select: { id: true },
    });
    expect(h.tx.knowledgeDraft.create.mock.calls[0][0].data).toMatchObject({
      tenantId: TENANT,
      conversationId: CONV_ID,
      status: "draft",
    });
    expect(dto.conversationId).toBe(CONV_ID);
    expect(dto.content).toBe("The standard plan is $20/mo.");
  });

  it("404s when the source conversation is invisible/foreign", async () => {
    const h = makeHarness();
    h.tx.conversation.findUnique.mockResolvedValue(null);

    await expect(
      h.service.create(ACTOR, {
        title: "x",
        content: "y",
        conversationId: CONV_ID,
        language: "en",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.knowledgeDraft.create).not.toHaveBeenCalled();
  });

  it("skips the conversation lookup when no conversationId is given", async () => {
    const h = makeHarness();
    await h.service.create(ACTOR, { title: "x", content: "y", language: "en" });
    expect(h.tx.conversation.findUnique).not.toHaveBeenCalled();
    expect(h.tx.knowledgeDraft.create.mock.calls[0][0].data.conversationId).toBeNull();
  });
});

describe("KnowledgeDraftService.list", () => {
  it("applies the status filter and maps content-free summaries", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findMany.mockResolvedValue([
      { ...draftRow({ status: "expert_review" }), content: undefined },
    ]);

    const result = await h.service.list(ACTOR, { status: "expert_review", limit: 50 });

    expect(h.tx.knowledgeDraft.findMany.mock.calls[0][0].where).toEqual({
      status: "expert_review",
    });
    expect(result[0]).not.toHaveProperty("content");
    expect(result[0].status).toBe("expert_review");
  });

  it("uses an empty where when no status filter is given", async () => {
    const h = makeHarness();
    await h.service.list(ACTOR, { limit: 50 });
    expect(h.tx.knowledgeDraft.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe("KnowledgeDraftService.get", () => {
  it("returns the full draft with content", async () => {
    const h = makeHarness();
    const dto = await h.service.get(ACTOR, DRAFT_ID);
    expect(dto.content).toBe("The standard plan is $20/mo.");
  });

  it("404s when the draft is missing", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(null);
    await expect(h.service.get(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("KnowledgeDraftService.update", () => {
  it("applies a partial patch while the draft is still draft", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.update.mockResolvedValue(draftRow({ title: "New title" }));

    await h.service.update(ACTOR, DRAFT_ID, { title: "New title" });

    expect(h.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ title: "New title" });
  });

  it("409s when editing a non-draft", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "expert_review" }));
    await expect(
      h.service.update(ACTOR, DRAFT_ID, { content: "z" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.knowledgeDraft.update).not.toHaveBeenCalled();
  });
});

describe("KnowledgeDraftService transitions", () => {
  it("submit moves draft → expert_review", async () => {
    const h = makeHarness();
    await h.service.submit(ACTOR, DRAFT_ID);
    expect(h.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ status: "expert_review" });
  });

  it("submit rejects a non-draft", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "published" }));
    await expect(h.service.submit(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("requestChanges moves expert_review → draft", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "expert_review" }));
    await h.service.requestChanges(ACTOR, DRAFT_ID);
    expect(h.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ status: "draft" });
  });

  it("requestChanges rejects a draft (not under review)", async () => {
    const h = makeHarness();
    await expect(h.service.requestChanges(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("reject discards from draft or expert_review but not published", async () => {
    const fromDraft = makeHarness();
    await fromDraft.service.reject(ACTOR, DRAFT_ID);
    expect(fromDraft.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ status: "rejected" });

    const fromReview = makeHarness();
    fromReview.tx.knowledgeDraft.findUnique.mockResolvedValue(
      draftRow({ status: "expert_review" }),
    );
    await fromReview.service.reject(ACTOR, DRAFT_ID);
    expect(fromReview.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({
      status: "rejected",
    });

    const published = makeHarness();
    published.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "published" }));
    await expect(published.service.reject(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("KnowledgeDraftService.publish", () => {
  it("ingests the draft (publish:true) and marks it published", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(
      draftRow({ status: "expert_review", language: "vi", content: "Nội dung" }),
    );
    h.tx.knowledgeDraft.update.mockResolvedValue(
      draftRow({ status: "published", language: "vi" }),
    );

    const dto = await h.service.publish(ACTOR, DRAFT_ID);

    expect(h.tx.document.findFirst).toHaveBeenCalled();
    const [, input, content, options] = h.ingest.mock.calls[0];
    expect(input).toMatchObject({
      sourceUri: `draft://${DRAFT_ID}`,
      contentType: "text/plain",
      scope: "global_expert",
      language: "vi",
    });
    expect(content).toBe("Nội dung");
    expect(options).toEqual({ publish: true });
    expect(h.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ status: "published" });
    expect(dto.status).toBe("published");
  });

  it("is idempotent: skips re-ingestion when the draft's document already exists", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "expert_review" }));
    h.tx.document.findFirst.mockResolvedValue({ id: "existing-doc" });

    await h.service.publish(ACTOR, DRAFT_ID);

    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.tx.knowledgeDraft.update.mock.calls[0][0].data).toEqual({ status: "published" });
  });

  it("409s when the draft is not under review", async () => {
    const h = makeHarness();
    await expect(h.service.publish(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("maps an empty-document ingest failure to 400 and leaves the draft unpublished", async () => {
    const h = makeHarness();
    h.tx.knowledgeDraft.findUnique.mockResolvedValue(draftRow({ status: "expert_review" }));
    h.ingest.mockRejectedValue(new EmptyDocumentError("draft://x"));

    await expect(h.service.publish(ACTOR, DRAFT_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.knowledgeDraft.update).not.toHaveBeenCalled();
  });
});
