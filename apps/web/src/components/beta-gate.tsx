"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@expertos/ui";
import { useAuth } from "../lib/auth-context";
import { useT } from "../lib/i18n";

/**
 * Private-beta boundary for the consumer app. Mounted once in the root layout so every route is
 * covered: while the signed-in email is not on the invite whitelist (`AuthProvider.denied`, from
 * the `GET /me` 403 with `code: BETA_ACCESS_DENIED`), renders a hard-deny card — no app chrome,
 * just the reason and a way to sign out and try a different account — instead of the page. Modeled
 * on the admin portal's `AccessDenied` (AdminFrame). Signed-out visitors are unaffected (`denied`
 * is only ever true while signed in), so the login page renders normally.
 */
export function BetaGateBoundary({ children }: { children: ReactNode }) {
  const { denied, signOutUser } = useAuth();
  const router = useRouter();
  const t = useT("betaGate");

  // Sign out AND navigate home. The login page redirects a signed-in user to /chat before the
  // deny check resolves, so by the time the card shows the URL is usually /chat — without the
  // explicit navigation, signing out would strand the user on /chat's "please sign in" fallback
  // instead of the actual sign-in screen.
  const signOutToLogin = async (): Promise<void> => {
    await signOutUser();
    router.replace("/");
  };

  if (!denied) {
    return <>{children}</>;
  }

  return (
    <main className="card card-pad" style={{ maxWidth: "32rem", margin: "4rem auto" }}>
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="h2">{t("title")}</h1>
      <p className="muted">{t("body")}</p>
      <Button variant="ghost" onClick={() => void signOutToLogin()}>
        {t("signOut")}
      </Button>
    </main>
  );
}
