import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request correlation data, carried implicitly through the async call tree so
 * any code (logger, error reporter, services) can stamp the active request id /
 * trace without threading it through every function signature.
 */
interface RequestContext {
  /** Stable id for this request; echoed back in the `x-request-id` response header. */
  requestId: string;
  /**
   * Cloud Trace id (`logging.googleapis.com/trace` value) when the platform supplied
   * an `X-Cloud-Trace-Context` header — lets a log line link to its distributed trace.
   */
  traceId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (and everything it awaits) with `ctx` as the active request context. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Returns the active request context, or `undefined` outside a request (e.g. bootstrap). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
