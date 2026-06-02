// Manual `fetch` mock for the admin jest harness (M15.2.1). Mirrors `apps/web/test/api-mock.ts`.
//
// The admin client (`admin-client`, `profile-client`) calls `fetch(`${API_URL}${path}`, opts)`.
// Tests register canned responses keyed by `"<METHOD> <pathname>"`; unmatched calls resolve to 404
// (so best-effort effects like the locale-profile seed stay quiet) and are recorded for assertions.

export interface MockApiResponse {
  status?: number;
  /** JSON body returned from `res.json()` (and serialized for `res.text()`). */
  body?: unknown;
  /**
   * Server-Sent-Events frames for a streaming endpoint (the `POST /chat` turn). Each entry is
   * serialized to a `data: <json>\n\n` frame and exposed as `res.body` (a `ReadableStream`), so the
   * `streamChat` SSE parser drives `onEvent` exactly as it does against the live API. Mutually
   * exclusive with `body` in practice (a streaming response has no JSON body).
   */
  sse?: unknown[];
}

export interface MockApiRequest {
  method: string;
  /** Full URL passed to `fetch`. */
  url: string;
  pathname: string;
  /** Parsed JSON request body, when present. */
  body: unknown;
  headers: Record<string, string>;
}

export type MockApiHandler = (
  req: MockApiRequest,
) => MockApiResponse | Promise<MockApiResponse>;

const handlers = new Map<string, MockApiHandler>();
const calls: MockApiRequest[] = [];

const key = (method: string, pathname: string): string =>
  `${method.toUpperCase()} ${pathname}`;

/** Register a canned response (or dynamic handler) for `METHOD pathname`. */
export function mockApi(
  method: string,
  pathname: string,
  response: MockApiResponse | MockApiHandler,
): void {
  const handler: MockApiHandler =
    typeof response === "function" ? response : () => response;
  handlers.set(key(method, pathname), handler);
}

/** Every fetch the code-under-test made, in order (for call/argument assertions). */
export function apiCalls(): readonly MockApiRequest[] {
  return calls;
}

/** Whether a handler is already registered for `METHOD pathname`. */
export function hasApiMock(method: string, pathname: string): boolean {
  return handlers.has(key(method, pathname));
}

/** Clear registered handlers + recorded calls (called from `jest.setup`). */
export function resetApiMocks(): void {
  handlers.clear();
  calls.length = 0;
}

function toHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function parseBody(init?: RequestInit): unknown {
  const raw = init?.body;
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Build a `ReadableStream` of UTF-8 `data: <json>\n\n` SSE frames from a list of events. */
function sseStream(events: readonly unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = events.map((ev) => encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
}

/** Install the mock as `global.fetch`. Idempotent; pair with `resetApiMocks`. */
export function installFetchMock(): void {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const pathname = new URL(url, "http://localhost:3001").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const req: MockApiRequest = {
      method,
      url,
      pathname,
      body: parseBody(init),
      headers: toHeaders(init),
    };
    calls.push(req);

    const handler = handlers.get(key(method, pathname));
    const result: MockApiResponse = handler
      ? await handler(req)
      : { status: 404, body: { error: "not_mocked", method, pathname } };
    const status = result.status ?? 200;
    const jsonBody = result.body ?? null;
    // A streaming endpoint exposes its frames as `res.body` (a ReadableStream of `data:` SSE
    // chunks); a plain endpoint leaves `body` null and serves JSON via `json()`/`text()`.
    const stream = result.sse ? sseStream(result.sse) : null;
    return {
      ok: status >= 200 && status < 300,
      status,
      body: stream,
      json: async () => jsonBody,
      text: async () => (jsonBody == null ? "" : JSON.stringify(jsonBody)),
    } as unknown as Response;
  }) as typeof fetch;
}
