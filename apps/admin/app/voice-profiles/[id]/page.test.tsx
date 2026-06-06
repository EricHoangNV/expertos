// Voice-profile sign-off detail tests (M19.2.6, screenshot 09). Covers the design-parity head row
// (amber reputation warning with a ⚠ glyph, the Approve/Request-changes sign-off actions, the
// `.avatar-lg` identity + status badges) rendered against the real `VoiceProfileDetailDto`. Renders
// through the M15.2.1 provider harness so the admin-session role resolution runs.
import {
  renderWithProviders,
  screen,
  setMockParams,
  mockApi,
} from "../../../test/render";
import type { VoiceProfileDetailDto } from "../../../src/lib/admin-client";
import VoiceProfileDetailPage from "./page";

const PROFILE_ID = "vp_1";

function profile(over: Partial<VoiceProfileDetailDto> = {}): VoiceProfileDetailDto {
  return {
    id: PROFILE_ID,
    expertId: "exp_1",
    expertName: "Ngô Công Trường",
    language: "en",
    name: "Direct & numbers-first",
    description: "The flagship voice.",
    guidelines: "Lead with the verdict.",
    status: "expert_review",
    approvedBy: null,
    approvedAt: null,
    updatedAt: "2026-06-01T00:00:00.000Z",
    exampleCount: 0,
    examples: [],
    ...over,
  };
}

beforeEach(() => {
  setMockParams({ id: PROFILE_ID });
});

describe("voice-profile detail head (M19.2.6)", () => {
  it("renders the amber reputation warning with a glyph and the sign-off actions", async () => {
    mockApi("GET", `/voice-profiles/${PROFILE_ID}`, { body: profile() });
    renderWithProviders(<VoiceProfileDetailPage />, { role: "expert" });

    // The reputation warning sits inside the warm amber `.msg-notice tone-amber` callout.
    const warning = await screen.findByText("Voice shapes tone — never facts");
    const notice = warning.closest(".msg-notice");
    expect(notice).not.toBeNull();
    expect(notice).toHaveClass("tone-amber");

    // expert_review status surfaces both sign-off actions + the awaiting badge.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting your sign-off")).toBeInTheDocument();

    // The large identity avatar renders.
    expect(document.querySelector(".avatar.avatar-lg")).not.toBeNull();
  });
});
