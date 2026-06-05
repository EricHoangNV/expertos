"use client";

// THROWAWAY preview route for screenshotting the chat header + Tweaks panel in
// isolation (no auth / backend). Safe to delete.
import { useState } from "react";
import {
  ChatTopbar,
  ChatTweaksToggle,
  ChatUserIdentity,
  ChatVoicePicker,
  DEFAULT_DENSITY,
  DEFAULT_LAYOUT_DIRECTION,
  type Density,
  type LayoutDirection,
  type Locale,
  TweaksDensityControl,
  TweaksLanguageControl,
  TweaksLayoutControl,
  TweaksPanel,
} from "@expertos/ui";

export default function TweaksPreviewPage() {
  const [tweaksOpen, setTweaksOpen] = useState(true);
  const [locale, setLocale] = useState<Locale>("en");
  const [direction, setDirection] = useState<LayoutDirection>(DEFAULT_LAYOUT_DIRECTION);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [verified, setVerified] = useState(true);
  const [concierge, setConcierge] = useState(true);

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <ChatTopbar title="New conversation" titleEditable={false}>
        <ChatVoicePicker
          options={[{ id: "1", name: "Ngô Công Trường" }]}
          activeId="1"
          onSelect={() => {}}
          label="Voice"
        />
        <ChatUserIdentity name="Hoang Nguyen" email="hoang@example.com" />
        <ChatTweaksToggle
          open={tweaksOpen}
          onToggle={() => setTweaksOpen((o) => !o)}
          showLabel="Show tweaks"
          hideLabel="Hide tweaks"
        />
      </ChatTopbar>

      {tweaksOpen && (
        <TweaksPanel onClose={() => setTweaksOpen(false)} heading="Tweaks">
          <TweaksLanguageControl value={locale} onChange={setLocale} label="Answer language" />
          <TweaksLayoutControl value={direction} onChange={setDirection} />
          <TweaksDensityControl
            density={density}
            onDensityChange={setDensity}
            verifiedBadge={verified}
            onVerifiedBadgeChange={setVerified}
            conciergeOffer={concierge}
            onConciergeOfferChange={setConcierge}
          />
        </TweaksPanel>
      )}
    </div>
  );
}
