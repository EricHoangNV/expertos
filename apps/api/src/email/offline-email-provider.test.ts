import { OfflineEmailProvider } from "./offline-email-provider";

describe("OfflineEmailProvider", () => {
  it("records the last message instead of sending over the network", async () => {
    const provider = new OfflineEmailProvider();
    expect(provider.name).toBe("offline");
    expect(provider.lastMessage).toBeNull();

    const message = { to: "u@example.com", subject: "S", text: "T", html: "<p>T</p>" };
    await provider.send(message);

    expect(provider.lastMessage).toEqual(message);
  });
});
