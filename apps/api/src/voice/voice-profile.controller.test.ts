import { VoiceProfileController } from "./voice-profile.controller";
import type { VoiceProfileService } from "./voice-profile.service";
import type { AuthUser } from "../auth/auth.types";
import type { VoiceProfileSummary } from "./voice.types";

const USER: AuthUser = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "fb",
  email: "e@expertos.local",
  displayName: "E",
  role: "expert",
  locale: "en",
};
const ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SUMMARY = { id: ID } as VoiceProfileSummary;

function makeController() {
  const service = {
    list: jest.fn().mockResolvedValue([SUMMARY]),
    create: jest.fn().mockResolvedValue(SUMMARY),
    update: jest.fn().mockResolvedValue(SUMMARY),
    submit: jest.fn().mockResolvedValue(SUMMARY),
    approve: jest.fn().mockResolvedValue(SUMMARY),
    requestChanges: jest.fn().mockResolvedValue(SUMMARY),
  } as unknown as VoiceProfileService;
  return { controller: new VoiceProfileController(service), service };
}

describe("VoiceProfileController", () => {
  it("list delegates the parsed query", async () => {
    const { controller, service } = makeController();
    await controller.list(USER, { limit: 50 });
    expect(service.list).toHaveBeenCalledWith(USER, { limit: 50 });
  });

  it("create delegates the parsed body", async () => {
    const { controller, service } = makeController();
    const body = { expertId: ID, language: "en" as const, name: "Voice" };
    await controller.create(USER, body);
    expect(service.create).toHaveBeenCalledWith(USER, body);
  });

  it("update delegates the id and patch", async () => {
    const { controller, service } = makeController();
    await controller.update(USER, ID, { name: "New" });
    expect(service.update).toHaveBeenCalledWith(USER, ID, { name: "New" });
  });

  it("submit / approve / request-changes delegate to the workflow methods", async () => {
    const { controller, service } = makeController();
    await controller.submit(USER, ID);
    await controller.approve(USER, ID);
    await controller.requestChanges(USER, ID);
    expect(service.submit).toHaveBeenCalledWith(USER, ID);
    expect(service.approve).toHaveBeenCalledWith(USER, ID);
    expect(service.requestChanges).toHaveBeenCalledWith(USER, ID);
  });
});
