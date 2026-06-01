import { EmailService } from "./email.service";
import type { EmailProvider } from "./email-provider";
import type { StructuredLogger } from "../observability/logger.service";

function makeService() {
  const provider = {
    name: "test-provider",
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EmailProvider>;
  const logger = { info: jest.fn(), error: jest.fn() } as unknown as jest.Mocked<StructuredLogger>;
  return { service: new EmailService(provider, logger), provider, logger };
}

describe("EmailService.send", () => {
  it("delegates to the provider and logs the send (driver + subject only)", async () => {
    const { service, provider, logger } = makeService();

    await service.send({ to: "user@example.com", subject: "Hello", text: "Body" });

    expect(provider.send).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
    });
    expect(logger.info).toHaveBeenCalledWith("transactional email sent", {
      provider: "test-provider",
      subject: "Hello",
    });
  });

  it("propagates a provider failure (the caller decides whether it is fatal)", async () => {
    const { service, provider, logger } = makeService();
    provider.send.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      service.send({ to: "user@example.com", subject: "Hi", text: "B" }),
    ).rejects.toThrow("smtp down");
    expect(logger.info).not.toHaveBeenCalled();
  });
});
