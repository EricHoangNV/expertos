"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ChatAnswerActions,
  ChatAssistantMessage,
  ChatConsultationCard,
  ChatConversationList,
  type ChatConversationItem,
  ChatInputBar,
  ChatInputHelper,
  ChatLayout,
  ChatSearch,
  type ChatSearchResultItem,
  ChatSidebar,
  ChatStateNotice,
  ChatTopbar,
  ChatUploadPopover,
  ChatUsageMeter,
  ChatUserIdentity,
  type ChatLanguage,
  ChatUserMessage,
  ChatVoicePicker,
  DEFAULT_DENSITY,
  DEFAULT_LAYOUT_DIRECTION,
  type Density,
  Field,
  Input,
  isDensity,
  isLayoutDirection,
  type LayoutDirection,
  layoutPanes,
  Select,
  SourceCard,
  SourcesDrawer,
  SourcesRail,
  SourcesRailHeader,
  TweaksDensityControl,
  TweaksLayoutControl,
  TweaksPanel,
} from "@expertos/ui";
import type {
  ChatCitationDto,
  ConsultationRecommendationDto,
  ConversationSummaryDto,
  EntitlementsDto,
  UploadedFileDto,
  UploadMode,
} from "@expertos/shared";
import { HIGH_STAKES_DISCLAIMER } from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { AnswerView } from "../../src/components/answer-view";
import {
  fetchExperts,
  respondToRecommendation,
  streamChat,
  submitFeedback,
  type ExpertVoice,
} from "../../src/lib/chat-client";
import {
  createSavedAnswer,
  getConversation,
  listConversations,
  renameConversation,
  searchConversations,
} from "../../src/lib/history-client";
import { fetchEntitlements } from "../../src/lib/account-client";
import { uploadFile, UPLOAD_ACCEPT } from "../../src/lib/upload-client";
import { useMediaQuery } from "../../src/lib/use-media-query";

/** localStorage key for the persisted chat layout direction (M12.7.2). */
const LAYOUT_DIRECTION_STORAGE_KEY = "expertos:chat-layout-direction";
/** localStorage key for the persisted display density (M12.7.3). */
const DENSITY_STORAGE_KEY = "expertos:chat-density";
/** localStorage key for the "Verified trust badge" toggle (M12.7.3). */
const VERIFIED_BADGE_STORAGE_KEY = "expertos:show-verified-badge";
/** localStorage key for the "Concierge review offer" toggle (M12.7.3). */
const CONCIERGE_OFFER_STORAGE_KEY = "expertos:show-concierge-offer";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationDto[];
  /** False while the assistant message is still streaming. */
  done: boolean;
  /** Persisted message id (assistant turns, set on the `done` frame) — the feedback target (M3.4). */
  messageId?: string;
  /** Display name when the answer is rendered in an expert's voice. */
  expertName?: string;
  /** True when no grounding sources were retrieved (M3.4) — surface a graceful next step. */
  insufficientKnowledge?: boolean;
  /** True when the answer was served by the cheaper fair-use model (M6.3) — a subtle note. */
  degraded?: boolean;
  /** In-chat consultation recommendation (M7.2), present only when a funnel rule fired. */
  recommendation?: ConsultationRecommendationDto | null;
  /** True when the answer touched a high-stakes topic (NT.4) — show the legal disclaimer. */
  highStakes?: boolean;
}

/**
 * The high-stakes disclaimer (NT.4, PRD §"Non-Technical Requirements"): a non-dismissible legal
 * notice shown under any answer the detector flagged (financial / legal / medical / tax). The copy
 * is single-sourced in `@expertos/shared` so it can never drift from the system-prompt rule that
 * scoped the answer to educational context; the actionable "book a consultation" CTA arrives
 * separately as the M7 {@link ConsultationPrompt} (the topic trigger fires on high-stakes too).
 */
function HighStakesNotice() {
  return (
    <ChatStateNotice tone="amber" label="Important">
      {HIGH_STAKES_DISCLAIMER}
    </ChatStateNotice>
  );
}

/**
 * The mono source-provenance label under the assistant header (M12.4.2) — derived from the kinds of
 * the resolved citations so the user sees what grounded the answer. Returns undefined when there are
 * no citations yet (mid-stream or insufficient knowledge), so the label only appears once grounded.
 */
function answerSourceLabel(citations: ChatCitationDto[]): string | undefined {
  if (citations.length === 0) return undefined;
  const hasKnowledge = citations.some((c) => c.kind === "knowledge");
  const hasUpload = citations.some((c) => c.kind === "upload");
  if (hasKnowledge && hasUpload) return "grounded in published knowledge + your upload";
  if (hasUpload) return "grounded in your upload";
  return "grounded in published knowledge";
}

/**
 * The bold title for a source card (M12.5.3): an upload shows its file name (the part of the
 * `sourceLabel` before the ` · ` location separator), a knowledge citation shows a generic label
 * (the `document_version_id` is the provenance line, not the title).
 */
function sourceCardTitle(citation: ChatCitationDto): string {
  if (citation.kind === "upload") {
    const label = citation.sourceLabel ?? "Uploaded file";
    const [file] = label.split(" · ");
    return file || label;
  }
  return "Published knowledge";
}

/**
 * The mono provenance line for a source card (M12.5.3): an upload shows its location (the part of
 * the `sourceLabel` after the ` · ` separator, e.g. the sheet/cell range), a knowledge citation
 * shows its `document_version_id` so the passage is traceable.
 */
function sourceCardProvenance(citation: ChatCitationDto): string | undefined {
  if (citation.kind === "upload") {
    const label = citation.sourceLabel;
    if (!label) return undefined;
    const sep = label.indexOf(" · ");
    return sep >= 0 ? label.slice(sep + 3) : undefined;
  }
  return citation.documentVersionId;
}

/**
 * The numbered source cards (M12.5.3) for an answer's resolved citations — shared by the persistent
 * sources rail (M12.5.1) and the slide-over drawer fallback (M12.5.4) so the two never drift. Returns
 * `undefined` when there are no citations, so the host (`SourcesRail`) shows its empty state instead.
 */
function sourceCards(citations: ChatCitationDto[]) {
  if (citations.length === 0) return undefined;
  return citations.map((citation) => (
    <SourceCard
      key={citation.ordinal}
      ordinal={citation.ordinal}
      kind={citation.kind}
      title={sourceCardTitle(citation)}
      provenance={sourceCardProvenance(citation)}
      excerpt={citation.quote}
    />
  ));
}

/** Replaces the last message in the list via `fn` (immutably). */
function updateLast(messages: UiMessage[], fn: (m: UiMessage) => UiMessage): UiMessage[] {
  if (messages.length === 0) return messages;
  const copy = messages.slice();
  copy[copy.length - 1] = fn(copy[copy.length - 1]);
  return copy;
}

/**
 * The in-chat consultation recommendation (M7.2): a Book / Maybe later / Ask another prompt shown
 * under an answer when a funnel rule fired (M7.1). Book records the choice and opens the TidyCal
 * link in a new tab (a generic confirmation when no link is configured yet); the other two dismiss
 * the prompt — all three are recorded against the recommendation id for funnel attribution (M10.2).
 */
function ConsultationPrompt({
  recommendation,
  expertName,
}: {
  recommendation: ConsultationRecommendationDto;
  expertName?: string;
}) {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<"open" | "busy" | "booked" | "dismissed">("open");
  const [error, setError] = useState<string | null>(null);

  const respond = useCallback(
    async (choice: "book" | "maybe_later" | "ask_another") => {
      setStatus("busy");
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          setStatus("open");
          return;
        }
        const result = await respondToRecommendation(recommendation.id, choice, token);
        if (choice === "book") {
          if (result.booking?.tidycalLink) {
            window.open(result.booking.tidycalLink, "_blank", "noopener,noreferrer");
          }
          setStatus("booked");
        } else {
          setStatus("dismissed");
        }
      } catch {
        setError("Couldn't record that — please try again.");
        setStatus("open");
      }
    },
    [getIdToken, recommendation.id],
  );

  if (status === "dismissed") return null;

  if (status === "booked") {
    const link = recommendation.consultationType?.tidycalLink;
    return (
      <Badge tone="green">
        {link
          ? "We've opened your booking page in a new tab."
          : "Thanks — we'll be in touch to schedule your consultation."}
      </Badge>
    );
  }

  const busy = status === "busy";
  const bookLabel = recommendation.consultationType
    ? `Book ${recommendation.consultationType.name}`
    : expertName
      ? `Book with ${expertName}`
      : "Book a consultation";
  return (
    <ChatConsultationCard
      description={recommendation.reason}
      bookLabel={bookLabel}
      busy={busy}
      onBook={() => void respond("book")}
      onMaybeLater={() => void respond("maybe_later")}
      onAskAnother={() => void respond("ask_another")}
    >
      {error && <Badge tone="red">{error}</Badge>}
    </ChatConsultationCard>
  );
}

/**
 * One assistant turn in the live chat: delegates to the shared {@link AnswerView} (M4.2 sources
 * drawer + render-after-resolve) once any prose has arrived, showing a streaming placeholder until
 * then. Markers stay non-interactive mid-stream (`interactive={message.done}`); the inline sources
 * drawer is driven by the action-bar "View sources" toggle (`sourcesOpen`, M12.4.4).
 */
function AssistantAnswer({ message, sourcesOpen }: { message: UiMessage; sourcesOpen: boolean }) {
  if (!message.content) {
    return <p>{message.done ? "" : "…"}</p>;
  }
  return (
    <AnswerView
      content={message.content}
      citations={message.citations}
      interactive={message.done}
      sourcesOpen={sourcesOpen}
    />
  );
}

/**
 * The action bar under a finished answer (M12.4.4): the shared {@link ChatAnswerActions} bar laying
 * out the "View sources (N)" toggle (M12.5 drawer/rail), Save (M3.2), and 👍/👎 feedback (M3.4) in
 * one horizontal row, with the feedback reason field + errors below. Merges the former separate Save
 * + feedback components so they read as a single bar.
 *
 * Save sends only the `messageId` (the conversation is derived + ownership re-checked server-side);
 * a 409 surfaces as a benign "Saved" state, so it's idempotent from the user's view. The verdict is
 * an idempotent upsert keyed on the answer — the user can flip 👍↔👎 or add/revise a reason via the
 * same endpoint; the reason field appears once a verdict is chosen (optional, length-bounded to the
 * API's 500-char limit, directive §1.1). Ownership is enforced server-side by RLS.
 */
function AnswerActions({
  messageId,
  sourceCount,
  sourcesOpen,
  onToggleSources,
}: {
  messageId: string;
  sourceCount: number;
  sourcesOpen: boolean;
  onToggleSources: () => void;
}) {
  const { getIdToken } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaveBusy(true);
    setSaveError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setSaveError("Please sign in to save answers.");
        return;
      }
      await createSavedAnswer(token, messageId);
      setSaved(true);
    } catch {
      setSaveError("Couldn't save — please try again.");
    } finally {
      setSaveBusy(false);
    }
  }, [getIdToken, messageId]);

  const sendFeedback = useCallback(
    async (helpful: boolean, withReason: boolean) => {
      setFbBusy(true);
      setFbError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setFbError("Please sign in to leave feedback.");
          return;
        }
        const trimmed = reason.trim();
        await submitFeedback(messageId, helpful, token, withReason && trimmed ? trimmed : undefined);
        setVerdict(helpful);
      } catch {
        setFbError("Couldn't save your feedback — please try again.");
      } finally {
        setFbBusy(false);
      }
    },
    [getIdToken, messageId, reason],
  );

  return (
    <ChatAnswerActions
      sourceCount={sourceCount}
      sourcesOpen={sourcesOpen}
      onToggleSources={onToggleSources}
      saved={saved}
      saveBusy={saveBusy}
      onSave={() => void save()}
      verdict={verdict}
      feedbackBusy={fbBusy}
      onFeedback={(helpful) => void sendFeedback(helpful, false)}
    >
      {verdict !== null && (
        <div className="row gap2 wrap">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={fbBusy}
            maxLength={500}
            placeholder="Add a reason (optional)"
            aria-label="Feedback reason"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void sendFeedback(verdict, true)}
            disabled={fbBusy || !reason.trim()}
          >
            Send reason
          </Button>
          <span className="muted">Thanks for your feedback.</span>
        </div>
      )}
      {saveError && <Badge tone="red">{saveError}</Badge>}
      {fbError && <Badge tone="red">{fbError}</Badge>}
    </ChatAnswerActions>
  );
}

/**
 * One assistant message in the transcript (M12.4.2 + M12.4.4): the {@link ChatAssistantMessage}
 * header over the answer body — prose + citations, the degraded / insufficient / high-stakes /
 * recommendation state cards, and the {@link AnswerActions} bar once the answer is finished. Owns the
 * per-message `sourcesOpen` toggle state shared by the prose drawer (M12.4.3) and the bar (M12.4.4).
 *
 * When the persistent sources rail is not on screen (classic/focus direction or a narrow viewport),
 * the page passes `onOpenSourcesDrawer` and "View sources" routes to the slide-over drawer (M12.5.4)
 * instead of the inline list — keeping a single sources presentation per layout.
 */
function AssistantTurn({
  message,
  onOpenSourcesDrawer,
  showVerifiedBadge = true,
}: {
  message: UiMessage;
  onOpenSourcesDrawer?: (citations: ChatCitationDto[]) => void;
  /** When false, the "Verified" trust badge is suppressed (Tweaks toggle, M12.7.3). */
  showVerifiedBadge?: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // When the drawer is the sources surface, the inline list stays closed and the
  // action-bar toggle opens the page-level drawer with this answer's citations.
  const useDrawer = onOpenSourcesDrawer != null;
  const inlineOpen = !useDrawer && sourcesOpen;

  return (
    <ChatAssistantMessage
      expertName={message.expertName}
      aiRendition={Boolean(message.expertName)}
      sourceLabel={message.done ? answerSourceLabel(message.citations) : undefined}
      verified={
        showVerifiedBadge &&
        message.done &&
        message.citations.length > 0 &&
        !message.insufficientKnowledge
      }
    >
      <AssistantAnswer message={message} sourcesOpen={inlineOpen} />
      {message.done && message.degraded && (
        <ChatStateNotice tone="info" label="Fair-use mode" variant="note">
          Answered with a lighter model while you’re over this period’s soft limit.
        </ChatStateNotice>
      )}
      {message.done && message.insufficientKnowledge && (
        <ChatStateNotice tone="amber" label="Limited knowledge">
          I couldn’t find enough in the expert’s knowledge base to answer this confidently. Try
          rephrasing your question, or book a consultation for a direct answer.
        </ChatStateNotice>
      )}
      {message.done && message.highStakes && <HighStakesNotice />}
      {message.done && message.recommendation && (
        <ConsultationPrompt recommendation={message.recommendation} expertName={message.expertName} />
      )}
      {message.done && message.messageId && (
        <AnswerActions
          messageId={message.messageId}
          sourceCount={message.citations.length}
          sourcesOpen={inlineOpen}
          onToggleSources={() =>
            useDrawer
              ? onOpenSourcesDrawer(message.citations)
              : setSourcesOpen((open) => !open)
          }
        />
      )}
    </ChatAssistantMessage>
  );
}

/** Human-readable file size for the uploaded-file list (binary units, matching the API's limit). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

/**
 * Query-time document upload (M5, PRD §"Document-assisted Q&A"). The user picks a file and a
 * retention mode, then uploads it to the API (`POST /uploads`) which validates type/size, scans for
 * malware, parses+chunks+embeds, and stores it. A `persistent` file is indexed into the user's
 * private knowledge so any later question can retrieve it; a `temporary` file is scoped to the
 * current conversation and expires — so it is only retrievable once the chat has a conversation
 * (i.e. after the first message), which is surfaced as a hint. The server is the authority on
 * type/safety; a rejected upload shows the API's message verbatim. `chunkCount === 0` means the
 * file was stored but a parser for its format has not landed yet (PDF/DOCX), so it isn't searchable.
 *
 * Rendered inside the {@link ChatUploadPopover} (M12.6.2) that opens above the input bar from the
 * attach button — the popover supplies the chrome (header, close, accepted file-type chips + the
 * mode label); this owns the mode/file/upload state and the controls.
 */
function UploadPanel({
  conversationId,
  onClose,
}: {
  conversationId: string | undefined;
  onClose: () => void;
}) {
  const { getIdToken } = useAuth();
  const [mode, setMode] = useState<UploadMode>("temporary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFileDto[]>([]);
  // Bumped after each upload to reset the native file input (it has no controlled value).
  const [inputKey, setInputKey] = useState(0);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to upload a document.");
          return;
        }
        const uploaded = await uploadFile(token, file, mode, conversationId);
        setFiles((prev) => [uploaded, ...prev]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setBusy(false);
        setInputKey((k) => k + 1);
      }
    },
    [getIdToken, mode, conversationId],
  );

  // The `.badge-info` mode label in the popover header (M12.6.2): a temporary upload
  // applies to this chat only and is never indexed into the user's knowledge; a
  // persistent upload is saved + indexed for future questions. Rendered uppercase by
  // the `.badge` text-transform, so "Temporary · not indexed" reads "TEMPORARY · NOT INDEXED".
  const modeLabel =
    mode === "persistent" ? "Persistent · saved to knowledge" : "Temporary · not indexed";

  return (
    <ChatUploadPopover onClose={onClose} modeLabel={modeLabel}>
      <p className="muted">
        Add a document for this chat. Persistent files are saved to your private knowledge and used
        in future questions; temporary files apply to this conversation only and expire.
      </p>
      <Field label="Mode" htmlFor="upload-mode">
        <Select
          id="upload-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as UploadMode)}
          disabled={busy}
        >
          <option value="temporary">Temporary (this conversation)</option>
          <option value="persistent">Persistent (saved to my knowledge)</option>
        </Select>
      </Field>
      <input
        key={inputKey}
        type="file"
        accept={UPLOAD_ACCEPT}
        disabled={busy}
        aria-label="Choose a document to upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {busy && <span className="muted">Uploading…</span>}
      {mode === "temporary" && !conversationId && (
        <span className="muted">
          Send a message first — temporary files attach to this conversation.
        </span>
      )}
      {error && <Badge tone="red">{error}</Badge>}
      {files.length > 0 && (
        <div className="col gap1">
          {files.map((f) => (
            <div key={f.id} className="row gap2 wrap">
              <span>{f.filename}</span>
              <Badge tone={f.mode === "persistent" ? "green" : "info"}>{f.mode}</Badge>
              <span className="muted">{formatBytes(f.sizeBytes)}</span>
              {f.chunkCount > 0 ? (
                <Badge tone="green">{f.chunkCount} searchable chunks</Badge>
              ) : (
                <Badge tone="amber">stored — not searchable yet</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </ChatUploadPopover>
  );
}

export default function ChatPage() {
  const { user, getIdToken } = useAuth();
  const [experts, setExperts] = useState<ExpertVoice[]>([]);
  const [expertId, setExpertId] = useState("");
  // Answer language (M12.3.3) — toggled from the user-identity EN/VI badge in the
  // header; reused on the next turn (M1 supports EN + VI retrieval).
  const [language, setLanguage] = useState<ChatLanguage>("en");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Layout direction (M12.1.3 + M12.7.2) — the page owns the switcher state; the
  // Tweaks panel toggles it and persists the choice to localStorage. Studio =
  // default three-pane; classic/focus drop panes (handled by ChatLayout + ds.css).
  // Initialize with the default for a stable SSR render; restore the stored value
  // after mount (avoids a hydration mismatch).
  const [direction, setDirection] = useState<LayoutDirection>(DEFAULT_LAYOUT_DIRECTION);
  // The Tweaks panel is open by default so the layout control is reachable; the
  // close (X) hides it. The topbar "Show tweaks" reopen affordance is M12.7.4.
  const [tweaksOpen, setTweaksOpen] = useState(true);
  useEffect(() => {
    const stored = window.localStorage.getItem(LAYOUT_DIRECTION_STORAGE_KEY);
    if (isLayoutDirection(stored)) setDirection(stored);
  }, []);
  const changeDirection = useCallback((next: LayoutDirection) => {
    setDirection(next);
    window.localStorage.setItem(LAYOUT_DIRECTION_STORAGE_KEY, next);
  }, []);
  // Display density + the two `.switch` options (M12.7.3) — same own-the-state +
  // restore-after-mount + persist pattern as the direction above. Density drives
  // the chat-thread vertical rhythm (ChatLayout); the verified toggle gates the
  // M12.4.2 "Verified" badge; the concierge toggle is a forward-looking pref.
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [showVerifiedBadge, setShowVerifiedBadge] = useState(true);
  const [showConciergeOffer, setShowConciergeOffer] = useState(true);
  useEffect(() => {
    const storedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (isDensity(storedDensity)) setDensity(storedDensity);
    if (window.localStorage.getItem(VERIFIED_BADGE_STORAGE_KEY) === "false") {
      setShowVerifiedBadge(false);
    }
    if (window.localStorage.getItem(CONCIERGE_OFFER_STORAGE_KEY) === "false") {
      setShowConciergeOffer(false);
    }
  }, []);
  const changeDensity = useCallback((next: Density) => {
    setDensity(next);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  }, []);
  const changeVerifiedBadge = useCallback((on: boolean) => {
    setShowVerifiedBadge(on);
    window.localStorage.setItem(VERIFIED_BADGE_STORAGE_KEY, String(on));
  }, []);
  const changeConciergeOffer = useCallback((on: boolean) => {
    setShowConciergeOffer(on);
    window.localStorage.setItem(CONCIERGE_OFFER_STORAGE_KEY, String(on));
  }, []);
  // Sources surface (M12.5.4): the persistent rail is on screen only when the
  // direction keeps it (studio) AND the viewport is wide enough (≥1280px — below
  // that ds.css collapses it). Otherwise sources route to the slide-over drawer.
  const wideViewport = useMediaQuery("(min-width: 1280px)");
  const railVisible = layoutPanes(direction).rail && wideViewport;
  // The answer whose sources the slide-over drawer is showing, or null when closed.
  const [drawerCitations, setDrawerCitations] = useState<ChatCitationDto[] | null>(null);
  // Whether the attach-document popover (M12.6.2) is open above the input bar.
  const [attachOpen, setAttachOpen] = useState(false);

  // If the persistent rail comes back (widened viewport / switched to studio), close
  // the drawer so sources aren't shown twice.
  useEffect(() => {
    if (railVisible) setDrawerCitations(null);
  }, [railVisible]);
  // Conversation search (M12.2.2) — full-text search across the user's chats
  // (M3.3). The sidebar input is debounced into `searchQuery`; results render
  // under the field and selecting one loads that conversation into the chat.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  // Conversation history list (M12.2.3) — the sidebar "RECENT" list (M3.2).
  // Loaded on mount and refreshed after each completed turn so a new chat (and
  // the most-recent-first reordering) appears without a manual reload.
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  // Conversation title for the header (M12.3.1). Best-known title for the active
  // chat: null for a brand-new (unsaved) conversation, the auto-derived/renamed
  // title once it exists. `editingTitle`/`titleDraft` drive the click-to-rename
  // input; the page owns this state since the ds.css topbar is presentational.
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Plan + usage for the sidebar meter (M12.2.4 → M6.1). Loaded on mount and
  // refreshed after each completed turn so the "questions this month" count moves
  // as the user asks. Best-effort: a failure just hides the meter.
  const [entitlements, setEntitlements] = useState<EntitlementsDto | null>(null);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const list = await fetchExperts(token);
        if (active) setExperts(list);
      } catch {
        // The voice picker is optional — a failure here just leaves the neutral voice.
      }
    })();
    return () => {
      active = false;
    };
  }, [user, getIdToken]);

  // Load the conversation history list (M12.2.3 → M3.2), most-recent-first.
  // Best-effort: a failure just leaves the list empty (the sidebar still works).
  const loadConversations = useCallback(async (): Promise<ConversationSummaryDto[]> => {
    try {
      const token = await getIdToken();
      if (!token) return [];
      const list = await listConversations(token, { limit: 30, offset: 0 });
      setConversations(list);
      return list;
    } catch {
      // The RECENT list is non-critical — swallow and keep whatever we had.
      return [];
    } finally {
      setLoadingConversations(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (!user) return;
    void loadConversations();
  }, [user, loadConversations]);

  // Load the plan + usage entitlements for the sidebar meter (M12.2.4 → M6.1).
  // Best-effort: a failure just leaves the meter hidden (the sidebar still works).
  const loadEntitlements = useCallback(async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      setEntitlements(await fetchEntitlements(token));
    } catch {
      // The usage meter is non-critical — swallow and keep whatever we had.
    }
  }, [getIdToken]);

  useEffect(() => {
    if (!user) return;
    void loadEntitlements();
  }, [user, loadEntitlements]);

  // The questions-this-month meter (M12.2.4): the metered `ask_question` feature
  // carries the live `used`/`limit`/`softLimit` quota for the current window.
  const questionUsage = useMemo(
    () => entitlements?.features.find((f) => f.key === "ask_question" && f.type === "metered"),
    [entitlements],
  );

  // The input-bar helper quota (M12.6.3): "N questions left this month" from the
  // same metered `ask_question` entitlement that feeds the sidebar meter. Remaining
  // measures against the hard `limit` else the fair-use `softLimit`; with neither
  // the plan is unlimited. Null until the quota resolves (no flashed placeholder).
  const inputQuota = useMemo<{ questionsLeft: number | null; unlimited: boolean }>(() => {
    if (!questionUsage?.enabled) return { questionsLeft: null, unlimited: false };
    const threshold = questionUsage.limit ?? questionUsage.softLimit ?? null;
    if (threshold == null) return { questionsLeft: null, unlimited: true };
    return { questionsLeft: threshold - (questionUsage.used ?? 0), unlimited: false };
  }, [questionUsage]);

  // The input-bar placeholder (M12.6.1): "Ask [Expert] anything about your
  // business…" once a voice is selected, else a generic prompt.
  const inputPlaceholder = useMemo(() => {
    const expert = experts.find((e) => e.expertId === expertId);
    return expert
      ? `Ask ${expert.displayName} anything about your business…`
      : "Ask anything about your business…";
  }, [experts, expertId]);

  // Resolved citations for the latest assistant answer — feed both the sources-rail
  // header count (M12.5.2) and the source cards (M12.5.3). Render-after-resolve: only
  // the latest answer's citations show; the header/cards stay empty until they resolve.
  const railCitations = useMemo<ChatCitationDto[]>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant") return m.citations;
    }
    return [];
  }, [messages]);

  // The RECENT rows (M12.2.3): map summaries to list items, resolving the expert
  // display name from the loaded voices for the avatar, and sorting most-recent
  // first (the API already does, but lexicographic ISO sort is a cheap guard).
  const conversationItems: ChatConversationItem[] = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((c) => ({
          id: c.id,
          title: c.title ?? "Untitled conversation",
          expertName: c.expertId
            ? (experts.find((e) => e.expertId === c.expertId)?.displayName ?? null)
            : null,
          updatedAt: c.updatedAt,
        })),
    [conversations, experts],
  );

  // Debounced full-text search (M12.2.2 → M3.3). The query is trimmed and only
  // searched at ≥2 chars; an empty/short query clears the results. The latest
  // request wins (a stale in-flight response is dropped via the `active` flag).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const token = await getIdToken();
          if (!token || !active) return;
          const hits = await searchConversations(token, q, { limit: 20, offset: 0 });
          if (!active) return;
          setSearchResults(
            hits.map((h) => ({
              id: h.conversation.id,
              title: h.conversation.title ?? "Untitled conversation",
              snippet: h.snippet,
            })),
          );
        } catch {
          // Search is best-effort — a failed request just leaves no results.
          if (active) setSearchResults([]);
        } finally {
          if (active) setSearching(false);
        }
      })();
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, getIdToken]);

  // "+ New conversation" (M12.2.1) — clears the active chat so the next message
  // starts a fresh conversation. The conversation list (M12.2.3) will let the
  // user switch back to a prior chat.
  const startNewConversation = useCallback(() => {
    if (busy) return;
    setMessages([]);
    setConversationId(undefined);
    setConversationTitle(null);
    setEditingTitle(false);
    setDraft("");
    setError(null);
  }, [busy]);

  // Open a conversation from search (M12.2.2) — fetch its transcript and replay
  // it into the message list so the user can continue it. Live-only fields
  // (recommendation/feedback affordances) re-appear as new turns are sent.
  const openConversation = useCallback(
    async (id: string) => {
      if (busy) return;
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to open a conversation.");
          return;
        }
        const detail = await getConversation(token, id);
        setMessages(
          detail.messages.map((m) => ({
            role: m.role,
            content: m.content,
            citations: m.citations,
            done: true,
            messageId: m.role === "assistant" ? m.id : undefined,
            highStakes: m.highStakes ?? false,
          })),
        );
        setConversationId(detail.id);
        setConversationTitle(detail.title);
        setEditingTitle(false);
        setExpertId(detail.expertId ?? "");
        setDraft("");
        setSearchQuery("");
      } catch {
        setError("Couldn't open that conversation — please try again.");
      }
    },
    [busy, getIdToken],
  );

  // The header title (M12.3.1): the best-known title for the active chat, with a
  // fallback for an unsaved (new) conversation vs a saved one still awaiting its
  // auto-title. Only a saved conversation (has an id) can be renamed.
  const displayTitle = conversationTitle ?? (conversationId ? "Untitled conversation" : "New conversation");

  // Click-to-rename (M12.3.1 → M3.2): open the inline editor seeded with the
  // current title. Guarded to saved conversations (a new chat has nothing to name).
  const startRename = useCallback(() => {
    if (!conversationId) return;
    setTitleDraft(conversationTitle ?? "");
    setEditingTitle(true);
  }, [conversationId, conversationTitle]);

  // Commit a rename: a trimmed, changed, non-empty title is persisted (PATCH
  // /conversations/:id) and optimistically shown; an empty/unchanged edit just
  // closes the editor. The RECENT list is refreshed so its row title follows.
  const commitRename = useCallback(async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!conversationId || !next || next === conversationTitle) return;
    setConversationTitle(next);
    try {
      const token = await getIdToken();
      if (!token) return;
      await renameConversation(token, conversationId, next);
      void loadConversations();
    } catch {
      // Best-effort: a failed rename leaves the optimistic title until the next
      // list refresh reconciles it. Surface nothing — renaming is non-critical.
    }
  }, [titleDraft, conversationId, conversationTitle, getIdToken, loadConversations]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);

    const token = await getIdToken();
    if (!token) {
      setError("Please sign in to chat.");
      return;
    }

    const expert = experts.find((e) => e.expertId === expertId);
    setDraft("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, citations: [], done: true },
      {
        role: "assistant",
        content: "",
        citations: [],
        done: false,
        expertName: expert?.displayName,
      },
    ]);

    // The conversation id resolved by this turn (a brand-new chat gets one on the
    // `done` frame) — used below to pick up the server's auto-title (M12.3.1).
    let resolvedConversationId = conversationId;
    try {
      await streamChat(
        { text, conversationId, expertId: expertId || undefined, language },
        token,
        (event) => {
          if (event.type === "delta") {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, content: m.content + event.text })),
            );
          } else if (event.type === "done") {
            resolvedConversationId = event.conversationId;
            setConversationId(event.conversationId);
            setMessages((prev) =>
              updateLast(prev, (m) => ({
                ...m,
                citations: event.citations,
                done: true,
                messageId: event.messageId,
                insufficientKnowledge: event.insufficientKnowledge,
                degraded: event.degraded ?? false,
                recommendation: event.recommendation ?? null,
                highStakes: event.highStakes ?? false,
              })),
            );
          } else {
            setError(event.message);
            setMessages((prev) => updateLast(prev, (m) => ({ ...m, done: true })));
          }
        },
      );
      // Refresh the RECENT list (M12.2.3) so a brand-new conversation appears and
      // the ordering reflects this turn's activity, and the usage meter (M12.2.4)
      // so the questions-this-month count moves with the turn just spent. The
      // refreshed list also carries the server's auto-title for the header
      // (M12.3.1) — adopt it for the active chat (unless the user is mid-rename).
      const refreshed = await loadConversations();
      const summary = refreshed.find((c) => c.id === resolvedConversationId);
      if (summary) {
        setConversationTitle((prev) => (editingTitle ? prev : summary.title));
      }
      void loadEntitlements();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
      setMessages((prev) => updateLast(prev, (m) => ({ ...m, done: true })));
    } finally {
      setBusy(false);
    }
  }, [
    draft,
    busy,
    getIdToken,
    experts,
    expertId,
    language,
    conversationId,
    editingTitle,
    loadConversations,
    loadEntitlements,
  ]);

  if (!user) {
    return (
      <ChatLayout direction={direction} density={density}>
        <main className="card card-pad">
          <h1>Chat</h1>
          <Badge tone="info">Please sign in on the home page to start chatting.</Badge>
        </main>
      </ChatLayout>
    );
  }

  return (
    <ChatLayout
      direction={direction}
      density={density}
      rail={
        <SourcesRail header={<SourcesRailHeader count={railCitations.length} />}>
          {sourceCards(railCitations)}
        </SourcesRail>
      }
      sidebar={
        <ChatSidebar
          onNewConversation={startNewConversation}
          footer={
            entitlements && questionUsage?.enabled ? (
              <ChatUsageMeter
                used={questionUsage.used ?? 0}
                limit={questionUsage.limit ?? null}
                softLimit={questionUsage.softLimit ?? null}
                planName={entitlements.plan.name}
                upgradeHref="/account"
              />
            ) : undefined
          }
        >
          <ChatSearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            searching={searching}
            onSelect={(id) => void openConversation(id)}
            activeId={conversationId}
          />
          {searchQuery.trim().length < 2 && (
            <ChatConversationList
              items={conversationItems}
              activeId={conversationId}
              onSelect={(id) => void openConversation(id)}
              loading={loadingConversations}
            />
          )}
        </ChatSidebar>
      }
    >
      <ChatTopbar
        title={displayTitle}
        titleEditable={Boolean(conversationId)}
        editing={editingTitle}
        draft={titleDraft}
        onDraftChange={setTitleDraft}
        onEditStart={startRename}
        onCommit={() => void commitRename()}
        onCancel={() => setEditingTitle(false)}
      >
        {experts.length > 0 && (
          <ChatVoicePicker
            options={experts.map((e) => ({ id: e.expertId, name: e.displayName }))}
            activeId={expertId}
            onSelect={setExpertId}
            disabled={busy}
          />
        )}
        <ChatUserIdentity
          name={user.displayName}
          email={user.email}
          language={language}
          onLanguageToggle={
            busy ? undefined : () => setLanguage((prev) => (prev === "en" ? "vi" : "en"))
          }
        />
      </ChatTopbar>
      <main className="card card-pad chat-content">
        <div className="chat-thread">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <ChatUserMessage key={i} content={m.content} />
            ) : (
              <Card key={i} className="card-pad">
                <AssistantTurn
                  message={m}
                  onOpenSourcesDrawer={railVisible ? undefined : setDrawerCitations}
                  showVerifiedBadge={showVerifiedBadge}
                />
              </Card>
            ),
          )}
        </div>

        {error && <Badge tone="red">{error}</Badge>}
      </main>
      <ChatInputBar
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        busy={busy}
        placeholder={inputPlaceholder}
        onAttach={() => setAttachOpen((open) => !open)}
        attachActive={attachOpen}
      >
        {attachOpen && (
          <UploadPanel conversationId={conversationId} onClose={() => setAttachOpen(false)} />
        )}
        <ChatInputHelper
          questionsLeft={inputQuota.questionsLeft}
          unlimited={inputQuota.unlimited}
        />
      </ChatInputBar>
      <SourcesDrawer
        open={drawerCitations !== null}
        onClose={() => setDrawerCitations(null)}
        header={<SourcesRailHeader count={drawerCitations?.length ?? 0} />}
      >
        {drawerCitations ? sourceCards(drawerCitations) : undefined}
      </SourcesDrawer>
      {tweaksOpen && (
        <TweaksPanel onClose={() => setTweaksOpen(false)}>
          <TweaksLayoutControl value={direction} onChange={changeDirection} />
          <TweaksDensityControl
            density={density}
            onDensityChange={changeDensity}
            verifiedBadge={showVerifiedBadge}
            onVerifiedBadgeChange={changeVerifiedBadge}
            conciergeOffer={showConciergeOffer}
            onConciergeOfferChange={changeConciergeOffer}
          />
        </TweaksPanel>
      )}
    </ChatLayout>
  );
}
