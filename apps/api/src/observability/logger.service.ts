import { Injectable, type LoggerService } from "@nestjs/common";
import { getRequestContext } from "./request-context";
import { redact } from "./redact";

/** Cloud Logging severities (https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity). */
type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

/** Where a finished log line is written. Swappable in tests; defaults to stdout. */
type LogSink = (line: string) => void;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

function serializeError(err: Error): SerializedError {
  return { name: err.name, message: err.message, stack: err.stack };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

/**
 * Coalesces the trailing args of a log call into structured fields. App code passes
 * a single fields object (`logger.error("x", { orderId })`); the Nest framework passes
 * a trailing context string (`logger.log(msg, "NestFactory")`). Error values — wherever
 * they appear — are expanded to `{ name, message, stack }` so the stack survives JSON.
 */
function normalizeParams(params: unknown[]): Record<string, unknown> {
  if (params.length === 0) {
    return {};
  }
  if (params.length === 1) {
    const only = params[0];
    if (only instanceof Error) {
      return { error: serializeError(only) };
    }
    if (isPlainObject(only)) {
      const mapped: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(only)) {
        mapped[key] = val instanceof Error ? serializeError(val) : val;
      }
      return mapped;
    }
    return { context: only };
  }
  return {
    params: params.map((p) => (p instanceof Error ? serializeError(p) : p)),
  };
}

function stringify(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Structured JSON logger. One JSON object per line on stdout — the format Cloud Run /
 * Cloud Logging ingests natively, picking up `severity` and `logging.googleapis.com/trace`
 * for filtering and trace correlation. Every line is automatically stamped with the active
 * request id + trace (via {@link getRequestContext}) and scrubbed of PII (via {@link redact}).
 *
 * Implements Nest's {@link LoggerService} so `app.useLogger(StructuredLogger)` routes
 * framework logs through the same pipeline; also exposes `info`/`warn`/`error`/`debug`
 * with a structured-fields argument for application code.
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly sink: LogSink;

  constructor(sink?: LogSink) {
    this.sink = sink ?? stdoutSink;
  }

  /** Nest `LoggerService.log` — informational. */
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("INFO", message, optionalParams);
  }

  /** Structured info log for application code. */
  info(message: string, fields?: Record<string, unknown>): void {
    this.emit("INFO", message, fields ? [fields] : []);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("WARNING", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("ERROR", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("DEBUG", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("DEBUG", message, optionalParams);
  }

  private emit(severity: LogSeverity, message: unknown, params: unknown[]): void {
    const entry: Record<string, unknown> = {
      severity,
      message: stringify(message),
      time: new Date().toISOString(),
      ...normalizeParams(params),
    };

    const ctx = getRequestContext();
    if (ctx?.requestId) {
      entry.requestId = ctx.requestId;
    }
    if (ctx?.traceId) {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      entry["logging.googleapis.com/trace"] = project
        ? `projects/${project}/traces/${ctx.traceId}`
        : ctx.traceId;
    }

    this.sink(JSON.stringify(redact(entry)));
  }
}
