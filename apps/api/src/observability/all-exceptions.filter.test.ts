import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { StructuredLogger } from "./logger.service";
import { runWithRequestContext } from "./request-context";
import { reportException } from "./sentry";

jest.mock("./sentry", () => ({ reportException: jest.fn() }));
const reportMock = reportException as jest.Mock;

interface CapturedResponse {
  statusCode?: number;
  body?: unknown;
}

function fakeHost(captured: CapturedResponse): ArgumentsHost {
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return body;
    },
  };
  return {
    switchToHttp: () => ({ getResponse: <T>() => res as T }),
  } as unknown as ArgumentsHost;
}

function makeFilter(): { filter: AllExceptionsFilter; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = new StructuredLogger((line) =>
    lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  return { filter: new AllExceptionsFilter(logger), lines };
}

describe("AllExceptionsFilter", () => {
  beforeEach(() => reportMock.mockClear());

  it("maps a 4xx HttpException to its status + message, logged at WARNING, not reported", () => {
    const { filter, lines } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(new BadRequestException("bad input"), fakeHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toMatchObject({ statusCode: 400, message: "bad input" });
    expect(lines[0].severity).toBe("WARNING");
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("maps an unknown error to a generic 500, logged at ERROR, reported to Sentry", () => {
    const { filter, lines } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(new Error("secret internal detail"), fakeHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toMatchObject({
      statusCode: 500,
      message: "Internal server error",
    });
    expect(lines[0].severity).toBe("ERROR");
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("reports a 5xx HttpException too", () => {
    const { filter } = makeFilter();
    filter.catch(new InternalServerErrorException("db"), fakeHost({}));
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the active request id to the response body", () => {
    const { filter } = makeFilter();
    const captured: CapturedResponse = {};
    runWithRequestContext({ requestId: "req-42" }, () =>
      filter.catch(new BadRequestException("x"), fakeHost(captured)),
    );
    expect((captured.body as { requestId: string }).requestId).toBe("req-42");
  });

  it("omits requestId when there is no request context", () => {
    const { filter } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(new BadRequestException("x"), fakeHost(captured));
    expect((captured.body as { requestId?: string }).requestId).toBeUndefined();
  });

  it("extracts a string HttpException response as the message", () => {
    const { filter } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(new HttpException("raw string", HttpStatus.FORBIDDEN), fakeHost(captured));
    expect((captured.body as { message: unknown }).message).toBe("raw string");
  });

  it("falls back to exception.message when the response object has no message field", () => {
    const { filter } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(
      new HttpException({ error: "no-message-key" }, HttpStatus.CONFLICT),
      fakeHost(captured),
    );
    expect((captured.body as { message: unknown }).message).toBeDefined();
  });

  it("echoes a structured HttpException object response (e.g. the 402 entitlement payload)", () => {
    const { filter } = makeFilter();
    const captured: CapturedResponse = {};
    filter.catch(
      new HttpException(
        {
          reason: "quota_exceeded",
          feature: "ask_question",
          currentPlan: "free",
          upgradeOptions: [{ key: "plus", name: "Plus" }],
          remainingQuota: 0,
        },
        HttpStatus.PAYMENT_REQUIRED,
      ),
      fakeHost(captured),
    );
    expect(captured.statusCode).toBe(402);
    expect(captured.body).toMatchObject({
      statusCode: 402,
      reason: "quota_exceeded",
      feature: "ask_question",
      currentPlan: "free",
      upgradeOptions: [{ key: "plus", name: "Plus" }],
      remainingQuota: 0,
    });
  });
});
