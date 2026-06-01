import { ChatController } from "./chat.controller";
import type { ChatService } from "./chat.service";
import type { EntitlementDecision } from "../entitlements/entitlement.service";
import type { AuthUser } from "../auth/auth.types";
import type { ChatRequestInput, ChatStreamEvent } from "@expertos/shared";

const ALLOW: EntitlementDecision = { outcome: "allow" };

const USER = { id: "u1" } as AuthUser;
const BODY: ChatRequestInput = { text: "q", language: "en", topK: 8 };

describe("ChatController", () => {
  it("sets SSE headers, writes each event as a data frame, and ends the response", async () => {
    const events: ChatStreamEvent[] = [
      { type: "delta", text: "Hi" },
      {
        type: "done",
        conversationId: "c1",
        messageId: "m1",
        citations: [],
        insufficientKnowledge: false,
      },
    ];
    const answerStream = jest.fn(async function* () {
      yield* events;
    });
    const controller = new ChatController({ answerStream } as unknown as ChatService);

    const headers: Record<string, string> = {};
    const writes: string[] = [];
    let ended = false;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      write: (chunk: string) => {
        writes.push(chunk);
      },
      end: () => {
        ended = true;
      },
    };

    await controller.stream(USER, BODY, ALLOW, res);

    expect(answerStream).toHaveBeenCalledWith(USER, BODY, { degraded: false });
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(writes).toEqual([
      `data: ${JSON.stringify(events[0])}\n\n`,
      `data: ${JSON.stringify(events[1])}\n\n`,
    ]);
    expect(ended).toBe(true);
  });

  it("passes the fair-use degrade decision through to the service (M6.3)", async () => {
    const answerStream = jest.fn(async function* () {
      // no events needed for this assertion
    });
    const controller = new ChatController({ answerStream } as unknown as ChatService);
    const res = { setHeader: () => {}, write: () => {}, end: () => {} };

    await controller.stream(USER, BODY, { outcome: "degraded", feature: "ask_question" }, res);

    expect(answerStream).toHaveBeenCalledWith(USER, BODY, { degraded: true });
  });
});
