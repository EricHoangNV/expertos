import {
  flushSentry,
  initSentry,
  isSentryEnabled,
  reportException,
  resetSentryForTests,
} from "./sentry";
import { runWithRequestContext } from "./request-context";
import * as Sentry from "@sentry/node";

jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

const mocked = Sentry as jest.Mocked<typeof Sentry>;

describe("sentry", () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSentryForTests();
    delete process.env.SENTRY_DSN;
  });

  afterAll(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
  });

  it("stays disabled with no DSN — every entry point is a no-op", async () => {
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    reportException(new Error("x"));
    await flushSentry();
    expect(mocked.init).not.toHaveBeenCalled();
    expect(mocked.captureException).not.toHaveBeenCalled();
    expect(mocked.flush).not.toHaveBeenCalled();
  });

  it("initializes when a DSN is present and is idempotent", () => {
    process.env.SENTRY_DSN = "https://k@o.ingest.sentry.io/1";
    expect(initSentry()).toBe(true);
    expect(initSentry()).toBe(true);
    expect(mocked.init).toHaveBeenCalledTimes(1);
    expect(isSentryEnabled()).toBe(true);
  });

  it("reports exceptions tagged with the active request id and trace", () => {
    process.env.SENTRY_DSN = "https://k@o.ingest.sentry.io/1";
    initSentry();
    const err = new Error("boom");
    runWithRequestContext({ requestId: "req-7", traceId: "tr-7" }, () =>
      reportException(err),
    );

    expect(mocked.captureException).toHaveBeenCalledWith(err, {
      tags: { requestId: "req-7", traceId: "tr-7" },
    });
  });

  it("reports without tags/contexts outside a request", () => {
    process.env.SENTRY_DSN = "https://k@o.ingest.sentry.io/1";
    initSentry();
    reportException(new Error("nope"));

    expect(mocked.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: undefined,
    });
  });

  it("flushes buffered events when enabled", async () => {
    process.env.SENTRY_DSN = "https://k@o.ingest.sentry.io/1";
    initSentry();
    await flushSentry(500);
    expect(mocked.flush).toHaveBeenCalledWith(500);
  });
});
