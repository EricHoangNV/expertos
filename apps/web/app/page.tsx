"use client";

import { Badge, Button } from "@expertos/ui";
import { useAuth } from "../src/lib/auth-context";

export default function HomePage() {
  const { user, loading, signInWithGoogle, signOutUser } = useAuth();

  return (
    <main className="card card-pad">
      <h1>ExpertOS</h1>
      <p>AI-Powered. OPEX-Driven.</p>
      {loading ? (
        <Badge tone="info">Loading…</Badge>
      ) : user ? (
        <>
          <Badge tone="green">Signed in as {user.email ?? user.uid}</Badge>
          <Button variant="ghost" onClick={() => void signOutUser()}>
            Sign out
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </Button>
      )}
    </main>
  );
}
