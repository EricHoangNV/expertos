import {
  RequestContextMiddleware,
  parseCloudTraceId,
} from "./request-context.middleware";
import { getRequestContext } from "./request-context";

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
}

function fakeRes(): { setHeader: jest.Mock; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
}

describe("parseCloudTraceId", () => {
  it("extracts the trace id from a Cloud Trace context header", () => {
    expect(parseCloudTraceId("abc123/456;o=1")).toBe("abc123");
  });

  it("returns undefined for missing/empty input", () => {
    expect(parseCloudTraceId(undefined)).toBeUndefined();
    expect(parseCloudTraceId("")).toBeUndefined();
  });
});

describe("RequestContextMiddleware", () => {
  const mw = new RequestContextMiddleware();

  it("mints a request id and runs next() inside the context", () => {
    const res = fakeRes();
    let seen: ReturnType<typeof getRequestContext>;
    mw.use({ headers: {} } as FakeReq, res, () => {
      seen = getRequestContext();
    });

    expect(seen?.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers["x-request-id"]).toBe(seen?.requestId);
  });

  it("reuses an inbound x-request-id", () => {
    const res = fakeRes();
    let seen: ReturnType<typeof getRequestContext>;
    mw.use({ headers: { "x-request-id": "inbound-1" } } as FakeReq, res, () => {
      seen = getRequestContext();
    });

    expect(seen?.requestId).toBe("inbound-1");
    expect(res.headers["x-request-id"]).toBe("inbound-1");
  });

  it("captures the Cloud Trace id", () => {
    const res = fakeRes();
    let seen: ReturnType<typeof getRequestContext>;
    mw.use(
      { headers: { "x-cloud-trace-context": "trace-9/1;o=1" } } as FakeReq,
      res,
      () => {
        seen = getRequestContext();
      },
    );

    expect(seen?.traceId).toBe("trace-9");
  });

  it("takes the first value when a header arrives as an array", () => {
    const res = fakeRes();
    let seen: ReturnType<typeof getRequestContext>;
    mw.use(
      { headers: { "x-request-id": ["first", "second"] } } as FakeReq,
      res,
      () => {
        seen = getRequestContext();
      },
    );

    expect(seen?.requestId).toBe("first");
  });
});
