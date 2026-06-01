import { HttpEmailProvider, type EmailHttpClient } from "./http-email-provider";

function makeProvider() {
  const http = { post: jest.fn().mockResolvedValue(undefined) } as jest.Mocked<EmailHttpClient>;
  const provider = new HttpEmailProvider({
    apiUrl: "https://mail.example.com/send",
    apiKey: "key-123",
    from: "noreply@expertos.test",
    httpClient: http,
  });
  return { provider, http };
}

describe("HttpEmailProvider.send", () => {
  it("POSTs a Bearer-authed JSON envelope with the configured sender", async () => {
    const { provider, http } = makeProvider();
    expect(provider.name).toBe("http");

    await provider.send({ to: "user@example.com", subject: "Refined", text: "Body" });

    expect(http.post).toHaveBeenCalledWith(
      "https://mail.example.com/send",
      { Authorization: "Bearer key-123", "Content-Type": "application/json" },
      { from: "noreply@expertos.test", to: "user@example.com", subject: "Refined", text: "Body" },
    );
  });

  it("includes the html body only when provided", async () => {
    const { provider, http } = makeProvider();

    await provider.send({ to: "u@x.com", subject: "S", text: "T", html: "<p>T</p>" });

    expect(http.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ html: "<p>T</p>" }),
    );
  });

  it("propagates a transport failure", async () => {
    const { provider, http } = makeProvider();
    http.post.mockRejectedValueOnce(new Error("502"));

    await expect(provider.send({ to: "u@x.com", subject: "S", text: "T" })).rejects.toThrow("502");
  });
});
