import { StructuredLogger } from "./logger.service";
import { runWithRequestContext } from "./request-context";

function capture(): { lines: Record<string, unknown>[]; sink: (line: string) => void } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  };
}

describe("StructuredLogger", () => {
  it("emits one JSON line with severity, message, and ISO timestamp", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).log("hello");

    expect(lines).toHaveLength(1);
    expect(lines[0].severity).toBe("INFO");
    expect(lines[0].message).toBe("hello");
    expect(typeof lines[0].time).toBe("string");
    expect(Number.isNaN(Date.parse(lines[0].time as string))).toBe(false);
  });

  it("maps each level to its Cloud Logging severity", () => {
    const { lines, sink } = capture();
    const logger = new StructuredLogger(sink);
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");
    logger.verbose("v");

    expect(lines.map((l) => l.severity)).toEqual([
      "INFO",
      "WARNING",
      "ERROR",
      "DEBUG",
      "DEBUG",
    ]);
  });

  it("merges a single fields object into the entry", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).info("paid", { orderId: "o1", amount: 5 });

    expect(lines[0]).toMatchObject({ message: "paid", orderId: "o1", amount: 5 });
  });

  it("expands an Error argument into name/message/stack", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).error("boom", new Error("kaboom"));

    expect(lines[0].error).toMatchObject({ name: "Error", message: "kaboom" });
    expect(typeof (lines[0].error as { stack: string }).stack).toBe("string");
  });

  it("expands Error values nested inside a fields object", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).error("failed", { cause: new Error("root") });

    expect(lines[0].cause).toMatchObject({ name: "Error", message: "root" });
  });

  it("records a trailing primitive (Nest context string) under `context`", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).log("bootstrapping", "NestFactory");

    expect(lines[0].context).toBe("NestFactory");
  });

  it("records multiple trailing args under `params`, serializing Errors", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).log("multi", "a", new Error("x"));

    const params = lines[0].params as unknown[];
    expect(params[0]).toBe("a");
    expect(params[1]).toMatchObject({ name: "Error", message: "x" });
  });

  it("stringifies a non-string, non-Error message via JSON", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).info("ignored", undefined);
    // object message
    new StructuredLogger(sink).log({ a: 1 });

    expect(lines[1].message).toBe(JSON.stringify({ a: 1 }));
  });

  it("uses the Error message when the message itself is an Error", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).error(new Error("as-message"));

    expect(lines[0].message).toBe("as-message");
  });

  it("falls back to String() when a message cannot be JSON-stringified", () => {
    const { lines, sink } = capture();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    new StructuredLogger(sink).log(circular);

    expect(lines[0].message).toBe("[object Object]");
  });

  it("redacts sensitive fields", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).info("login", { email: "a@b.com", token: "xyz" });

    expect(lines[0].email).toBe("[redacted]");
    expect(lines[0].token).toBe("[redacted]");
  });

  it("stamps the active request id and trace", () => {
    const { lines, sink } = capture();
    const logger = new StructuredLogger(sink);
    runWithRequestContext({ requestId: "req-1", traceId: "trace-1" }, () => {
      logger.info("scoped");
    });

    expect(lines[0].requestId).toBe("req-1");
    expect(lines[0]["logging.googleapis.com/trace"]).toBe("trace-1");
  });

  it("formats the trace as a Cloud resource path when GOOGLE_CLOUD_PROJECT is set", () => {
    const original = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = "my-proj";
    try {
      const { lines, sink } = capture();
      const logger = new StructuredLogger(sink);
      runWithRequestContext({ requestId: "r", traceId: "t" }, () => logger.info("x"));
      expect(lines[0]["logging.googleapis.com/trace"]).toBe(
        "projects/my-proj/traces/t",
      );
    } finally {
      if (original === undefined) {
        delete process.env.GOOGLE_CLOUD_PROJECT;
      } else {
        process.env.GOOGLE_CLOUD_PROJECT = original;
      }
    }
  });

  it("omits request id / trace outside a request context", () => {
    const { lines, sink } = capture();
    new StructuredLogger(sink).info("no-ctx");

    expect(lines[0].requestId).toBeUndefined();
    expect(lines[0]["logging.googleapis.com/trace"]).toBeUndefined();
  });

  it("defaults to a stdout sink when none is provided", () => {
    const spy = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      new StructuredLogger().info("to-stdout");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('"message":"to-stdout"');
      expect(spy.mock.calls[0][0]).toMatch(/\n$/);
    } finally {
      spy.mockRestore();
    }
  });
});
