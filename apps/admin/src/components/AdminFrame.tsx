"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  avatarInitials,
  avatarTone,
  Badge,
  Button,
  Content,
  cx,
  LOCALES,
  Shell,
  Topbar,
  type Translator,
} from "@expertos/ui";
import type { User } from "firebase/auth";
import type { Role } from "@expertos/shared";
import { useAuth } from "../lib/auth-context";
import { CAP, useNavCounts, type NavCounts } from "../lib/use-nav-counts";
import { useLocale, useT } from "../lib/i18n";
import "./admin-login.css";

/**
 * Sidebar nav grouping (M13.1.1) — restructured to the approved admin mockup. The three named
 * groups OPERATE / MONETIZE / EXPERT PORTAL carry the mockup's primary items; the remaining
 * working admin surfaces (analytics + system/ops) live under two extra sections so nothing is
 * orphaned. Group headers render via the ds.css `.navgroup` label (uppercased by CSS).
 */
type NavGroup = "OPERATE" | "MONETIZE" | "EXPERT PORTAL" | "ANALYTICS" | "SYSTEM";

const GROUP_ORDER: NavGroup[] = ["OPERATE", "MONETIZE", "EXPERT PORTAL", "ANALYTICS", "SYSTEM"];

/** Maps each nav group to its `common.group.*` translation key (M13.3). */
const GROUP_KEY: Record<NavGroup, string> = {
  OPERATE: "group.operate",
  MONETIZE: "group.monetize",
  "EXPERT PORTAL": "group.expertPortal",
  ANALYTICS: "group.analytics",
  SYSTEM: "group.system",
};

interface NavItem {
  href: string;
  /** The item's `common.nav.*` translation key (M13.3) — surfaced in the nav and the breadcrumb. */
  labelKey: string;
  /** Display section this item renders under. */
  group: NavGroup;
  /**
   * Minimum role that may see the item. `expert` items consume the `@Roles("expert")` routes and
   * are visible to experts and admins alike; `admin` items are `@Roles("admin")`-only platform
   * surfaces, shown only once `/me` resolves to an admin (a UX gate — the API enforces the real
   * boundary, so a direct hit still 403s for a non-admin).
   */
  role: "expert" | "admin";
  /**
   * Which {@link NavCounts} value feeds this item's `.navitem .tag` count badge (M13.1.2), if any.
   * Omitted for items that don't carry a count.
   */
  badge?: keyof NavCounts;
}

const NAV: NavItem[] = [
  // OPERATE — core operational content views.
  { href: "/", labelKey: "nav.dashboard", group: "OPERATE", role: "admin" },
  { href: "/knowledge", labelKey: "nav.knowledge", group: "OPERATE", role: "expert", badge: "knowledgeReview" },
  { href: "/knowledge-drafts", labelKey: "nav.conversationKnowledge", group: "OPERATE", role: "expert" },
  { href: "/answers", labelKey: "nav.aiAnswers", group: "OPERATE", role: "expert" },
  { href: "/failed-queries", labelKey: "nav.lowConfidence", group: "OPERATE", role: "admin", badge: "failedQueries" },
  // MONETIZE — business / billing views.
  { href: "/entitlements", labelKey: "nav.plansEntitlements", group: "MONETIZE", role: "admin" },
  { href: "/revenue", labelKey: "nav.revenue", group: "MONETIZE", role: "admin" },
  { href: "/users", labelKey: "nav.usersSubscriptions", group: "MONETIZE", role: "admin" },
  { href: "/experts", labelKey: "nav.experts", group: "MONETIZE", role: "admin" },
  { href: "/recommendation-rules", labelKey: "nav.funnelRules", group: "MONETIZE", role: "admin" },
  // EXPERT PORTAL — expert-scoped views.
  { href: "/voice-profiles", labelKey: "nav.voiceProfiles", group: "EXPERT PORTAL", role: "expert" },
  { href: "/concierge-reviews", labelKey: "nav.conciergeQueue", group: "EXPERT PORTAL", role: "expert", badge: "conciergeOpen" },
  { href: "/conversions", labelKey: "nav.conversions", group: "EXPERT PORTAL", role: "expert" },
  // ANALYTICS — admin reporting.
  { href: "/analytics", labelKey: "nav.usageCost", group: "ANALYTICS", role: "admin" },
  { href: "/funnel", labelKey: "nav.funnel", group: "ANALYTICS", role: "admin" },
  { href: "/concierge-analytics", labelKey: "nav.conciergeOps", group: "ANALYTICS", role: "admin" },
  { href: "/validation", labelKey: "nav.validation", group: "ANALYTICS", role: "admin" },
  // SYSTEM — admin configuration & operations.
  { href: "/concierge", labelKey: "nav.conciergeConfig", group: "SYSTEM", role: "admin" },
  { href: "/reconcile", labelKey: "nav.bookings", group: "SYSTEM", role: "admin" },
  { href: "/retention", labelKey: "nav.dataRetention", group: "SYSTEM", role: "admin" },
  { href: "/access-control", labelKey: "nav.accessControl", group: "SYSTEM", role: "admin" },
  { href: "/audit", labelKey: "nav.auditLog", group: "SYSTEM", role: "admin" },
];

/** The active nav item's `common.nav.*` key for the topbar breadcrumb (M13.1.4), resolved by the caller. */
function currentPageLabelKey(pathname: string): string {
  if (pathname === "/") return "nav.dashboard";
  const item = NAV.find(
    (it) => it.href !== "/" && (pathname === it.href || pathname.startsWith(`${it.href}/`)),
  );
  return item?.labelKey ?? "nav.console";
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function NavLink({
  item,
  pathname,
  counts,
  t,
}: {
  item: NavItem;
  pathname: string;
  counts: NavCounts;
  t: Translator;
}) {
  // Root ("/") must match exactly so it doesn't light up for every nested route.
  const active =
    item.href === "/"
      ? pathname === "/"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  // Count badge (M13.1.2): show only once loaded and non-zero; a count at the cap reads "99+".
  const count = item.badge != null ? counts[item.badge] : null;
  const showBadge = count != null && count > 0;
  return (
    <Link href={item.href} className={cx("navitem", active && "active")}>
      {t(item.labelKey)}
      {showBadge && <span className="tag">{count >= CAP ? `${CAP}+` : count}</span>}
    </Link>
  );
}

/**
 * Bottom-pinned identity (M13.1.3) — avatar (initials + deterministic tone) + display name +
 * "Admin · ExpertOS" / "Expert · ExpertOS" role label, with the sign-out moved here off the topbar
 * (ghost button restyled for the dark `.side` rail). Pushed to the foot of the sidebar by
 * `.side-foot { margin-top: auto }`.
 */
function SidebarFooter({
  user,
  role,
  onSignOut,
  t,
}: {
  user: User;
  role: Role | null;
  onSignOut: () => void;
  t: Translator;
}) {
  // Prefer the Google display name, fall back to the email local-part, then a neutral label.
  const name = user.displayName?.trim() || user.email?.split("@")[0] || t("fallbackName");
  const seed = user.email ?? user.uid;
  const roleLabel = role === "admin" ? t("roleLabelAdmin") : t("roleLabelExpert");
  return (
    <div className="side-foot">
      <div className="side-user">
        <span className={cx("avatar", "side-user-avatar", `tone-${avatarTone(seed)}`)} aria-hidden>
          {avatarInitials(name)}
        </span>
        <div className="side-user-body">
          <div className="side-user-name">{name}</div>
          <div className="side-user-role">{roleLabel}</div>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onSignOut}>
        {t("signOut")}
      </Button>
    </div>
  );
}

function Sidebar({
  pathname,
  role,
  counts,
  user,
  onSignOut,
  t,
}: {
  pathname: string;
  role: Role | null;
  counts: NavCounts;
  user: User;
  onSignOut: () => void;
  t: Translator;
}) {
  // Admin items appear only for a resolved admin; everyone else sees the expert subset (the API
  // is the real gate, so this just keeps the nav honest about what the signed-in user can open).
  const visible = NAV.filter((item) => item.role === "expert" || role === "admin");
  return (
    <>
      <div className="brand">
        <div className="logo">
          <span className="expert">Expert</span>
          <span className="sub">{role === "admin" ? t("brandSuffixAdmin") : t("brandSuffixExpert")}</span>
        </div>
      </div>
      {GROUP_ORDER.map((group) => {
        const items = visible.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <div className="navgroup">{t(GROUP_KEY[group])}</div>
            {items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} counts={counts} t={t} />
            ))}
          </div>
        );
      })}
      <SidebarFooter user={user} role={role} onSignOut={onSignOut} t={t} />
    </>
  );
}

/**
 * EN/VI language switcher (M13.3) — a `.seg` segmented control in the topbar, mirroring the consumer
 * web app's toggle. Persists through {@link useLocale} (localStorage + `PATCH /me/locale`).
 */
function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT("common");
  return (
    <div className="seg" role="group" aria-label={t("language")}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={cx(locale === l && "active")}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/* eslint-disable no-restricted-syntax -- Google's "G" mark must use its exact
   brand hex colors; these are a third-party logo asset, not theme tokens. */
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
/* eslint-enable no-restricted-syntax */

/**
 * Hard-deny screen (M14) shown when the signed-in email is not on the admin-portal whitelist (the
 * `POST /me/admin-session` gate returned 403). No nav, no portal chrome — just the reason and a way
 * to sign out and try a different account.
 */
function AccessDenied({ onSignOut }: { onSignOut: () => void }) {
  const t = useT("common");
  return (
    <main className="card card-pad" style={{ maxWidth: "32rem", margin: "4rem auto" }}>
      <div className="eyebrow">{t("denied.eyebrow")}</div>
      <h1 className="h2">{t("denied.title")}</h1>
      <p className="muted">{t("denied.body")}</p>
      <Button variant="ghost" onClick={onSignOut}>
        {t("signOut")}
      </Button>
    </main>
  );
}

const ROLES = [
  { id: "admin" as const, nameKey: "login.roleAdminName", descKey: "login.roleAdminDesc" },
  { id: "expert" as const, nameKey: "login.roleExpertName", descKey: "login.roleExpertDesc" },
];

function AdminLogin({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [selectedRole, setSelectedRole] = useState<"admin" | "expert">("admin");
  const t = useT("common");

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ExpertOS.png" alt="ExpertOS" className="admin-login-logo" />
          <Badge tone="ink">{t("login.badge")}</Badge>
        </div>

        <h1 className="admin-login-title">{t("login.title")}</h1>

        <div className="label">{t("login.prompt")}</div>

        <div className="admin-login-roles">
          {ROLES.map((r) => (
            <div
              key={r.id}
              className={cx("admin-login-role", selectedRole === r.id && "selected")}
              onClick={() => setSelectedRole(r.id)}
            >
              <div className="admin-login-role-radio" />
              <div className="admin-login-role-body">
                <div className="admin-login-role-name">{t(r.nameKey)}</div>
                <div className="admin-login-role-desc">{t(r.descKey)}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-ghost admin-login-google"
          onClick={() => void onSignIn()}
        >
          <GoogleIcon />
          {t("login.continueGoogle")}
        </button>

      </div>
    </div>
  );
}

/**
 * The admin/expert portal frame (Design System `.shell`): an ink sidebar of review queues with a
 * bottom-pinned identity + sign-out (M13.1.3), a top bar carrying the role-aware breadcrumb + view
 * badge (M13.1.4), and the page body. Gates on Firebase auth —
 * the API still enforces the `expert`/`admin` role + tenant RLS, so this is a UX gate, not the
 * security boundary. Pages render their content as `children`.
 */
export function AdminFrame({ children }: { children: ReactNode }) {
  const { user, role, denied, loading, signInWithGoogle, signOutUser, getIdToken } = useAuth();
  const pathname = usePathname();
  const counts = useNavCounts(user && !denied ? role : null, getIdToken);
  const t = useT("common");

  if (loading) {
    return (
      <main className="card card-pad">
        <Badge tone="info">{t("loading")}</Badge>
      </main>
    );
  }

  if (!user) {
    return <AdminLogin onSignIn={signInWithGoogle} />;
  }

  // Whitelist gate (M14): a signed-in but non-whitelisted email gets the hard-deny screen.
  if (denied) {
    return <AccessDenied onSignOut={() => void signOutUser()} />;
  }

  return (
    <Shell
      sidebar={
        <Sidebar
          pathname={pathname}
          role={role}
          counts={counts}
          user={user}
          onSignOut={() => void signOutUser()}
          t={t}
        />
      }
    >
      <Topbar>
        {/* Breadcrumb (M13.1.4): "ADMIN › Page" / "EXPERT PORTAL › Page", role-aware prefix. */}
        <div className="crumb grow">
          <span className="label">{role === "admin" ? t("breadcrumbAdmin") : t("breadcrumbExpert")}</span>
          <span className="crumb-sep" aria-hidden>
            ›
          </span>
          <span className="crumb-page">{t(currentPageLabelKey(pathname))}</span>
        </div>
        {/* Role badge: which view the signed-in user is in (the API enforces the real boundary). */}
        <Badge tone={role === "admin" ? "red" : "amber"}>
          {role === "admin" ? t("adminView") : t("expertView")}
        </Badge>
        <LanguageToggle />
        <button type="button" className="btn btn-icon btn-subtle" aria-label={t("notifications")}>
          <BellIcon />
        </button>
      </Topbar>
      <Content>{children}</Content>
    </Shell>
  );
}
