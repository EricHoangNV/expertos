import type { ReactElement } from "react";
import { Badge } from "./Badge";
import { Bar } from "./Bar";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { Cite } from "./Cite";
import { Content, Shell, Topbar } from "./Shell";
import { ChatLayout } from "./ChatLayout";
import { ChatSearch, type ChatSearchResultItem } from "./ChatSearch";
import { ChatSidebar } from "./ChatSidebar";
import { ChatVoicePicker, type ChatVoiceOption } from "./ChatVoicePicker";
import { ChatUserIdentity } from "./ChatUserIdentity";
import { ChatUserMessage } from "./ChatUserMessage";
import { ChatAssistantMessage } from "./ChatAssistantMessage";
import { ChatAnswerActions } from "./ChatAnswerActions";
import { ChatConsultationCard } from "./ChatConsultationCard";
import { ChatStateNotice } from "./ChatStateNotice";
import { SourcesRail } from "./SourcesRail";
import { SourcesRailHeader } from "./SourcesRailHeader";
import { SourceCard } from "./SourceCard";
import { SourcesDrawer } from "./SourcesDrawer";
import { AnswerProse } from "./AnswerProse";
import { ChatTopbar } from "./ChatTopbar";
import {
  AVATAR_TONES,
  avatarInitials,
  avatarTone,
  ChatConversationList,
  type ChatConversationItem,
  relativeTime,
} from "./ChatConversationList";
import {
  DEFAULT_LAYOUT_DIRECTION,
  isLayoutDirection,
  LAYOUT_DIRECTION_INFO,
  LAYOUT_DIRECTIONS,
  layoutPanes,
} from "./layout";
import { Field, Input, Select, Textarea } from "./Field";
import { Stat } from "./Stat";
import { Table } from "./Table";
import { UsageMeter } from "./UsageMeter";
import { ChatUsageMeter } from "./ChatUsageMeter";

/**
 * Design-system conformance tests (M11.5). These mechanize the non-negotiable
 * UI rules from PRD §"Design System" so a regression fails the build:
 *  - citation markers render ONLY after they resolve (never flashed-then-removed);
 *  - uploaded sources are info-blue (`.cite.upload`) vs crimson knowledge (`.cite`);
 *  - status is always a `.badge` with the matching semantic tone;
 *  - the quota `.bar` / usage meter read consistently (crimson, amber when warned).
 *
 * The primitives are pure (no hooks), so we invoke them directly and assert on the
 * returned element tree — no DOM renderer or extra dependency required.
 */

/** Read the (untyped) className off a returned design-system element. */
const cls = (el: ReactElement): unknown => (el.props as { className?: unknown }).className;
/** Read the children off a returned element. */
const kids = (el: ReactElement): unknown => (el.props as { children?: unknown }).children;

describe("Cite — render-after-resolve + source provenance by color", () => {
  it("renders nothing until the citation resolves to a real chunk", () => {
    expect(Cite({ label: "1" })).toBeNull();
    expect(Cite({ label: "1", resolved: false })).toBeNull();
  });

  it("renders the crimson `.cite` marker for published knowledge once resolved", () => {
    const el = Cite({ label: "1", resolved: true }) as ReactElement;
    expect(cls(el)).toBe("cite");
    expect(kids(el)).toBe("1");
  });

  it("renders the info-blue `.cite.upload` marker for uploaded sources", () => {
    const el = Cite({ label: "2", resolved: true, variant: "upload" }) as ReactElement;
    expect(cls(el)).toBe("cite upload");
  });

  it("merges a caller className while keeping the variant treatment", () => {
    const el = Cite({ label: "3", resolved: true, className: "x" }) as ReactElement;
    expect(cls(el)).toBe("cite x");
  });
});

describe("Badge — status is always a tone-matched `.badge`", () => {
  it("defaults to the neutral ink tone", () => {
    expect(cls(Badge({ children: "Draft" }) as ReactElement)).toBe("badge badge-ink");
  });

  it("maps every semantic tone to its `.badge-<tone>` class", () => {
    (["red", "green", "amber", "info", "ink"] as const).forEach((tone) => {
      expect(cls(Badge({ tone }) as ReactElement)).toBe(`badge badge-${tone}`);
    });
  });
});

describe("Button — one crimson primary, ds.css `.btn` variants/sizes", () => {
  it("defaults to the crimson primary action at medium size", () => {
    expect(cls(Button({}) as ReactElement)).toBe("btn btn-primary");
  });

  it("renders each variant + size combination", () => {
    expect(cls(Button({ variant: "dark", size: "lg" }) as ReactElement)).toBe("btn btn-dark btn-lg");
    expect(cls(Button({ variant: "ghost", size: "sm" }) as ReactElement)).toBe("btn btn-ghost btn-sm");
    expect(cls(Button({ variant: "subtle" }) as ReactElement)).toBe("btn btn-subtle");
  });

  it("merges a caller className", () => {
    expect(cls(Button({ className: "x" }) as ReactElement)).toBe("btn btn-primary x");
  });
});

describe("Card / Chip — surfaces and selectable controls", () => {
  it("Card toggles the inner padding modifier", () => {
    expect(cls(Card({}) as ReactElement)).toBe("card");
    expect(cls(Card({ pad: true }) as ReactElement)).toBe("card card-pad");
  });

  it("Chip is a real button (keyboard-focusable) and toggles `.active`", () => {
    const idle = Chip({}) as ReactElement;
    expect(cls(idle)).toBe("chip");
    expect((idle.props as { type?: string }).type).toBe("button");
    const active = Chip({ active: true, type: "submit" }) as ReactElement;
    expect(cls(active)).toBe("chip active");
    expect((active.props as { type?: string }).type).toBe("submit");
  });
});

describe("Field / Input / Select / Textarea / Table", () => {
  it("Field renders a label only when one is supplied", () => {
    const bare = Field({ children: "body" }) as ReactElement;
    expect(cls(bare)).toBe("field");
    expect((kids(bare) as unknown[])[0]).toBe(false);

    const labelled = Field({ label: "Name", htmlFor: "n", children: "body" }) as ReactElement;
    const label = (kids(labelled) as ReactElement[])[0];
    expect((label.props as { htmlFor?: string }).htmlFor).toBe("n");
    expect((label.props as { children?: unknown }).children).toBe("Name");
  });

  it("controls render their ds.css base class", () => {
    expect(cls(Input({}) as ReactElement)).toBe("input");
    expect(cls(Select({}) as ReactElement)).toBe("select");
    expect(cls(Textarea({}) as ReactElement)).toBe("textarea");
    expect(cls(Table({}) as ReactElement)).toBe("table");
  });
});

describe("Stat — KPI card with optional trend-tinted delta", () => {
  it("omits the delta line when no delta is given", () => {
    const el = Stat({ label: "MRR", value: "$1k" }) as ReactElement;
    const children = kids(el) as unknown[];
    expect(cls(children[0] as ReactElement)).toBe("k");
    expect(cls(children[1] as ReactElement)).toBe("v");
    expect(children[2]).toBe(false);
  });

  it("tints the delta up (green) / down (crimson) / neutral", () => {
    const up = Stat({ label: "L", value: "V", delta: "+1", trend: "up" }) as ReactElement;
    expect(cls((kids(up) as ReactElement[])[2])).toBe("d up");
    const down = Stat({ label: "L", value: "V", delta: "-1", trend: "down" }) as ReactElement;
    expect(cls((kids(down) as ReactElement[])[2])).toBe("d down");
    const flat = Stat({ label: "L", value: "V", delta: "0" }) as ReactElement;
    expect(cls((kids(flat) as ReactElement[])[2])).toBe("d");
  });
});

describe("Bar — quota meter is clamped and NaN-guarded", () => {
  const width = (el: ReactElement): unknown =>
    ((kids(el) as ReactElement).props as { style?: { width?: unknown } }).style?.width;

  it("clamps the fill to 0–100%", () => {
    expect(width(Bar({ value: 50 }) as ReactElement)).toBe("50%");
    expect(width(Bar({ value: 150 }) as ReactElement)).toBe("100%");
    expect(width(Bar({ value: -10 }) as ReactElement)).toBe("0%");
  });

  it("guards against NaN/Infinity (renders empty fill)", () => {
    expect(width(Bar({ value: Number.NaN }) as ReactElement)).toBe("0%");
    expect(width(Bar({ value: Number.POSITIVE_INFINITY }) as ReactElement)).toBe("0%");
  });

  it("applies the amber `.bar.warn` treatment when warned", () => {
    expect(cls(Bar({ value: 50 }) as ReactElement)).toBe("bar");
    expect(cls(Bar({ value: 50, warn: true }) as ReactElement)).toBe("bar warn");
  });
});

describe("UsageMeter — transparent usage indicator (M6.3)", () => {
  const countText = (el: ReactElement): unknown => {
    const head = (kids(el) as ReactElement[])[0];
    const spans = kids(head) as ReactElement[];
    return (spans[1].props as { children?: unknown }).children;
  };
  const innerBar = (el: ReactElement): ReactElement => (kids(el) as ReactElement[])[1];

  it("reads Unlimited with no fill when there is no threshold", () => {
    const el = UsageMeter({ label: "Questions", used: 5 }) as ReactElement;
    expect(cls(el)).toBe("meter");
    expect(countText(el)).toBe("5 used · Unlimited");
    expect((innerBar(el).props as { value?: number }).value).toBe(0);
  });

  it("treats a non-positive threshold as unlimited", () => {
    const el = UsageMeter({ label: "Q", used: 5, limit: 0 }) as ReactElement;
    expect(countText(el)).toBe("5 used · Unlimited");
  });

  it("measures against a hard limit and only warns near the cap", () => {
    const under = UsageMeter({ label: "Q", used: 50, limit: 100 }) as ReactElement;
    expect(cls(under)).toBe("meter");
    expect(countText(under)).toBe("50 / 100");
    expect((innerBar(under).props as { value?: number; warn?: boolean }).value).toBe(50);
    expect((innerBar(under).props as { warn?: boolean }).warn).toBe(false);

    const near = UsageMeter({ label: "Q", used: 90, limit: 100 }) as ReactElement;
    expect(cls(near)).toBe("meter is-warn");
  });

  it("reads a fair-use soft threshold and warns past it (degrade, don't block)", () => {
    const under = UsageMeter({ label: "Q", used: 100, limit: null, softLimit: 500 }) as ReactElement;
    expect(cls(under)).toBe("meter");
    expect(countText(under)).toBe("100 used · fair-use 500");

    const over = UsageMeter({ label: "Q", used: 600, limit: null, softLimit: 500 }) as ReactElement;
    expect(cls(over)).toBe("meter is-warn");
    expect(countText(over)).toBe("600 used · fair-use 500");
  });

  it("guards a non-finite count and honours a custom warn ratio", () => {
    const nan = UsageMeter({ label: "Q", used: Number.NaN, limit: 100 }) as ReactElement;
    expect(countText(nan)).toBe("0 / 100");
    const custom = UsageMeter({ label: "Q", used: 50, limit: 100, warnRatio: 0.4 }) as ReactElement;
    expect(cls(custom)).toBe("meter is-warn");
  });
});

describe("ChatUsageMeter — sidebar-bottom questions-this-month meter (M12.2.4)", () => {
  const countText = (el: ReactElement): unknown => {
    const head = (kids(el) as ReactElement[])[0];
    const spans = kids(head) as ReactElement[];
    return (spans[1].props as { children?: unknown }).children;
  };
  const bar = (el: ReactElement): ReactElement => (kids(el) as ReactElement[])[1];
  const foot = (el: ReactElement): ReactElement => (kids(el) as ReactElement[])[2];
  const planBadge = (el: ReactElement): ReactElement => (kids(foot(el)) as ReactElement[])[0];
  const upgrade = (el: ReactElement): unknown => (kids(foot(el)) as unknown[])[1];

  it("renders the count, plan badge, and a crimson upgrade link against a hard limit", () => {
    const el = ChatUsageMeter({
      used: 42,
      limit: 50,
      planName: "Plus",
      upgradeHref: "/account",
    }) as ReactElement;
    // 84% ≥ 0.8 warn ratio → amber.
    expect(cls(el)).toBe("sidebar-usage is-warn");
    expect(countText(el)).toBe("42 / 50");
    expect((bar(el).props as { value?: number; warn?: boolean }).value).toBe(84);
    expect((bar(el).props as { warn?: boolean }).warn).toBe(true);
    expect(cls(planBadge(el))).toBe("label");
    expect(kids(planBadge(el))).toBe("Plus");
    const link = upgrade(el) as ReactElement;
    expect(cls(link)).toBe("sidebar-usage-upgrade");
    expect((link.props as { href?: unknown }).href).toBe("/account");
  });

  it("stays un-warned well under the cap", () => {
    const el = ChatUsageMeter({ used: 10, limit: 200, planName: "Plus" }) as ReactElement;
    expect(cls(el)).toBe("sidebar-usage");
    expect(countText(el)).toBe("10 / 200");
    expect((bar(el).props as { warn?: boolean }).warn).toBe(false);
  });

  it("measures against a fair-use soft threshold and warns past it (degrade, don't block)", () => {
    const over = ChatUsageMeter({
      used: 600,
      limit: null,
      softLimit: 500,
      planName: "Premium",
    }) as ReactElement;
    expect(cls(over)).toBe("sidebar-usage is-warn");
    expect(countText(over)).toBe("600 / 500");
    expect((bar(over).props as { value?: number }).value).toBe(100); // clamped
  });

  it("reads Unlimited with no fill when there is no threshold", () => {
    const el = ChatUsageMeter({ used: 7, planName: "Premium" }) as ReactElement;
    expect(countText(el)).toBe("7 · Unlimited");
    expect((bar(el).props as { value?: number }).value).toBe(0);
  });

  it("guards a non-finite count and omits the upgrade link when no href is given", () => {
    const el = ChatUsageMeter({ used: Number.NaN, limit: 50, planName: "Free" }) as ReactElement;
    expect(countText(el)).toBe("0 / 50");
    expect(upgrade(el)).toBeFalsy();
  });
});

describe("Shell / Topbar / Content — the shared app frame", () => {
  it("Shell renders the ink sidebar only when given", () => {
    const bare = Shell({ children: "main" }) as ReactElement;
    expect(cls(bare)).toBe("shell");
    expect((kids(bare) as unknown[])[0]).toBe(false);
    expect(cls((kids(bare) as ReactElement[])[1])).toBe("main");

    const framed = Shell({ sidebar: "nav", children: "main" }) as ReactElement;
    const aside = (kids(framed) as ReactElement[])[0];
    expect(cls(aside)).toBe("side");
    expect((aside.props as { children?: unknown }).children).toBe("nav");
  });

  it("Topbar renders the sticky `.topbar`", () => {
    expect(cls(Topbar({}) as ReactElement)).toBe("topbar");
  });

  it("Content optionally constrains to the centered narrow column", () => {
    const wide = Content({ children: "x" }) as ReactElement;
    expect(cls(wide)).toBe("content");
    expect(kids(wide)).toBe("x");

    const narrow = Content({ narrow: true, children: "x" }) as ReactElement;
    const inner = kids(narrow) as ReactElement;
    expect(cls(inner)).toBe("content-narrow");
    expect((inner.props as { children?: unknown }).children).toBe("x");
  });
});

describe("ChatLayout — three-pane studio grid (M12.1)", () => {
  it("renders only the `.chat-main` column when no sidebar or rail is given", () => {
    const bare = ChatLayout({ children: "chat" }) as ReactElement;
    // Defaults to the studio direction's grid modifier.
    expect(cls(bare)).toBe("chat-layout chat-layout-studio");
    const [sidebar, main, rail] = kids(bare) as ReactElement[];
    // Omitted panes short-circuit to `false` so focus/classic directions drop them.
    expect(sidebar).toBe(false);
    expect(cls(main)).toBe("chat-main");
    expect((main.props as { children?: unknown }).children).toBe("chat");
    expect(rail).toBe(false);
  });

  it("renders the sidebar and sources rail when supplied (studio default)", () => {
    const full = ChatLayout({ sidebar: "nav", rail: "sources", children: "chat" }) as ReactElement;
    const [sidebar, , rail] = kids(full) as ReactElement[];
    expect(cls(sidebar)).toBe("chat-sidebar");
    expect((sidebar.props as { children?: unknown }).children).toBe("nav");
    expect(cls(rail)).toBe("chat-rail");
    expect((rail.props as { children?: unknown }).children).toBe("sources");
  });

  it("drops the sources rail in the classic direction (sources → drawer)", () => {
    const el = ChatLayout({
      sidebar: "nav",
      rail: "sources",
      direction: "classic",
      children: "chat",
    }) as ReactElement;
    expect(cls(el)).toBe("chat-layout chat-layout-classic");
    const [sidebar, , rail] = kids(el) as ReactElement[];
    expect(cls(sidebar)).toBe("chat-sidebar");
    // Rail content is supplied but suppressed from the grid for this direction.
    expect(rail).toBe(false);
  });

  it("drops both the sidebar and rail in the focus direction", () => {
    const el = ChatLayout({
      sidebar: "nav",
      rail: "sources",
      direction: "focus",
      children: "chat",
    }) as ReactElement;
    expect(cls(el)).toBe("chat-layout chat-layout-focus");
    const [sidebar, main, rail] = kids(el) as ReactElement[];
    expect(sidebar).toBe(false);
    expect(cls(main)).toBe("chat-main");
    expect(rail).toBe(false);
  });

  it("merges a caller className onto the grid container", () => {
    const el = ChatLayout({ className: "z", children: "chat" }) as ReactElement;
    expect(cls(el)).toBe("chat-layout chat-layout-studio z");
  });
});

describe("ChatSidebar — dark rail shell (M12.2.1)", () => {
  const noop = () => {};

  it("renders the `.side .chat-side` rail with the ExpertOS wordmark + a full-width primary action", () => {
    const el = ChatSidebar({ onNewConversation: noop }) as ReactElement;
    expect(cls(el)).toBe("side chat-side");
    const [brand, newBtn, body, foot] = kids(el) as unknown[];
    // Brand row: the ExpertOS logo wordmark; no collapse button without onClose.
    const brandEl = brand as ReactElement;
    expect(cls(brandEl)).toBe("brand");
    const brandKids = kids(brandEl) as unknown[];
    expect(cls(brandKids[0] as ReactElement)).toBe("logo");
    expect(brandKids[1]).toBeFalsy();
    // Full-width crimson "New conversation".
    const btn = newBtn as ReactElement;
    expect(btn.type).toBe(Button);
    expect((btn.props as { variant?: unknown }).variant).toBe("primary");
    expect(cls(btn)).toBe("chat-side-new");
    expect(kids(btn)).toBe("+ New conversation");
    // Body/footer slots collapse when unused.
    expect(body).toBeFalsy();
    expect(foot).toBeFalsy();
  });

  it("renders the collapse button only when onClose is supplied", () => {
    const el = ChatSidebar({ onNewConversation: noop, onClose: noop }) as ReactElement;
    const [brand] = kids(el) as unknown[];
    const collapse = (kids(brand as ReactElement) as unknown[])[1] as ReactElement;
    expect(cls(collapse)).toBe("chat-side-collapse");
    expect((collapse.props as { onClick?: unknown }).onClick).toBe(noop);
    expect((collapse.props as { "aria-label"?: unknown })["aria-label"]).toBe("Collapse sidebar");
  });

  it("mounts children into the body slot and footer into the foot slot", () => {
    const el = ChatSidebar({
      onNewConversation: noop,
      children: "list",
      footer: "meter",
    }) as ReactElement;
    const [, , body, foot] = kids(el) as unknown[];
    expect(cls(body as ReactElement)).toBe("chat-side-body");
    expect(kids(body as ReactElement)).toBe("list");
    expect(cls(foot as ReactElement)).toBe("chat-side-foot");
    expect(kids(foot as ReactElement)).toBe("meter");
  });

  it("merges a caller className onto the rail", () => {
    const el = ChatSidebar({ onNewConversation: noop, className: "z" }) as ReactElement;
    expect(cls(el)).toBe("side chat-side z");
  });
});

describe("ChatTopbar — conversation header with editable title (M12.3.1)", () => {
  const noop = () => {};

  it("renders the `.topbar .chat-topbar` strip with a clickable title button when editable", () => {
    const onEditStart = jest.fn();
    const el = ChatTopbar({
      title: "Franchise unit economics",
      onEditStart,
    }) as ReactElement;
    expect(cls(el)).toBe("topbar chat-topbar");
    const [titleNode, aside] = kids(el) as unknown[];
    const button = titleNode as ReactElement;
    expect(cls(button)).toBe("chat-topbar-title");
    expect((button.props as { type?: unknown }).type).toBe("button");
    expect(kids(button)).toBe("Franchise unit economics");
    (button.props as { onClick: () => void }).onClick();
    expect(onEditStart).toHaveBeenCalledTimes(1);
    // No aside region without children.
    expect(aside).toBeFalsy();
  });

  it("renders a static (non-clickable) title span when not editable", () => {
    const el = ChatTopbar({ title: "New conversation", titleEditable: false }) as ReactElement;
    const [titleNode] = kids(el) as unknown[];
    const span = titleNode as ReactElement;
    expect(cls(span)).toBe("chat-topbar-title chat-topbar-title-static");
    expect(span.type).toBe("span");
    expect(kids(span)).toBe("New conversation");
  });

  it("falls back to the static span when editing is requested but the title is not editable", () => {
    const el = ChatTopbar({
      title: "New conversation",
      titleEditable: false,
      editing: true,
    }) as ReactElement;
    const [titleNode] = kids(el) as unknown[];
    expect(cls(titleNode as ReactElement)).toBe("chat-topbar-title chat-topbar-title-static");
  });

  it("renders a controlled `.input` when editing, wired to draft + commit/cancel", () => {
    const onDraftChange = jest.fn();
    const onCommit = jest.fn();
    const onCancel = jest.fn();
    const el = ChatTopbar({
      title: "Old title",
      editing: true,
      draft: "Edited title",
      onDraftChange,
      onCommit,
      onCancel,
    }) as ReactElement;
    const [input] = kids(el) as ReactElement[];
    expect(cls(input)).toBe("input chat-topbar-title-input");
    const props = input.props as {
      value?: unknown;
      maxLength?: unknown;
      "aria-label"?: unknown;
      onChange: (e: unknown) => void;
      onBlur: () => void;
      onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
    };
    expect(props.value).toBe("Edited title");
    expect(props.maxLength).toBe(100);
    expect(props["aria-label"]).toBe("Conversation title");
    // onChange → onDraftChange with the new value.
    props.onChange({ target: { value: "Edited titl" } });
    expect(onDraftChange).toHaveBeenCalledWith("Edited titl");
    // Blur commits.
    props.onBlur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    // Enter commits (preventing the default newline); Escape cancels; other keys are inert.
    const preventDefault = jest.fn();
    props.onKeyDown({ key: "Enter", preventDefault });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    props.onKeyDown({ key: "Escape", preventDefault });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    props.onKeyDown({ key: "a", preventDefault });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("tolerates omitted optional handlers on the editing input (no throw)", () => {
    const el = ChatTopbar({ title: "x", editing: true }) as ReactElement;
    const [input] = kids(el) as ReactElement[];
    const props = input.props as {
      onChange: (e: unknown) => void;
      onBlur: () => void;
      onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
    };
    expect(() => props.onChange({ target: { value: "y" } })).not.toThrow();
    expect(() => props.onBlur()).not.toThrow();
    expect(() => props.onKeyDown({ key: "Enter", preventDefault: noop })).not.toThrow();
    expect(() => props.onKeyDown({ key: "Escape", preventDefault: noop })).not.toThrow();
  });

  it("mounts children into the right-aligned `.chat-topbar-aside` slot", () => {
    const el = ChatTopbar({ title: "T", children: "voice + identity" }) as ReactElement;
    const [, aside] = kids(el) as unknown[];
    const asideEl = aside as ReactElement;
    expect(cls(asideEl)).toBe("chat-topbar-aside");
    expect(kids(asideEl)).toBe("voice + identity");
  });
});

describe("ChatVoicePicker — expert voice chips (M12.3.2)", () => {
  const noop = () => {};
  const opts: ChatVoiceOption[] = [
    { id: "jp", name: "James Pierce" },
    { id: "an", name: "Anh Nguyen" },
  ];

  /** Destructure the picker's children: [label, neutralChip, [expertChips]]. */
  const parts = (el: ReactElement) => {
    const [label, neutral, experts] = kids(el) as [ReactElement, ReactElement, ReactElement[]];
    return { label, neutral, experts };
  };

  it("renders the `.chat-voice-picker` with a VOICE label, a Neutral chip, and one chip per expert", () => {
    const el = ChatVoicePicker({ options: opts, onSelect: noop }) as ReactElement;
    expect(cls(el)).toBe("chat-voice-picker");
    const { label, neutral, experts } = parts(el);
    expect(cls(label)).toBe("label");
    expect(kids(label)).toBe("Voice");
    expect(neutral.type).toBe(Chip);
    expect(kids(neutral)).toBe("Neutral");
    expect(experts).toHaveLength(2);
    expect(experts[0].type).toBe(Chip);
  });

  it("marks the Neutral chip active when no expert is selected (default)", () => {
    const el = ChatVoicePicker({ options: opts, onSelect: noop }) as ReactElement;
    const { neutral, experts } = parts(el);
    expect((neutral.props as { active?: unknown }).active).toBe(true);
    expect((experts[0].props as { active?: unknown }).active).toBe(false);
    expect((experts[1].props as { active?: unknown }).active).toBe(false);
  });

  it("marks the matching expert chip active and de-activates Neutral", () => {
    const el = ChatVoicePicker({ options: opts, activeId: "an", onSelect: noop }) as ReactElement;
    const { neutral, experts } = parts(el);
    expect((neutral.props as { active?: unknown }).active).toBe(false);
    expect((experts[0].props as { active?: unknown }).active).toBe(false);
    expect((experts[1].props as { active?: unknown }).active).toBe(true);
  });

  it("fires onSelect with the expert id ('' for Neutral) when a chip is chosen", () => {
    const onSelect = jest.fn();
    const el = ChatVoicePicker({ options: opts, activeId: "jp", onSelect }) as ReactElement;
    const { neutral, experts } = parts(el);
    (neutral.props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenLastCalledWith("");
    (experts[1].props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenLastCalledWith("an");
  });

  it("carries an expert-colored avatar with initials inside each expert chip", () => {
    const el = ChatVoicePicker({ options: opts, onSelect: noop }) as ReactElement;
    const { experts } = parts(el);
    const [avatar, name] = kids(experts[0]) as [ReactElement, string];
    expect(cls(avatar)).toMatch(/^avatar chat-voice-avatar tone-/);
    expect(kids(avatar)).toBe("JP");
    expect(name).toBe("James Pierce");
  });

  it("disables every chip when disabled (no voice change mid-stream)", () => {
    const el = ChatVoicePicker({ options: opts, onSelect: noop, disabled: true }) as ReactElement;
    const { neutral, experts } = parts(el);
    expect((neutral.props as { disabled?: unknown }).disabled).toBe(true);
    expect((experts[0].props as { disabled?: unknown }).disabled).toBe(true);
  });
});

describe("ChatUserIdentity — header avatar + name + EN/VI language badge (M12.3.3)", () => {
  /** Destructure the identity strip's children: [avatar, name, langBadge]. */
  const parts = (el: ReactElement) => {
    const [avatar, name, lang] = kids(el) as [ReactElement, ReactElement, ReactElement];
    return { avatar, name, lang };
  };

  it("renders the `.chat-user-identity` with an expert-toned avatar, the name, and a language badge", () => {
    const el = ChatUserIdentity({ name: "James Pierce", language: "en" }) as ReactElement;
    expect(cls(el)).toBe("chat-user-identity");
    const { avatar, name, lang } = parts(el);
    expect(cls(avatar)).toMatch(/^avatar chat-user-avatar tone-/);
    expect(kids(avatar)).toBe("JP");
    expect(cls(name)).toBe("chat-user-name");
    expect(kids(name)).toBe("James Pierce");
    expect(kids(lang)).toBe("EN");
  });

  it("shows the VI label when the language is Vietnamese", () => {
    const el = ChatUserIdentity({ name: "Anh Nguyen", language: "vi" }) as ReactElement;
    expect(kids(parts(el).lang)).toBe("VI");
  });

  it("falls back to the email local part for the name and initials when there is no display name", () => {
    const el = ChatUserIdentity({ email: "eric@gmail.com", language: "en" }) as ReactElement;
    const { avatar, name } = parts(el);
    expect(kids(name)).toBe("eric");
    expect(kids(avatar)).toBe("E");
  });

  it("falls back to 'You' when neither name nor email is given", () => {
    const el = ChatUserIdentity({ language: "en" }) as ReactElement;
    expect(kids(parts(el).name)).toBe("You");
  });

  it("renders the language as an interactive `.badge.badge-ink` button that toggles on click", () => {
    const onLanguageToggle = jest.fn();
    const el = ChatUserIdentity({ name: "Jo", language: "en", onLanguageToggle }) as ReactElement;
    const { lang } = parts(el);
    expect(lang.type).toBe("button");
    expect(cls(lang)).toBe("badge badge-ink chat-user-lang");
    (lang.props as { onClick: () => void }).onClick();
    expect(onLanguageToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the language as a static `.badge` span when no toggle handler is given", () => {
    const el = ChatUserIdentity({ name: "Jo", language: "en" }) as ReactElement;
    expect(parts(el).lang.type).toBe("span");
  });
});

describe("ChatUserMessage — user bubble (M12.4.1)", () => {
  /** The single bubble child of the `.msg-user` row. */
  const bubble = (el: ReactElement) => kids(el) as ReactElement;

  it("renders the dark `.msg-user-bubble` right-aligned by default", () => {
    const el = ChatUserMessage({ content: "How do I price my SaaS?" }) as ReactElement;
    expect(cls(el)).toBe("msg-user");
    const b = bubble(el);
    expect(cls(b)).toBe("msg-user-bubble");
    expect(kids(b)).toBe("How do I price my SaaS?");
  });

  it("left-aligns the bubble with `.msg-user-start` when align='start'", () => {
    const el = ChatUserMessage({ content: "hi", align: "start" }) as ReactElement;
    expect(cls(el)).toBe("msg-user msg-user-start");
  });

  it("preserves the raw text (newlines kept by the CSS, not stripped here)", () => {
    const el = ChatUserMessage({ content: "line one\nline two" }) as ReactElement;
    expect(kids(bubble(el))).toBe("line one\nline two");
  });
});

describe("ChatAssistantMessage — assistant header + body (M12.4.2)", () => {
  /** Destructure the message into its header and body regions. */
  const regions = (el: ReactElement) => {
    const [head, body] = kids(el) as [ReactElement, ReactElement];
    return { head, body };
  };
  /** The header children, with omitted (false) slots filtered out. */
  const headParts = (el: ReactElement): ReactElement[] =>
    (kids(regions(el).head) as unknown[]).filter((c): c is ReactElement => Boolean(c));

  it("renders the `.msg-assistant` container with an expert-toned avatar and bold name", () => {
    const el = ChatAssistantMessage({ expertName: "John-Ngo" }) as ReactElement;
    expect(cls(el)).toBe("msg-assistant");
    const [avatar, name] = headParts(el);
    expect(cls(avatar)).toMatch(/^avatar msg-assistant-avatar tone-/);
    expect(kids(avatar)).toBe("JN");
    expect(cls(name)).toBe("msg-assistant-name");
    expect(kids(name)).toBe("John-Ngo");
  });

  it("renders children in the `.msg-assistant-body`", () => {
    const el = ChatAssistantMessage({ expertName: "Jo", children: "answer prose" }) as ReactElement;
    const { body } = regions(el);
    expect(cls(body)).toBe("msg-assistant-body");
    expect(kids(body)).toBe("answer prose");
  });

  it("shows the `.badge-ink` 'AI rendition' disclosure with the M2.2 attribution aria-label", () => {
    const el = ChatAssistantMessage({ expertName: "John-Ngo", aiRendition: true }) as ReactElement;
    const rendition = headParts(el).find((c) => /badge-ink/.test(String(cls(c))));
    expect(rendition).toBeDefined();
    expect(kids(rendition as ReactElement)).toBe("AI rendition");
    expect((rendition as ReactElement).props as { "aria-label": string }).toMatchObject({
      "aria-label": "AI rendition of John-Ngo",
    });
  });

  it("omits the rendition badge by default", () => {
    const el = ChatAssistantMessage({ expertName: "Jo" }) as ReactElement;
    expect(headParts(el).some((c) => /badge-ink/.test(String(cls(c))))).toBe(false);
  });

  it("renders a mono source label when provided", () => {
    const el = ChatAssistantMessage({
      expertName: "Jo",
      sourceLabel: "grounded in published knowledge + your upload",
    }) as ReactElement;
    const source = headParts(el).find((c) => /msg-assistant-source/.test(String(cls(c))));
    expect(cls(source as ReactElement)).toBe("msg-assistant-source muted");
    expect(kids(source as ReactElement)).toBe("grounded in published knowledge + your upload");
  });

  it("renders the right-aligned green 'Verified' badge only when verified", () => {
    const off = ChatAssistantMessage({ expertName: "Jo" }) as ReactElement;
    expect(headParts(off).some((c) => /msg-assistant-verified/.test(String(cls(c))))).toBe(false);
    const on = ChatAssistantMessage({ expertName: "Jo", verified: true }) as ReactElement;
    const badge = headParts(on).find((c) => /msg-assistant-verified/.test(String(cls(c))));
    expect(cls(badge as ReactElement)).toBe("badge badge-green msg-assistant-verified");
  });

  it("falls back to a neutral 'Assistant' author with no tone for an expert-less answer", () => {
    const el = ChatAssistantMessage({}) as ReactElement;
    const [avatar, name] = headParts(el);
    expect(cls(avatar)).toBe("avatar msg-assistant-avatar");
    expect(kids(avatar)).toBe("A");
    expect(kids(name)).toBe("Assistant");
  });
});

describe("AnswerProse — answer prose + inline citations, render-after-resolve (M12.4.3)", () => {
  /** The `<p>` children as a flat array (a single child arrives un-wrapped). */
  const childArray = (el: ReactElement): unknown[] => {
    const c = kids(el);
    return Array.isArray(c) ? c : [c];
  };
  /** The first React-element child (a `.cite` chip); undefined when none resolved. */
  const firstCite = (el: ReactElement): ReactElement | undefined =>
    childArray(el).find((p): p is ReactElement => typeof p === "object" && p !== null);
  /** The text content, concatenating the plain-string runs. */
  const text = (el: ReactElement): string =>
    childArray(el)
      .filter((p): p is string => typeof p === "string")
      .join("");

  it("renders verbatim text (no chips) until interactive — render-after-resolve", () => {
    const el = AnswerProse({
      content: "Aim for a 12-month payback window [1].",
      citations: [{ ordinal: 1, variant: "knowledge" }],
      interactive: false,
    }) as ReactElement;
    expect(kids(el)).toBe("Aim for a 12-month payback window [1].");
    expect(firstCite(el)).toBeUndefined();
  });

  it("renders verbatim text when interactive but nothing has resolved yet", () => {
    const el = AnswerProse({
      content: "No grounded sources here [1].",
      citations: [],
      interactive: true,
    }) as ReactElement;
    expect(kids(el)).toBe("No grounded sources here [1].");
  });

  it("turns a resolved `[n]` marker into a crimson knowledge `.cite` chip, text preserved", () => {
    const el = AnswerProse({
      content: "Aim for 12 months [1].",
      citations: [{ ordinal: 1, variant: "knowledge" }],
      interactive: true,
    }) as ReactElement;
    const cite = firstCite(el) as ReactElement;
    expect(cite.props).toMatchObject({ label: 1, resolved: true, variant: "knowledge", role: "button" });
    expect(text(el)).toBe("Aim for 12 months .");
  });

  it("renders an uploaded source marker as the info-blue `.cite.upload` variant", () => {
    // Leading marker (no preceding text) also exercises the no-prefix branch.
    const el = AnswerProse({
      content: "[2] per your sheet.",
      citations: [{ ordinal: 2, variant: "upload" }],
      interactive: true,
    }) as ReactElement;
    expect((firstCite(el) as ReactElement).props).toMatchObject({ variant: "upload" });
    expect(text(el)).toBe(" per your sheet.");
  });

  it("leaves an unresolvable bracketed number as plain text (never a fake chip)", () => {
    const el = AnswerProse({
      content: "Hallucinated [9] but grounded [1].",
      citations: [{ ordinal: 1, variant: "knowledge" }],
      interactive: true,
    }) as ReactElement;
    const cites = childArray(el).filter((p) => typeof p === "object" && p !== null);
    expect(cites).toHaveLength(1);
    expect(text(el)).toContain("[9]");
  });

  it("invokes onCite on click and on Enter/Space keydown, ignoring other keys", () => {
    const seen: number[] = [];
    const el = AnswerProse({
      content: "x [1] y",
      citations: [{ ordinal: 1, variant: "knowledge" }],
      interactive: true,
      onCite: (o) => seen.push(o),
    }) as ReactElement;
    const props = (firstCite(el) as ReactElement).props as {
      onClick: () => void;
      onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
    };
    const ev = (key: string) => ({ key, preventDefault: () => {} });
    props.onClick();
    props.onKeyDown(ev("Enter"));
    props.onKeyDown(ev(" "));
    props.onKeyDown(ev("a"));
    expect(seen).toEqual([1, 1, 1]);
  });

  it("is a no-op (no throw) when activated without an onCite handler", () => {
    const el = AnswerProse({
      content: "x [1]",
      citations: [{ ordinal: 1, variant: "knowledge" }],
      interactive: true,
    }) as ReactElement;
    const props = (firstCite(el) as ReactElement).props as {
      onClick: () => void;
      onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
    };
    expect(() => {
      props.onClick();
      props.onKeyDown({ key: "Enter", preventDefault: () => {} });
    }).not.toThrow();
  });
});

describe("ChatSearch — conversation search input (M12.2.2)", () => {
  const noop = () => {};
  const hit = (over: Partial<ChatSearchResultItem> = {}): ChatSearchResultItem => ({
    id: "c1",
    title: "Franchise unit economics",
    snippet: "the «break-even» point is…",
    ...over,
  });

  /** The controlled `.input` element inside the search field. */
  const inputOf = (el: ReactElement): ReactElement => {
    const [field] = kids(el) as ReactElement[];
    return (kids(field) as ReactElement[])[1];
  };

  it("renders the dark search field with no results region for an empty query", () => {
    const el = ChatSearch({
      query: "",
      onQueryChange: noop,
      results: [],
      onSelect: noop,
    }) as ReactElement;
    expect(cls(el)).toBe("chat-search");
    const [field, resultsRegion] = kids(el) as unknown[];
    expect(cls(field as ReactElement)).toBe("chat-search-field");
    const input = inputOf(el);
    expect(cls(input)).toBe("chat-search-input");
    expect((input.props as { placeholder?: unknown }).placeholder).toBe("Search all messages…");
    expect((input.props as { value?: unknown }).value).toBe("");
    // Results region is suppressed until the user types.
    expect(resultsRegion).toBeFalsy();
  });

  it("wires the input onChange to onQueryChange", () => {
    const seen: string[] = [];
    const input = inputOf(
      ChatSearch({
        query: "fr",
        onQueryChange: (q) => seen.push(q),
        results: [],
        onSelect: noop,
      }) as ReactElement,
    );
    const onChange = (input.props as { onChange?: (e: unknown) => void }).onChange!;
    onChange({ target: { value: "fra" } });
    expect(seen).toEqual(["fra"]);
  });

  it("shows a searching note while a request is in flight with no results yet", () => {
    const el = ChatSearch({
      query: "fra",
      onQueryChange: noop,
      results: [],
      searching: true,
      onSelect: noop,
    }) as ReactElement;
    const [, region] = kids(el) as ReactElement[];
    expect(cls(region)).toBe("chat-search-results");
    const empty = kids(region) as ReactElement;
    expect(cls(empty)).toBe("chat-search-empty muted");
    expect(kids(empty)).toBe("Searching…");
  });

  it("shows a no-matches note for a settled query with no hits", () => {
    const el = ChatSearch({
      query: "zzz",
      onQueryChange: noop,
      results: [],
      searching: false,
      onSelect: noop,
    }) as ReactElement;
    const [, region] = kids(el) as ReactElement[];
    expect(kids(kids(region) as ReactElement)).toBe("No matching conversations.");
  });

  it("renders each hit as a button with title + snippet, highlighting the active one", () => {
    const onSelect = jest.fn();
    const el = ChatSearch({
      query: "fr",
      onQueryChange: noop,
      results: [hit(), hit({ id: "c2", title: "Pricing", snippet: null })],
      onSelect,
      activeId: "c2",
    }) as ReactElement;
    const [, region] = kids(el) as ReactElement[];
    const [first, second] = kids(region) as ReactElement[];
    // Inactive hit: title + snippet, no active modifier.
    expect(cls(first)).toBe("chat-search-item");
    const [title, snippet] = kids(first) as ReactElement[];
    expect(cls(title as ReactElement)).toBe("chat-search-title");
    expect(kids(title as ReactElement)).toBe("Franchise unit economics");
    expect(cls(snippet as ReactElement)).toBe("chat-search-snippet");
    // Active hit gets the modifier; a null snippet is omitted.
    expect(cls(second)).toBe("chat-search-item active");
    const secondKids = kids(second) as unknown[];
    expect(secondKids[1]).toBeFalsy();
    // onSelect fires with the conversation id.
    (first.props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});

describe("ChatConversationList — RECENT history list (M12.2.3)", () => {
  const noop = () => {};
  const item = (over: Partial<ChatConversationItem> = {}): ChatConversationItem => ({
    id: "c1",
    title: "Franchise unit economics",
    expertName: "James Pierce",
    updatedAt: "2026-06-02T10:00:00.000Z",
    ...over,
  });

  describe("avatarInitials", () => {
    it("takes up to two uppercase initials, splitting on spaces and hyphens", () => {
      expect(avatarInitials("James Pierce")).toBe("JP");
      expect(avatarInitials("John-Ngo")).toBe("JN");
      expect(avatarInitials("anh nguyen tran")).toBe("AN");
      expect(avatarInitials("Cher")).toBe("C");
    });

    it("falls back to '?' for a missing or blank name", () => {
      expect(avatarInitials(null)).toBe("?");
      expect(avatarInitials(undefined)).toBe("?");
      expect(avatarInitials("   ")).toBe("?");
    });
  });

  describe("avatarTone", () => {
    it("is deterministic and always one of the palette tones", () => {
      for (const seed of ["James Pierce", "Anh Nguyen", "x", ""]) {
        const tone = avatarTone(seed);
        expect(avatarTone(seed)).toBe(tone);
        expect(AVATAR_TONES).toContain(tone);
      }
    });
  });

  describe("relativeTime", () => {
    const now = Date.parse("2026-06-02T12:00:00.000Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const MIN = 60_000;
    const HR = 60 * MIN;
    const DAY = 24 * HR;

    it("renders each bucket from 'Now' through an absolute date", () => {
      expect(relativeTime(ago(30_000), now)).toBe("Now");
      expect(relativeTime(ago(5 * MIN), now)).toBe("5m ago");
      expect(relativeTime(ago(3 * HR), now)).toBe("3h ago");
      expect(relativeTime(ago(DAY + HR), now)).toBe("Yesterday");
      // 3 days back → a weekday short name (locale-formatted, never empty).
      expect(relativeTime(ago(3 * DAY), now)).toBe(
        new Date(now - 3 * DAY).toLocaleDateString(undefined, { weekday: "short" }),
      );
      expect(relativeTime(ago(9 * DAY), now)).toBe("Last week");
      expect(relativeTime(ago(40 * DAY), now)).toBe(
        new Date(now - 40 * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      );
    });

    it("guards an unparseable timestamp with an empty string", () => {
      expect(relativeTime("not-a-date", now)).toBe("");
    });
  });

  it("renders the RECENT navgroup label over the rows", () => {
    const el = ChatConversationList({ items: [item()], onSelect: noop }) as ReactElement;
    expect(cls(el)).toBe("chat-convos");
    const [group] = kids(el) as ReactElement[];
    expect(cls(group)).toBe("navgroup");
    expect(kids(group)).toBe("Recent");
  });

  it("shows the loading vs settled empty note when there are no conversations", () => {
    const loadingEl = ChatConversationList({ items: [], onSelect: noop, loading: true }) as ReactElement;
    const [, loadingNote] = kids(loadingEl) as ReactElement[];
    expect(cls(loadingNote)).toBe("chat-convos-empty muted");
    expect(kids(loadingNote)).toBe("Loading…");

    const settledEl = ChatConversationList({ items: [], onSelect: noop }) as ReactElement;
    const [, settledNote] = kids(settledEl) as ReactElement[];
    expect(kids(settledNote)).toBe("No conversations yet.");
  });

  it("renders an avatar (toned initials), title, and relative time per row; active is highlighted", () => {
    const el = ChatConversationList({
      items: [item(), item({ id: "c2", title: "Pricing", expertName: null })],
      activeId: "c2",
      onSelect: noop,
    }) as ReactElement;
    const [, rows] = kids(el) as [unknown, ReactElement[]];
    const [first, second] = rows;

    // Row 1: expert-toned avatar with initials.
    expect(cls(first)).toBe("navitem chat-convo");
    const [avatar, main] = kids(first) as ReactElement[];
    expect(cls(avatar)).toBe(`avatar chat-convo-avatar tone-${avatarTone("James Pierce")}`);
    expect(kids(avatar)).toBe("JP");
    const [title, time] = kids(main as ReactElement) as ReactElement[];
    expect(cls(title)).toBe("chat-convo-title");
    expect(kids(title)).toBe("Franchise unit economics");
    expect(cls(time)).toBe("chat-convo-time");

    // Row 2: neutral (no expert) avatar drops the tone class; active gets the modifier.
    expect(cls(second)).toBe("navitem chat-convo active");
    const [avatar2] = kids(second) as ReactElement[];
    expect(cls(avatar2)).toBe("avatar chat-convo-avatar");
    expect(kids(avatar2)).toBe("?");
  });

  it("fires onSelect with the conversation id and shows the unread dot only when set", () => {
    const onSelect = jest.fn();
    const el = ChatConversationList({
      items: [item({ unread: true }), item({ id: "c2", unread: false })],
      onSelect,
    }) as ReactElement;
    const [, rows] = kids(el) as [unknown, ReactElement[]];
    const [first, second] = rows;
    expect(cls((kids(first) as unknown[])[2] as ReactElement)).toBe("chat-convo-dot");
    expect((kids(second) as unknown[])[2]).toBeFalsy();
    (first.props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});

describe("layout direction — switcher state (M12.1.3)", () => {
  it("lists the three directions in `.seg` order with studio as the default", () => {
    expect(LAYOUT_DIRECTIONS).toEqual(["classic", "studio", "focus"]);
    expect(DEFAULT_LAYOUT_DIRECTION).toBe("studio");
  });

  it("maps each direction to its persistent-grid panes", () => {
    expect(layoutPanes("studio")).toEqual({ sidebar: true, rail: true });
    expect(layoutPanes("classic")).toEqual({ sidebar: true, rail: false });
    expect(layoutPanes("focus")).toEqual({ sidebar: false, rail: false });
  });

  it("exposes a label + one-line description for every direction", () => {
    for (const d of LAYOUT_DIRECTIONS) {
      expect(LAYOUT_DIRECTION_INFO[d].label.length).toBeGreaterThan(0);
      expect(LAYOUT_DIRECTION_INFO[d].description.length).toBeGreaterThan(0);
    }
  });

  it("guards persisted values (only the three directions are valid)", () => {
    expect(isLayoutDirection("studio")).toBe(true);
    expect(isLayoutDirection("classic")).toBe(true);
    expect(isLayoutDirection("focus")).toBe(true);
    expect(isLayoutDirection("wide")).toBe(false);
    expect(isLayoutDirection(null)).toBe(false);
    expect(isLayoutDirection(2)).toBe(false);
  });
});

describe("ChatAnswerActions — answer action bar (M12.4.4)", () => {
  const noop = () => {};
  /** The `.msg-actions-bar` row (first child of `.msg-actions`). */
  const bar = (el: ReactElement): ReactElement => (kids(el) as unknown[])[0] as ReactElement;
  /** The three conditional slots of the bar: [view-sources, save, feedback-fragment]. */
  const barKids = (el: ReactElement): unknown[] => kids(bar(el)) as unknown[];

  it("wraps a `.msg-actions-bar` row inside `.msg-actions`, with follow-up content below", () => {
    const el = ChatAnswerActions({ children: "reason field" }) as ReactElement;
    expect(cls(el)).toBe("msg-actions");
    const [row, below] = kids(el) as unknown[];
    expect(cls(row as ReactElement)).toBe("msg-actions-bar");
    expect(below).toBe("reason field");
  });

  it("renders the ghost 'View sources (N)' toggle only with resolved sources + a handler", () => {
    const onToggleSources = jest.fn();
    const el = ChatAnswerActions({
      sourceCount: 3,
      sourcesOpen: true,
      onToggleSources,
    }) as ReactElement;
    const view = barKids(el)[0] as ReactElement;
    expect(view.type).toBe(Button);
    expect((view.props as { variant?: unknown }).variant).toBe("ghost");
    expect((view.props as { "aria-expanded"?: unknown })["aria-expanded"]).toBe(true);
    expect((view.props as { "aria-pressed"?: unknown })["aria-pressed"]).toBe(true);
    (view.props as { onClick: () => void }).onClick();
    expect(onToggleSources).toHaveBeenCalledTimes(1);
  });

  it("defaults the toggle to not-open (aria-expanded false) when sourcesOpen is omitted", () => {
    const el = ChatAnswerActions({ sourceCount: 1, onToggleSources: noop }) as ReactElement;
    const view = barKids(el)[0] as ReactElement;
    expect((view.props as { "aria-expanded"?: unknown })["aria-expanded"]).toBe(false);
  });

  it("omits the View-sources toggle with no resolved sources or no handler", () => {
    expect(
      barKids(ChatAnswerActions({ sourceCount: 0, onToggleSources: noop }) as ReactElement)[0],
    ).toBeFalsy();
    expect(barKids(ChatAnswerActions({ sourceCount: 3 }) as ReactElement)[0]).toBeFalsy();
  });

  it("renders a ghost Save button that flips to a static 'Saved' badge once bookmarked", () => {
    const onSave = jest.fn();
    const save = barKids(ChatAnswerActions({ onSave }) as ReactElement)[1] as ReactElement;
    expect(save.type).toBe(Button);
    expect((save.props as { variant?: unknown }).variant).toBe("ghost");
    expect(kids(save)).toBe("Save");
    (save.props as { onClick: () => void }).onClick();
    expect(onSave).toHaveBeenCalledTimes(1);

    const saved = barKids(
      ChatAnswerActions({ onSave, saved: true }) as ReactElement,
    )[1] as ReactElement;
    expect(saved.type).toBe("span");
    expect(cls(saved)).toBe("badge badge-green");
    expect(kids(saved)).toBe("Saved");
  });

  it("omits the Save control without a handler", () => {
    expect(barKids(ChatAnswerActions({}) as ReactElement)[1]).toBeFalsy();
  });

  it("renders Yes/No feedback buttons, promoting the helpful verdict, with intent aria-labels", () => {
    const onFeedback = jest.fn();
    const frag = barKids(
      ChatAnswerActions({ onFeedback, verdict: true }) as ReactElement,
    )[2] as ReactElement;
    const [yes, no] = kids(frag) as ReactElement[];
    expect((yes.props as { variant?: unknown }).variant).toBe("primary");
    expect((yes.props as { "aria-label"?: unknown })["aria-label"]).toBe("Helpful");
    expect((yes.props as { "aria-pressed"?: unknown })["aria-pressed"]).toBe(true);
    expect(kids(yes)).toBe("Yes");
    expect((no.props as { variant?: unknown }).variant).toBe("subtle");
    expect((no.props as { "aria-label"?: unknown })["aria-label"]).toBe("Not helpful");
    expect(kids(no)).toBe("No");
    (yes.props as { onClick: () => void }).onClick();
    expect(onFeedback).toHaveBeenCalledWith(true);
    (no.props as { onClick: () => void }).onClick();
    expect(onFeedback).toHaveBeenCalledWith(false);
  });

  it("promotes the not-helpful verdict to dark and leaves Yes subtle", () => {
    const frag = barKids(
      ChatAnswerActions({ onFeedback: noop, verdict: false }) as ReactElement,
    )[2] as ReactElement;
    const [yes, no] = kids(frag) as ReactElement[];
    expect((yes.props as { variant?: unknown }).variant).toBe("subtle");
    expect((no.props as { variant?: unknown }).variant).toBe("dark");
  });

  it("omits the feedback buttons without a handler", () => {
    expect(barKids(ChatAnswerActions({}) as ReactElement)[2]).toBeFalsy();
  });

  it("disables Save + feedback (both subtle by default) while their requests are in flight", () => {
    const el = ChatAnswerActions({
      onSave: noop,
      onFeedback: noop,
      saveBusy: true,
      feedbackBusy: true,
    }) as ReactElement;
    expect((barKids(el)[1] as ReactElement).props as { disabled?: unknown }).toMatchObject({
      disabled: true,
    });
    const [yes, no] = kids(barKids(el)[2] as ReactElement) as ReactElement[];
    expect((yes.props as { variant?: unknown }).variant).toBe("subtle");
    expect((yes.props as { disabled?: unknown }).disabled).toBe(true);
    expect((no.props as { disabled?: unknown }).disabled).toBe(true);
  });
});

describe("ChatConsultationCard — consultation recommendation card (M12.4.5)", () => {
  const noop = () => {};
  /** [head, descriptionOrFalse, actions, children] children of `.consult-card`. */
  const parts = (el: ReactElement): unknown[] => kids(el) as unknown[];
  /** The three action slots: [book, maybe-later, ask-another]. */
  const actionKids = (el: ReactElement): unknown[] =>
    kids(parts(el)[2] as ReactElement) as unknown[];

  it("renders a warm `.consult-card` with the default heading + description + children", () => {
    const el = ChatConsultationCard({
      description: "Let's dig in.",
      children: "err",
    }) as ReactElement;
    expect(cls(el)).toBe("consult-card");
    const [head, desc, , children] = parts(el);
    const title = (kids(head as ReactElement) as unknown[])[1] as ReactElement;
    expect(cls(title)).toBe("consult-card-title");
    expect(kids(title)).toBe("This looks worth a working session");
    expect(cls(desc as ReactElement)).toBe("consult-card-desc");
    expect(kids(desc as ReactElement)).toBe("Let's dig in.");
    expect(children).toBe("err");
  });

  it("omits the description paragraph when none is given", () => {
    expect(parts(ChatConsultationCard({}) as ReactElement)[1]).toBeFalsy();
  });

  it("renders the Book primary action with the supplied label + handler", () => {
    const onBook = jest.fn();
    const book = actionKids(
      ChatConsultationCard({ bookLabel: "Book with John", onBook }) as ReactElement,
    )[0] as ReactElement;
    expect(book.type).toBe(Button);
    expect((book.props as { variant?: unknown }).variant).toBe("primary");
    expect(kids(book)).toBe("Book with John");
    (book.props as { onClick: () => void }).onClick();
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("defaults the Book label to 'Book a consultation'", () => {
    const book = actionKids(ChatConsultationCard({ onBook: noop }) as ReactElement)[0] as ReactElement;
    expect(kids(book)).toBe("Book a consultation");
  });

  it("renders ghost Maybe-later + Ask-another actions with their handlers", () => {
    const onMaybeLater = jest.fn();
    const onAskAnother = jest.fn();
    const [, maybe, ask] = actionKids(
      ChatConsultationCard({ onMaybeLater, onAskAnother }) as ReactElement,
    ) as ReactElement[];
    expect((maybe.props as { variant?: unknown }).variant).toBe("ghost");
    expect(kids(maybe)).toBe("Maybe later");
    expect((ask.props as { variant?: unknown }).variant).toBe("ghost");
    expect(kids(ask)).toBe("Ask another question");
    (maybe.props as { onClick: () => void }).onClick();
    (ask.props as { onClick: () => void }).onClick();
    expect(onMaybeLater).toHaveBeenCalledTimes(1);
    expect(onAskAnother).toHaveBeenCalledTimes(1);
  });

  it("omits each action whose callback is not supplied", () => {
    const [book, maybe, ask] = actionKids(ChatConsultationCard({}) as ReactElement);
    expect(book).toBeFalsy();
    expect(maybe).toBeFalsy();
    expect(ask).toBeFalsy();
  });

  it("disables all actions while busy", () => {
    const el = ChatConsultationCard({
      onBook: noop,
      onMaybeLater: noop,
      onAskAnother: noop,
      busy: true,
    }) as ReactElement;
    for (const action of actionKids(el) as ReactElement[]) {
      expect((action.props as { disabled?: unknown }).disabled).toBe(true);
    }
  });
});

describe("ChatStateNotice — answer-state cards/badge (M12.4.6)", () => {
  /** [head, body] children of the `.msg-notice` card. */
  const cardParts = (el: ReactElement): unknown[] => kids(el) as unknown[];
  /** [badge, headingOrFalse] children of `.msg-notice-head`. */
  const headParts = (el: ReactElement): unknown[] =>
    kids(cardParts(el)[0] as ReactElement) as unknown[];

  it("renders an amber card with a tone-matched badge label + body (insufficient knowledge)", () => {
    const el = ChatStateNotice({
      tone: "amber",
      label: "Limited knowledge",
      children: "Try rephrasing.",
    }) as ReactElement;
    expect(cls(el)).toBe("msg-notice tone-amber");
    const [badge, heading] = headParts(el);
    expect(cls(badge as ReactElement)).toBe("badge badge-amber");
    expect(kids(badge as ReactElement)).toBe("Limited knowledge");
    expect(heading).toBeFalsy();
    const body = cardParts(el)[1] as ReactElement;
    expect(cls(body)).toBe("msg-notice-body");
    expect(kids(body)).toBe("Try rephrasing.");
  });

  it("renders an optional display heading in the card head", () => {
    const el = ChatStateNotice({
      tone: "amber",
      label: "Important",
      heading: "Read this first",
      children: "Disclaimer.",
    }) as ReactElement;
    const heading = headParts(el)[1] as ReactElement;
    expect(cls(heading)).toBe("msg-notice-title");
    expect(kids(heading)).toBe("Read this first");
  });

  it("omits the body paragraph when no children are given", () => {
    const el = ChatStateNotice({ tone: "amber", label: "Important" }) as ReactElement;
    expect(cardParts(el)[1]).toBeFalsy();
  });

  it("renders the `note` variant as a compact badge + muted text (fair-use degrade)", () => {
    const el = ChatStateNotice({
      tone: "info",
      label: "Fair-use mode",
      variant: "note",
      children: "Lighter model.",
    }) as ReactElement;
    expect(cls(el)).toBe("msg-note");
    const [badge, text] = kids(el) as ReactElement[];
    expect(cls(badge)).toBe("badge badge-info");
    expect(kids(badge)).toBe("Fair-use mode");
    expect(cls(text)).toBe("muted");
    expect(kids(text)).toBe("Lighter model.");
  });

  it("omits the muted text in the `note` variant when no children are given", () => {
    const el = ChatStateNotice({
      tone: "info",
      label: "Fair-use mode",
      variant: "note",
    }) as ReactElement;
    expect((kids(el) as unknown[])[1]).toBeFalsy();
  });
});

describe("SourcesRail — right-panel container (M12.5.1)", () => {
  /** The container's children with omitted (null/false) slots filtered out. */
  const parts = (el: ReactElement): ReactElement[] =>
    (kids(el) as unknown[]).filter((c): c is ReactElement => Boolean(c));

  it("renders the scrollable `.sources-rail` container", () => {
    const el = SourcesRail({}) as ReactElement;
    expect(cls(el)).toBe("sources-rail");
  });

  it("shows the muted empty state when there are no source cards", () => {
    const el = SourcesRail({}) as ReactElement;
    const [empty] = parts(el);
    expect(cls(empty)).toBe("sources-rail-empty muted");
    expect(kids(empty)).toMatch(/will appear here/);
  });

  it("honors a custom empty label", () => {
    const el = SourcesRail({ emptyLabel: "Pick an answer to see its sources." }) as ReactElement;
    expect(kids(parts(el)[0])).toBe("Pick an answer to see its sources.");
  });

  it("renders the cards body (and no empty state) when children are given", () => {
    const el = SourcesRail({ children: "card" }) as ReactElement;
    const [body] = parts(el);
    expect(cls(body)).toBe("sources-rail-body");
    expect(kids(body)).toBe("card");
    expect(parts(el).some((c) => /sources-rail-empty/.test(String(cls(c))))).toBe(false);
  });

  it("renders the header slot above the body/empty state", () => {
    const el = SourcesRail({ header: "SOURCES", children: "card" }) as ReactElement;
    const [head, body] = parts(el);
    expect(cls(head)).toBe("sources-rail-head");
    expect(kids(head)).toBe("SOURCES");
    expect(cls(body)).toBe("sources-rail-body");
  });

  it("omits the header region when no header is given", () => {
    const el = SourcesRail({ children: "card" }) as ReactElement;
    expect(parts(el).some((c) => /sources-rail-head/.test(String(cls(c))))).toBe(false);
  });
});

describe("SourcesRailHeader — SOURCES label + count + trust badge (M12.5.2)", () => {
  /** Non-falsy children of the `.sources-rail-title` container. */
  const parts = (el: ReactElement): ReactElement[] =>
    (kids(el) as unknown[]).filter((c): c is ReactElement => Boolean(c));
  /** Non-falsy children of the title row (the SOURCES label + optional count). */
  const rowParts = (el: ReactElement): ReactElement[] =>
    (kids(parts(el)[0]) as unknown[]).filter((c): c is ReactElement => Boolean(c));

  it("renders the `.sources-rail-title` container with the SOURCES `.label`", () => {
    const el = SourcesRailHeader({ count: 0 }) as ReactElement;
    expect(cls(el)).toBe("sources-rail-title");
    const [label] = rowParts(el);
    expect(cls(label)).toBe("label");
    expect(kids(label)).toBe("Sources");
  });

  it("hides the passage count and trust badge before any citation resolves (count 0)", () => {
    const el = SourcesRailHeader({ count: 0 }) as ReactElement;
    // Only the title row is present — no count chip, no trust badge.
    expect(parts(el)).toHaveLength(1);
    expect(rowParts(el)).toHaveLength(1);
  });

  it("shows the mono passage count once resolved (singular vs plural)", () => {
    const one = SourcesRailHeader({ count: 1 }) as ReactElement;
    const count1 = rowParts(one)[1];
    expect(cls(count1)).toBe("sources-rail-count mono muted");
    expect(kids(count1)).toBe("1 passage");

    const many = SourcesRailHeader({ count: 3 }) as ReactElement;
    expect(kids(rowParts(many)[1])).toBe("3 passages");
  });

  it("renders the outlined-crimson `.trust-badge` only once at least one citation resolved", () => {
    const el = SourcesRailHeader({ count: 2 }) as ReactElement;
    const badge = parts(el)[1];
    expect(cls(badge)).toBe("trust-badge");
    // svg checkmark + the trust copy.
    const badgeKids = (kids(badge) as unknown[]).filter(Boolean);
    expect(badgeKids).toContain("All citations resolved to a real chunk");
  });

  it("honors a custom trust label", () => {
    const el = SourcesRailHeader({ count: 1, trustLabel: "Every passage verified" }) as ReactElement;
    const badge = parts(el)[1];
    const badgeKids = (kids(badge) as unknown[]).filter(Boolean);
    expect(badgeKids).toContain("Every passage verified");
  });
});

describe("SourceCard — numbered, colour-coded rail citation card (M12.5.3)", () => {
  /** Non-falsy children of the card (the head + optional provenance + excerpt). */
  const parts = (el: ReactElement): ReactElement[] =>
    (kids(el) as unknown[]).filter((c): c is ReactElement => Boolean(c));
  /** Non-falsy children of the `.source-card-head` row. */
  const headParts = (el: ReactElement): ReactElement[] =>
    (kids(parts(el)[0]) as unknown[]).filter((c): c is ReactElement => Boolean(c));

  it("renders a static `.source-card` div with the numbered marker, title, provenance, excerpt", () => {
    const el = SourceCard({
      ordinal: 1,
      kind: "knowledge",
      title: "Published knowledge",
      provenance: "doc-version-abc",
      excerpt: "Payback windows are typically 18 months.",
    }) as ReactElement;
    expect(el.type).toBe("div");
    expect(cls(el)).toBe("source-card");
    const [marker, title] = headParts(el);
    // The marker is a Cite sub-element (rendered later) — assert on its props:
    // crimson knowledge variant, resolved, carrying the ordinal as its label.
    expect(marker.type).toBe(Cite);
    expect(marker.props).toMatchObject({ label: 1, variant: "knowledge", resolved: true });
    expect(cls(title)).toBe("source-card-title");
    expect(kids(title)).toBe("Published knowledge");
    const [, prov, quote] = parts(el);
    expect(cls(prov)).toBe("source-prov");
    expect(kids(prov)).toBe("doc-version-abc");
    expect(cls(quote)).toBe("source-quote");
    expect(kids(quote)).toBe("Payback windows are typically 18 months.");
  });

  it("renders an upload card with the info-blue marker (knowledge vs upload never mixed)", () => {
    const el = SourceCard({ ordinal: 2, kind: "upload", title: "budget.xlsx" }) as ReactElement;
    expect(cls(el)).toBe("source-card upload");
    const marker = headParts(el)[0];
    expect(marker.type).toBe(Cite);
    expect(marker.props).toMatchObject({ variant: "upload" });
  });

  it("renders the version badge with a kind-matched tone (red knowledge / info upload)", () => {
    const know = SourceCard({ ordinal: 1, kind: "knowledge", title: "x", version: "V4" }) as ReactElement;
    const knowBadge = headParts(know).find((c) => c.type === Badge);
    expect((knowBadge as ReactElement).props).toMatchObject({ tone: "red", children: "V4" });

    const up = SourceCard({ ordinal: 1, kind: "upload", title: "x", version: "TEMP" }) as ReactElement;
    const upBadge = headParts(up).find((c) => c.type === Badge);
    expect((upBadge as ReactElement).props).toMatchObject({ tone: "info", children: "TEMP" });
  });

  it("shows the rounded mono match percentage only when a finite number is given", () => {
    const off = SourceCard({ ordinal: 1, kind: "knowledge", title: "x" }) as ReactElement;
    expect(headParts(off).some((c) => /source-card-match/.test(String(cls(c))))).toBe(false);

    const on = SourceCard({ ordinal: 1, kind: "knowledge", title: "x", matchPercent: 87.6 }) as ReactElement;
    const match = headParts(on).find((c) => /source-card-match/.test(String(cls(c))));
    expect(cls(match as ReactElement)).toBe("source-card-match mono muted");
    expect((kids(match as ReactElement) as unknown[]).join("")).toBe("88% match");
  });

  it("omits the provenance and excerpt rows when absent", () => {
    const el = SourceCard({ ordinal: 1, kind: "knowledge", title: "x" }) as ReactElement;
    // Only the head row survives the falsy filter.
    expect(parts(el)).toHaveLength(1);
    expect(cls(parts(el)[0])).toBe("source-card-head");
  });

  it("becomes a focusable button (click-to-passage) when onSelect is given, and reports active", () => {
    const seen: number[] = [];
    const el = SourceCard({
      ordinal: 3,
      kind: "knowledge",
      title: "x",
      active: true,
      onSelect: (o) => seen.push(o),
    }) as ReactElement;
    expect(el.type).toBe("button");
    expect(cls(el)).toBe("source-card active");
    const props = el.props as { onClick: () => void; "aria-pressed": boolean; type: string };
    expect(props.type).toBe("button");
    expect(props["aria-pressed"]).toBe(true);
    props.onClick();
    expect(seen).toEqual([3]);
  });

  it("uses the info-blue active highlight for an active upload card", () => {
    const el = SourceCard({
      ordinal: 1,
      kind: "upload",
      title: "x",
      active: true,
      onSelect: () => {},
    }) as ReactElement;
    expect(cls(el)).toBe("source-card upload active");
  });
});

describe("SourcesDrawer — slide-over sources fallback (M12.5.4)", () => {
  const noop = () => {};
  /** The `<aside>` panel inside the backdrop. */
  const panel = (el: ReactElement): ReactElement => kids(el) as ReactElement;
  /** Panel children: [close button, SourcesRail]. */
  const panelKids = (el: ReactElement): unknown[] => kids(panel(el)) as unknown[];

  it("renders nothing while closed", () => {
    expect(SourcesDrawer({ open: false, onClose: noop })).toBeNull();
  });

  it("renders a dimmed backdrop that dismisses on click", () => {
    const onClose = jest.fn();
    const el = SourcesDrawer({ open: true, onClose }) as ReactElement;
    expect(cls(el)).toBe("sources-drawer-backdrop");
    (el.props as { onClick: () => void }).onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a labelled modal dialog panel that keeps inner clicks from dismissing", () => {
    const onClose = jest.fn();
    const p = panel(SourcesDrawer({ open: true, onClose }) as ReactElement);
    expect(p.type).toBe("aside");
    const props = p.props as {
      className?: unknown;
      role?: unknown;
      "aria-modal"?: unknown;
      "aria-label"?: unknown;
      onClick: (e: { stopPropagation: () => void }) => void;
    };
    expect(props.className).toBe("sources-drawer");
    expect(props.role).toBe("dialog");
    expect(props["aria-modal"]).toBe("true");
    expect(props["aria-label"]).toBe("Sources");
    const stopPropagation = jest.fn();
    props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("accepts a custom accessible title", () => {
    const p = panel(SourcesDrawer({ open: true, onClose: noop, title: "Citations" }) as ReactElement);
    expect((p.props as { "aria-label"?: unknown })["aria-label"]).toBe("Citations");
  });

  it("dismisses on Escape but ignores other keys", () => {
    const onClose = jest.fn();
    const p = panel(SourcesDrawer({ open: true, onClose }) as ReactElement);
    const onKeyDown = (p.props as { onKeyDown: (e: { key: string }) => void }).onKeyDown;
    onKeyDown({ key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    onKeyDown({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a close button that dismisses", () => {
    const onClose = jest.fn();
    const close = panelKids(SourcesDrawer({ open: true, onClose }) as ReactElement)[0] as ReactElement;
    expect(close.type).toBe("button");
    const props = close.props as { className?: unknown; "aria-label"?: unknown; onClick: () => void };
    expect(props.className).toBe("sources-drawer-close");
    expect(props["aria-label"]).toBe("Close sources");
    props.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hosts the SourcesRail with the header + cards passed through", () => {
    const el = SourcesDrawer({
      open: true,
      onClose: noop,
      header: "SOURCES",
      emptyLabel: "none",
      children: "cards",
    }) as ReactElement;
    const rail = panelKids(el)[1] as ReactElement;
    expect(rail.type).toBe(SourcesRail);
    const props = rail.props as { header?: unknown; emptyLabel?: unknown; children?: unknown };
    expect(props.header).toBe("SOURCES");
    expect(props.emptyLabel).toBe("none");
    expect(props.children).toBe("cards");
  });
});
