import type { PrismaClient } from "@expertos/db";
import { ConciergeDeliveryService, type DeliveryInput } from "./concierge-delivery.service";
import type { EmailService } from "../email/email.service";
import type { StructuredLogger } from "../observability/logger.service";

const TENANT_ID = "20000000-0000-0000-0000-000000000001";

const REQUEST = {
  messageId: "msg-original",
  user: { email: "asker@example.com", displayName: "Asker" },
  message: { conversationId: "conv-1" },
};

const EDITED: DeliveryInput = {
  reviewRequestId: "rr-1",
  responseId: "resp-1",
  tenantId: TENANT_ID,
  revisedAnswer: "A refined, expert-reviewed answer.",
  edited: true,
};

function makeTx() {
  return {
    humanReviewRequest: { findUnique: jest.fn().mockResolvedValue(REQUEST) },
    message: { create: jest.fn().mockResolvedValue({ id: "msg-refined" }) },
    conversation: { update: jest.fn().mockResolvedValue({ id: "conv-1" }) },
    reviewResponse: { update: jest.fn().mockResolvedValue({ id: "resp-1" }) },
    // applyRlsContext issues `SET LOCAL` via $executeRawUnsafe inside the elevated transaction.
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  const email = { send: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<EmailService>;
  const logger = { info: jest.fn(), error: jest.fn() } as unknown as jest.Mocked<StructuredLogger>;
  return { service: new ConciergeDeliveryService(prisma, email, logger), tx, email, logger };
}

describe("ConciergeDeliveryService.deliver", () => {
  it("pushes the refined answer into the conversation, marks delivered, and emails the user", async () => {
    const tx = makeTx();
    const { service, email, logger } = makeService(tx);

    await service.deliver(EDITED);

    expect(tx.message.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        conversationId: "conv-1",
        role: "assistant",
        content: "A refined, expert-reviewed answer.",
        refinedFromMessageId: "msg-original",
      },
    });
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(tx.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: "resp-1" },
      data: { deliveredToUser: true },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "asker@example.com",
        subject: "Your answer was reviewed and refined",
      }),
    );
    // The email greets by display name and deep-links the conversation + carries the OD#5 disclosure.
    const sent = email.send.mock.calls[0][0];
    expect(sent.text).toContain("Hi Asker,");
    expect(sent.text).toContain("/history?c=conv-1");
    expect(sent.text).toContain("AI-reviewed/edited content");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to a generic greeting when the user has no display name", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findUnique.mockResolvedValue({
      ...REQUEST,
      user: { email: "asker@example.com", displayName: null },
    });
    const { service, email } = makeService(tx);

    await service.deliver(EDITED);

    expect(email.send.mock.calls[0][0].text).toContain("Hi,");
  });

  it("stays silent for a verdict-only (unedited) response — no push, no email", async () => {
    const tx = makeTx();
    const { service, email } = makeService(tx);

    await service.deliver({ ...EDITED, edited: false });

    expect(tx.message.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it("stays silent when there is no revised answer even if flagged edited", async () => {
    const tx = makeTx();
    const { service, email } = makeService(tx);

    await service.deliver({ ...EDITED, revisedAnswer: null });

    expect(tx.message.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it("no-ops (no email) when the review request has vanished", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findUnique.mockResolvedValue(null);
    const { service, email } = makeService(tx);

    await service.deliver(EDITED);

    expect(tx.message.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it("still delivers in-conversation when the email send fails (email is best-effort)", async () => {
    const tx = makeTx();
    const { service, email, logger } = makeService(tx);
    email.send.mockRejectedValueOnce(new Error("mail bounced"));

    await service.deliver(EDITED);

    expect(tx.message.create).toHaveBeenCalled();
    expect(tx.reviewResponse.update).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "concierge delivery email failed",
      expect.objectContaining({ reviewRequestId: "rr-1", message: "mail bounced" }),
    );
  });

  it("stringifies a non-Error thrown by the email send", async () => {
    const tx = makeTx();
    const { service, email, logger } = makeService(tx);
    email.send.mockRejectedValueOnce("mail-string-error");

    await service.deliver(EDITED);

    expect(logger.error).toHaveBeenCalledWith(
      "concierge delivery email failed",
      expect.objectContaining({ message: "mail-string-error" }),
    );
  });

  it("swallows a delivery-write failure (non-fatal — never rolls back the verdict)", async () => {
    const tx = makeTx();
    tx.message.create.mockRejectedValueOnce(new Error("db write failed"));
    const { service, email, logger } = makeService(tx);

    await expect(service.deliver(EDITED)).resolves.toBeUndefined();

    expect(email.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "concierge delivery failed",
      expect.objectContaining({ reviewRequestId: "rr-1", message: "db write failed" }),
    );
  });

  it("stringifies a non-Error thrown by the delivery write", async () => {
    const tx = makeTx();
    tx.message.create.mockRejectedValueOnce("boom");
    const { service, logger } = makeService(tx);

    await service.deliver(EDITED);

    expect(logger.error).toHaveBeenCalledWith(
      "concierge delivery failed",
      expect.objectContaining({ message: "boom" }),
    );
  });
});
