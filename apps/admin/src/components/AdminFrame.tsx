"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Button, Content, cx, Shell, Topbar } from "@expertos/ui";
import type { Role } from "@expertos/shared";
import { useAuth } from "../lib/auth-context";
import "./admin-login.css";

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
  { href: "/retention", label: "Data retention", group: "Admin" },
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const ROLES = [
  {
    id: "admin" as const,
    name: "Admin",
    desc: "Knowledge, plans, revenue, users",
  },
  {
    id: "expert" as const,
    name: "Expert",
    desc: "Voice approval, concierge review, conversions",
  },
];

function AdminLogin({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [selectedRole, setSelectedRole] = useState<"admin" | "expert">("admin");

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ExpertOS.png" alt="ExpertOS" className="admin-login-logo" />
          <Badge tone="ink">Console</Badge>
        </div>

        <h1 className="admin-login-title">Sign in to the console</h1>

        <div className="label">I&apos;m signing in as</div>

        <div className="admin-login-roles">
          {ROLES.map((r) => (
            <div
              key={r.id}
              className={cx("admin-login-role", selectedRole === r.id && "selected")}
              onClick={() => setSelectedRole(r.id)}
            >
              <div className="admin-login-role-radio" />
              <div className="admin-login-role-body">
                <div className="admin-login-role-name">{r.name}</div>
                <div className="admin-login-role-desc">{r.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: "100%", justifyContent: "center", gap: "12px" }}
          onClick={() => void onSignIn()}
        >
          <GoogleIcon />
          Continue with Google
        </button>

      </div>
    </div>
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
    return <AdminLogin onSignIn={signInWithGoogle} />;
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
