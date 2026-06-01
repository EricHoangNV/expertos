import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { StructuredLogger } from "./logger.service";
import { getRequestContext } from "./request-context";
import { reportException } from "./sentry";

/** Minimal response shape we touch — avoids a hard dependency on express types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

interface ErrorBody {
  statusCode: number;
  message: unknown;
  /** Echoed so users can quote it in support and we can grep logs/Sentry for it. */
  requestId?: string;
  /** Extra fields from a structured HttpException response (e.g. the 402 entitlement payload). */
  [key: string]: unknown;
}

/**
 * Catch-all exception filter — the single place every unhandled error funnels through.
 *
 * - `HttpException` (4xx/5xx the app threw deliberately) → its own status + message; a structured
 *   object response (e.g. the 402 entitlement payload) is echoed verbatim alongside the normalized
 *   `statusCode`/`message`/`requestId`, since the app deliberately authored that body.
 * - Anything else → 500 with a generic message (never leak internals / stack to clients).
 * - 5xx and unexpected errors are logged at ERROR severity and reported to Sentry; expected
 *   4xx are logged at WARNING and not reported (they're not bugs).
 *
 * The active request id is attached to the response body and every log/Sentry event so a
 * client-reported failure can be traced end to end.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<JsonResponse>();
    const requestId = getRequestContext()?.requestId;

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = isHttp ? exception.getResponse() : undefined;
    const message = isHttp
      ? extractHttpMessage(exception)
      : "Internal server error";

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      reportException(exception);
      this.logger.error("Unhandled request error", { status, error: toError(exception) });
    } else {
      this.logger.warn("Request rejected", { status, message });
    }

    // Echo a deliberately-authored object response (e.g. the 402 entitlement payload) verbatim, then
    // overwrite the normalized fields so status/message/requestId always win. A string response or a
    // non-HttpException (generic 500) contributes nothing — internals are never leaked.
    const extra =
      typeof response === "object" && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const body: ErrorBody = { ...extra, statusCode: status, message };
    if (requestId) {
      body.requestId = requestId;
    }
    res.status(status).json(body);
  }
}

/** Pulls the client-facing message out of an HttpException's response payload. */
function extractHttpMessage(exception: HttpException): unknown {
  const response = exception.getResponse();
  if (typeof response === "string") {
    return response;
  }
  if (typeof response === "object" && response !== null && "message" in response) {
    return (response as { message: unknown }).message;
  }
  return exception.message;
}

function toError(exception: unknown): Error {
  return exception instanceof Error ? exception : new Error(String(exception));
}
