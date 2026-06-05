import { randomBytes } from "node:crypto";
import { TidyCalProviderFactory } from "./tidycal-provider.factory";
import { encryptWithKey } from "../common/secret-crypto";
import type { StructuredLogger } from "../observability/logger.service";

const KEY = randomBytes(32);

function makeFactory() {
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
  return { factory: new TidyCalProviderFactory(logger), logger };
}

describe("TidyCalProviderFactory", () => {
  const prevKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const prevToken = process.env.TIDYCAL_API_TOKEN;

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY.toString("base64");
    delete process.env.TIDYCAL_API_TOKEN;
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = prevKey;
    if (prevToken === undefined) delete process.env.TIDYCAL_API_TOKEN;
    else process.env.TIDYCAL_API_TOKEN = prevToken;
  });

  describe("forExpert", () => {
    it("builds the real TidyCal driver from a decrypted per-expert token", () => {
      const { factory } = makeFactory();
      const enc = encryptWithKey("expert-token", KEY);
      const provider = factory.forExpert({ id: "exp_1", tidycalApiTokenEnc: enc });
      expect(provider.name).toBe("tidycal");
    });

    it("falls through to offline when the expert has no token (and no env token)", () => {
      const { factory } = makeFactory();
      const provider = factory.forExpert({ id: "exp_1", tidycalApiTokenEnc: null });
      expect(provider.name).toBe("offline");
    });

    it("falls back to the env-global token when the expert has none", () => {
      process.env.TIDYCAL_API_TOKEN = "env-token";
      const { factory } = makeFactory();
      const provider = factory.forExpert({ id: "exp_1", tidycalApiTokenEnc: null });
      expect(provider.name).toBe("tidycal");
    });

    it("logs and falls back when the stored token cannot be decrypted (no key leak)", () => {
      const { factory, logger } = makeFactory();
      const provider = factory.forExpert({ id: "exp_1", tidycalApiTokenEnc: "corrupt:payload:here" });
      expect(provider.name).toBe("offline");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ expertId: "exp_1" }),
      );
      // the log payload must not carry the ciphertext or any plaintext
      const [, meta] = (logger.warn as jest.Mock).mock.calls[0];
      expect(JSON.stringify(meta)).not.toContain("corrupt:payload:here");
    });

    it("treats a null expert as the default", () => {
      const { factory } = makeFactory();
      expect(factory.forExpert(null).name).toBe("offline");
    });
  });

  describe("default", () => {
    it("uses the env-global token when set", () => {
      process.env.TIDYCAL_API_TOKEN = "env-token";
      const { factory } = makeFactory();
      expect(factory.default().name).toBe("tidycal");
    });

    it("uses the offline provider when no env token is set", () => {
      const { factory } = makeFactory();
      expect(factory.default().name).toBe("offline");
    });
  });
});
