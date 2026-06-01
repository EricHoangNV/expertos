"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Button, Content, cx, Shell, Topbar } from "@expertos/ui";
import type { Role } from "@expertos/shared";
import { useAuth } from "../lib/auth-context";

interface NavItem {
  href: string;
  label: string;
  /** Section heading this item belongs under. */
  group: "Expert" | "Admin";
}

/**
 * The portal nav. "Expert" items consume the `@Roles("expert")` routes (knowledge, drafts, voice
 * profiles, the M8.5 conversions + answer-review reads) — visible to experts and admins alike.
 * "Admin" items are `@Roles("admin")`-only platform surfaces, shown only once `/me` resolves to an
 * admin (a UX gate; the API enforces the real boundary, so a direct hit still 403s for a non-admin).
 */
const NAV: NavItem[] = [
  { href: "/knowledge", label: "Knowledge", group: "Expert" },
  { href: "/knowledge-drafts", label: "Drafts", group: "Expert" },
  { href: "/voice-profiles", label: "Voice profiles", group: "Expert" },
  { href: "/answers", label: "AI answers", group: "Expert" },
  { href: "/concierge-reviews", label: "Review queue", group: "Expert" },
  { href: "/conversions", label: "Conversions", group: "Expert" },
  { href: "/revenue", label: "Revenue", group: "Admin" },
  { href: "/analytics", label: "Usage & cost", group: "Admin" },
  { href: "/funnel", label: "Funnel", group: "Admin" },
  { href: "/concierge-analytics", label: "Concierge ops", group: "Admin" },
  { href: "/validation", label: "Validation", group: "Admin" },
  { href: "/entitlements", label: "Entitlements", group: "Admin" },
  { href: "/recommendation-rules", label: "Funnel rules", group: "Admin" },
  { href: "/concierge", label: "Concierge", group: "Admin" },
  { href: "/failed-queries", label: "Flagged answers", group: "Admin" },
  { href: "/reconcile", label: "Bookings", group: "Admin" },
  { href: "/users", label: "Users", group: "Admin" },
  { href: "/experts", label: "Experts", group: "Admin" },
  { href: "/audit", label: "Audit log", group: "Admin" },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  return (
    <Link
      href={item.href}
      className={cx(
        "navitem",
        (pathname === item.href || pathname.startsWith(`${item.href}/`)) && "active",
      )}
    >
      {item.label}
    </Link>
  );
}

function Sidebar({ pathname, role }: { pathname: string; role: Role | null }) {
  // Admin items appear only for a resolved admin; everyone else sees the expert subset (the API
  // is the real gate, so this just keeps the nav honest about what the signed-in user can open).
  const expertItems = NAV.filter((item) => item.group === "Expert");
  const adminItems = role === "admin" ? NAV.filter((item) => item.group === "Admin") : [];
  return (
    <>
      <div className="brand">
        <div className="logo">
          <span className="expert">Expert</span>
          <span className="sub">OS · {role === "admin" ? "Admin" : "Expert"}</span>
        </div>
      </div>
      <div className="navgroup">Expert</div>
      {expertItems.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
      {adminItems.length > 0 && (
        <>
          <div className="navgroup">Admin</div>
          {adminItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </>
      )}
    </>
  );
}

/**
 * The admin/expert portal frame (Design System `.shell`): an ink sidebar of review queues,
 * a top bar with the signed-in identity + sign-out, and the page body. Gates on Firebase auth —
 * the API still enforces the `expert`/`admin` role + tenant RLS, so this is a UX gate, not the
 * security boundary. Pages render their content as `children`.
 */
export function AdminFrame({ children }: { children: ReactNode }) {
  const { user, role, loading, signInWithGoogle, signOutUser } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <main className="card card-pad">
        <Badge tone="info">Loading…</Badge>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="card card-pad">
        <h1>ExpertOS Admin</h1>
        <p className="muted">Sign in with your expert or admin account to review knowledge.</p>
        <Button variant="primary" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </Button>
      </main>
    );
  }

  return (
    <Shell sidebar={<Sidebar pathname={pathname} role={role} />}>
      <Topbar>
        <span className="grow muted">{user.email ?? user.uid}</span>
        <Button variant="ghost" size="sm" onClick={() => void signOutUser()}>
          Sign out
        </Button>
      </Topbar>
      <Content>{children}</Content>
    </Shell>
  );
}
