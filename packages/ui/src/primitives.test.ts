import type { ReactElement } from "react";
import { Badge } from "./Badge";
import { Bar } from "./Bar";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { Cite } from "./Cite";
import { Content, Shell, Topbar } from "./Shell";
import { ChatLayout } from "./ChatLayout";
import { Field, Input, Select, Textarea } from "./Field";
import { Stat } from "./Stat";
import { Table } from "./Table";
import { UsageMeter } from "./UsageMeter";

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
    expect(cls(bare)).toBe("chat-layout");
    const [sidebar, main, rail] = kids(bare) as ReactElement[];
    // Omitted panes short-circuit to `false` so focus/classic directions drop them.
    expect(sidebar).toBe(false);
    expect(cls(main)).toBe("chat-main");
    expect((main.props as { children?: unknown }).children).toBe("chat");
    expect(rail).toBe(false);
  });

  it("renders the sidebar and sources rail when supplied", () => {
    const full = ChatLayout({ sidebar: "nav", rail: "sources", children: "chat" }) as ReactElement;
    const [sidebar, , rail] = kids(full) as ReactElement[];
    expect(cls(sidebar)).toBe("chat-sidebar");
    expect((sidebar.props as { children?: unknown }).children).toBe("nav");
    expect(cls(rail)).toBe("chat-rail");
    expect((rail.props as { children?: unknown }).children).toBe("sources");
  });

  it("merges a caller className onto the grid container", () => {
    const el = ChatLayout({ className: "focus", children: "chat" }) as ReactElement;
    expect(cls(el)).toBe("chat-layout focus");
  });
});
