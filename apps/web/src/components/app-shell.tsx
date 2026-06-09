"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChatLayout,
  ChatMenuButton,
  ChatSidebar,
  ChatSidebarDrawer,
  ChatTopbar,
  ChatUserIdentity,
  cx,
  Modal,
} from "@expertos/ui";
import { useAuth } from "../lib/auth-context";
import { useT } from "../lib/i18n";
import { useMediaQuery } from "../lib/use-media-query";
import { AccountIdentityHeader, AccountPanel } from "./account-panel";

/** Folder glyph for "My Knowledge" — shares the icon the chat sidebar uses for the same link. */
function KnowledgeIcon() {
  return (
    <svg className="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 5h9l2 2h5v12H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Clock glyph for "History". */
function HistoryIcon() {
  return (
    <svg className="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The shared consumer app-shell (M19.x) — wraps the standalone `/history` and `/knowledge` routes in
 * the SAME frame as the `/chat` workspace: the dark {@link ChatLayout} sidebar (brand + a "New chat"
 * action back to the workspace + the cross-page nav) and the {@link ChatTopbar} with the user identity
 * pinned top-right ({@link ChatUserIdentity} → the account modal, whose Sign-out lives in
 * {@link AccountPanel}). Reusing the chat components — not a parallel light shell — is what keeps the
 * two surfaces visually identical, so no signed-in page is ever a dead end (the house rule: every page
 * provides a way back plus Account/Logout access). Mirrors the chat page's responsive behavior: the
 * sidebar collapses to a slide-over below 900px, reachable via the topbar menu button.
 */
export function WebAppShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  const t = useT("nav");
  const tAccount = useT("account");
  const tChat = useT("chat");
  const pathname = usePathname();
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  // Match the chat shell: the persistent sidebar is in the grid ≥ 900px and an overlay below.
  const sidebarInGrid = useMediaQuery("(min-width: 900px)");

  const nav = [
    { href: "/knowledge", label: t("knowledge"), icon: <KnowledgeIcon /> },
    { href: "/history", label: t("history"), icon: <HistoryIcon /> },
  ];

  const navBody = (
    <nav className="chat-side-nav">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={cx("navitem", active && "active")}>
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  // The dark sidebar — the same ChatSidebar the chat workspace renders. "New chat" routes back to the
  // /chat workspace; the body carries the cross-page nav. `onClose` is supplied only in the drawer.
  const sidebar = (onClose?: () => void) => (
    <ChatSidebar
      onNewConversation={() => router.push("/chat")}
      onClose={onClose}
      newConversationLabel={tChat("newConversationButton")}
      collapseLabel={tChat("collapseSidebar")}
    >
      {navBody}
    </ChatSidebar>
  );

  return (
    <ChatLayout direction="classic" sidebar={sidebarInGrid ? sidebar() : undefined}>
      <ChatTopbar
        title={title}
        titleEditable={false}
        leading={
          sidebarInGrid ? undefined : (
            <ChatMenuButton onOpen={() => setSidebarDrawerOpen(true)} label={tChat("openNavigation")} />
          )
        }
      >
        {user && (
          <ChatUserIdentity
            name={user.displayName}
            email={user.email}
            onOpenAccount={() => setAccountOpen(true)}
            openAccountLabel={tAccount("modalTitle")}
          />
        )}
      </ChatTopbar>

      <div className="chat-content">{children}</div>

      {!sidebarInGrid && (
        <ChatSidebarDrawer
          open={sidebarDrawerOpen}
          onClose={() => setSidebarDrawerOpen(false)}
          title={tChat("openNavigation")}
        >
          {sidebar(() => setSidebarDrawerOpen(false))}
        </ChatSidebarDrawer>
      )}

      <Modal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={tAccount("modalTitle")}
        header={<AccountIdentityHeader />}
        closeLabel={tAccount("close")}
        className="account-modal"
      >
        <AccountPanel />
      </Modal>
    </ChatLayout>
  );
}
