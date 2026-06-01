import { ExpertsController } from "./experts.controller";
import type { VoiceService } from "./voice.service";
import type { AuthUser } from "../auth/auth.types";
import type { ExpertListQueryInput } from "@expertos/shared";
import type { ExpertVoiceMeta } from "./voice.types";

const USER = { id: "u1" } as AuthUser;

describe("ExpertsController", () => {
  it("delegates the picker list to VoiceService.listExperts", async () => {
    const experts: ExpertVoiceMeta[] = [
      { expertId: "ex-1", displayName: "Dr. A", languages: ["en"], hasActiveProfile: true },
    ];
    const listExperts = jest.fn().mockResolvedValue(experts);
    const controller = new ExpertsController({ listExperts } as unknown as VoiceService);
    const query: ExpertListQueryInput = { limit: 20 };

    await expect(controller.list(USER, query)).resolves.toBe(experts);
    expect(listExperts).toHaveBeenCalledWith(USER, query);
  });
});
