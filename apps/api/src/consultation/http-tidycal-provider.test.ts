import { HttpTidyCalProvider, type TidyCalHttpClient } from "./http-tidycal-provider";
import { BookingWebhookVerificationError } from "./tidycal-provider";

function makeProvider(opts: { apiToken?: string; httpClient?: TidyCalHttpClient } = {}) {
  return new HttpTidyCalProvider(opts);
}

describe("HttpTidyCalProvider.verifyWebhook / parseEvent (no native webhooks)", () => {
  const provider = makeProvider();

  it("rejects any inbound webhook delivery (TidyCal posts none — sync is via polling)", async () => {
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("{}"), signature: undefined }),
    ).rejects.toBeInstanceOf(BookingWebhookVerificationError);
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("{}"), signature: "anything" }),
    ).rejects.toThrow(/no native webhooks/i);
  });

  it("parseEvent is a no-op (the driver never receives webhooks)", () => {
    expect(provider.parseEvent({ event: "booking.created", payload: { id: 1 } })).toBeNull();
    expect(provider.parseEvent(null)).toBeNull();
  });
});

describe("HttpTidyCalProvider.listBookings", () => {
  it("returns nothing when no API token is configured (poll disabled)", async () => {
    const provider = makeProvider();
    await expect(provider.listBookings({ since: new Date() })).resolves.toEqual([]);
  });

  it("polls bookings, builds deterministic synthetic event ids, and maps cancellations", async () => {
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: 1, starts_at: "2026-06-10T15:00:00.000Z", contact: { email: "a@b.c" } },
        { id: 2, cancelled_at: "2026-06-09T00:00:00.000Z", contact: { email: "d@e.f" } },
        "garbage-row",
      ],
    });
    const provider = makeProvider({ apiToken: "tok", httpClient: { get } });
    const since = new Date("2026-06-01T00:00:00.000Z");

    const events = await provider.listBookings({ since });

    expect(get).toHaveBeenCalledWith("/bookings", { starts_at: since.toISOString() });
    expect(events).toEqual([
      {
        eventId: "reconcile:1:booking.created",
        eventType: "booking.created",
        bookingRef: "1",
        email: "a@b.c",
        scheduledAt: new Date("2026-06-10T15:00:00.000Z"),
        status: "booked",
      },
      {
        eventId: "reconcile:2:booking.cancelled",
        eventType: "booking.cancelled",
        bookingRef: "2",
        email: "d@e.f",
        scheduledAt: null,
        status: "canceled",
      },
    ]);
  });

  it("falls back to a top-level email when there is no nested contact", async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 3, starts_at: "2026-06-11T09:00:00.000Z", email: "top@level.email" }],
    });
    const provider = makeProvider({ apiToken: "tok", httpClient: { get } });
    const [event] = await provider.listBookings({ since: new Date() });
    expect(event.email).toBe("top@level.email");
  });

  it("tolerates a response with no data array", async () => {
    const get = jest.fn().mockResolvedValue({});
    const provider = makeProvider({ apiToken: "tok", httpClient: { get } });
    await expect(provider.listBookings({ since: new Date() })).resolves.toEqual([]);
  });
});
