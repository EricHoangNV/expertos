import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import { runWithRequestContext } from "./request-context";

/** Minimal request shape we read — avoids a hard dependency on express types. */
interface TracedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/** Minimal response shape we touch. */
interface TracedResponse {
  setHeader(name: string, value: string): void;
}

function header(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Parses the Cloud Run `X-Cloud-Trace-Context` header (`TRACE_ID/SPAN_ID;o=TRACE_TRUE`)
 * down to the bare trace id, so log lines can link to their distributed trace.
 */
export function parseCloudTraceId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const traceId = value.split("/")[0]?.trim();
  return traceId || undefined;
}

/**
 * Establishes the per-request {@link RequestContext} before any handler runs: reuses an
 * inbound `x-request-id` (e.g. from a gateway) or mints one, extracts the Cloud Trace id,
 * echoes the request id back in the response header, and runs the rest of the request
 * inside that async context so the logger/error reporter can stamp it automatically.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: TracedRequest, res: TracedResponse, next: () => void): void {
    const inbound = header(req.headers["x-request-id"]);
    const requestId = inbound && inbound.length > 0 ? inbound : randomUUID();
    const traceId = parseCloudTraceId(header(req.headers["x-cloud-trace-context"]));

    res.setHeader("x-request-id", requestId);
    runWithRequestContext({ requestId, traceId }, () => next());
  }
}
