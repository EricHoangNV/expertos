import { randomBytes } from "node:crypto";
import {
  buildCalendarUpdate,
  toCalendarSettingsDto,
  type CalendarRow,
} from "./calendar-settings.util";
import { decryptWithKey, loadKey } from "../common/secret-crypto";

describe("calendar-settings.util", () => {
  const prev = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const KEY = randomBytes(32);
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY.toString("base64");
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = prev;
  });

  describe("toCalendarSettingsDto", () => {
    it("reports configured + last4 + link, never the ciphertext", () => {
      const row: CalendarRow = {
        tidycalApiTokenEnc: "iv:tag:ct",
        tidycalApiTokenLast4: "1234",
        tidycalLink: "https://tidycal.com/expert",
      };
      expect(toCalendarSettingsDto(row)).toEqual({
        apiTokenConfigured: true,
        apiTokenLast4: "1234",
        tidycalLink: "https://tidycal.com/expert",
      });
    });

    it("reports unconfigured when no token is stored", () => {
      const row: CalendarRow = { tidycalApiTokenEnc: null, tidycalApiTokenLast4: null, tidycalLink: null };
      expect(toCalendarSettingsDto(row)).toEqual({
        apiTokenConfigured: false,
        apiTokenLast4: null,
        tidycalLink: null,
      });
    });
  });

  describe("buildCalendarUpdate", () => {
    it("encrypts a new token (recoverable) and records last4 without storing plaintext", () => {
      const { data, changedFields } = buildCalendarUpdate({ apiToken: "tidycal_secret_9876" });
      expect(changedFields).toEqual(["apiToken"]);
      expect(typeof data.tidycalApiTokenEnc).toBe("string");
      expect(data.tidycalApiTokenEnc).not.toContain("tidycal_secret_9876");
      expect(data.tidycalApiTokenLast4).toBe("9876");
      expect(decryptWithKey(data.tidycalApiTokenEnc as string, loadKey())).toBe("tidycal_secret_9876");
    });

    it("clears the token (and last4) on null", () => {
      const { data, changedFields } = buildCalendarUpdate({ apiToken: null });
      expect(changedFields).toEqual(["apiToken"]);
      expect(data.tidycalApiTokenEnc).toBeNull();
      expect(data.tidycalApiTokenLast4).toBeNull();
    });

    it("sets the booking link", () => {
      const { data, changedFields } = buildCalendarUpdate({ tidycalLink: "https://tidycal.com/x" });
      expect(changedFields).toEqual(["tidycalLink"]);
      expect(data.tidycalLink).toBe("https://tidycal.com/x");
    });

    it("clears the booking link on empty string or null", () => {
      expect(buildCalendarUpdate({ tidycalLink: "" }).data.tidycalLink).toBeNull();
      expect(buildCalendarUpdate({ tidycalLink: null }).data.tidycalLink).toBeNull();
    });

    it("leaves omitted fields untouched", () => {
      const { data, changedFields } = buildCalendarUpdate({});
      expect(changedFields).toEqual([]);
      expect(data).toEqual({});
    });

    it("updates token + link together", () => {
      const { changedFields } = buildCalendarUpdate({
        apiToken: "tok12345",
        tidycalLink: "https://tidycal.com/y",
      });
      expect(changedFields).toEqual(["apiToken", "tidycalLink"]);
    });
  });
});
