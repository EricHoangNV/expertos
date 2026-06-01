"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Button, Content, cx, Shell, Topbar } from "@expertos/ui";
import { useAuth } from "../lib/auth-context";

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/knowledge", label: "Knowledge" },
  { href: "/knowledge-drafts", label: "Drafts" },
  { href: "/revenue", label: "Revenue" },
  { href: "/entitlements", label: "Entitlements" },
  { href: "/recommendation-rules", label: "Funnel rules" },
  { href: "/failed-queries", label: "Flagged answers" },
];

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <>
      <div className="brand">
        <div className="logo">
          <span className="expert">Expert</span>
          <span className="sub">OS · Admin</span>
        </div>
      </div>
      <div className="navgroup">Review</div>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cx(
            "navitem",
            (pathname === item.href || pathname.startsWith(`${item.href}/`)) && "active",
          )}
        >
          {item.label}
        </Link>
      ))}
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
  const { user, loading, signInWithGoogle, signOutUser } = useAuth();
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
    <Shell sidebar={<Sidebar pathname={pathname} />}>
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
