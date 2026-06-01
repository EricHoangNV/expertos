"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Field, Input, Select, Stat } from "@expertos/ui";
import {
  FAIR_USE_FLAG_STATUSES,
  ROLES,
  type AdminFairUseFlagDto,
  type AdminUserDetailDto,
  type FairUseFlagStatusValue,
  type Role,
} from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import {
  deleteUser,
  flagFairUse,
  getUser,
  requestUserDeletion,
  updateFairUseFlag,
  updateUserRole,
} from "../../../src/lib/admin-client";
import { fairUseFlagTone, roleTone, statusLabel } from "../../../src/lib/status-tone";

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const { getIdToken } = useAuth();

  const [user, setUser] = useState<AdminUserDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => {
    const t = await getIdToken();
    if (!t) {
      setError("Please sign in to continue.");
      return null;
    }
    return t;
  }, [getIdToken]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const t = await token();
      if (!t) return;
      setUser(await getUser(t, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the user.");
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">People</div>
          <h1 className="h1">{user?.email ?? "User"}</h1>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      {user != null && (
        <div className="col gap3">
          <div className="row gap2">
            <Badge tone={roleTone(user.role)}>{user.role}</Badge>
            <span className="muted">{user.displayName ?? "—"}</span>
            <span className="grow" />
            <span className="muted mono">locale {user.locale}</span>
            <span className="muted mono">joined {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>

          <div className="row gap3">
            <Stat label="Conversations" value={String(user.activity.conversationCount)} />
            <Stat label="Uploads" value={String(user.activity.uploadCount)} />
            <Stat label="Consultations" value={String(user.activity.consultationCount)} />
          </div>

          <Subscription user={user} />

          <RoleEditor
            user={user}
            getToken={token}
            onSaved={(role) => {
              setUser((prev) => (prev ? { ...prev, role } : prev));
              setNotice("Role updated.");
            }}
            onError={setError}
          />

          <FairUseFlags
            userId={userId}
            flags={user.fairUseFlags}
            getToken={token}
            onChanged={() => void load()}
            onError={setError}
          />

          <DeletionPanel
            user={user}
            getToken={token}
            onRequested={() => {
              setNotice("Deletion request recorded.");
              void load();
            }}
            onDeleted={() => router.push("/users")}
            onError={setError}
          />
        </div>
      )}
    </AdminFrame>
  );
}

function Subscription({ user }: { user: AdminUserDetailDto }) {
  const sub = user.subscription;
  return (
    <section className="card card-pad">
      <div className="label">Subscription</div>
      {sub == null ? (
        <p className="muted">No subscription — effectively on the Free plan.</p>
      ) : (
        <div className="col gap1">
          <div className="row gap2">
            <strong>{sub.planName}</strong>
            <Badge tone="info">{statusLabel(sub.status)}</Badge>
            <span className="muted">/ {sub.interval}</span>
          </div>
          {sub.currentPeriodEnd != null && (
            <span className="muted mono">
              renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
          {sub.cancelAt != null && (
            <span className="muted mono">
              cancels {new Date(sub.cancelAt).toLocaleDateString()}
            </span>
          )}
          <p className="muted">
            Plan and billing are managed by the payment provider — change them through Stripe, not
            here.
          </p>
        </div>
      )}
    </section>
  );
}

interface RoleEditorProps {
  user: AdminUserDetailDto;
  getToken: () => Promise<string | null>;
  onSaved: (role: Role) => void;
  onError: (message: string) => void;
}

function RoleEditor({ user, getToken, onSaved, onError }: RoleEditorProps) {
  const [role, setRole] = useState<Role>(user.role);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const t = await getToken();
      if (!t) return;
      const saved = await updateUserRole(t, user.id, { role });
      onSaved(saved.role);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update role.");
    } finally {
      setSaving(false);
    }
  }, [getToken, user.id, role, onSaved, onError]);

  return (
    <section className="card card-pad">
      <div className="label">Role</div>
      <div className="row gap2">
        <Field label="RBAC role">
          <Select value={role} disabled={saving} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="subtle"
          size="sm"
          disabled={saving || role === user.role}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save role"}
        </Button>
      </div>
    </section>
  );
}

interface FairUseFlagsProps {
  userId: string;
  flags: AdminFairUseFlagDto[];
  getToken: () => Promise<string | null>;
  onChanged: () => void;
  onError: (message: string) => void;
}

function FairUseFlags({ userId, flags, getToken, onChanged, onError }: FairUseFlagsProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const raise = useCallback(async () => {
    if (reason.trim() === "") return;
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) return;
      await flagFairUse(t, userId, { reason: reason.trim() });
      setReason("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to raise flag.");
    } finally {
      setBusy(false);
    }
  }, [reason, getToken, userId, onChanged, onError]);

  const setStatus = useCallback(
    async (flagId: string, status: FairUseFlagStatusValue) => {
      try {
        const t = await getToken();
        if (!t) return;
        await updateFairUseFlag(t, flagId, { status });
        onChanged();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to update flag.");
      }
    },
    [getToken, onChanged, onError],
  );

  return (
    <section className="card card-pad">
      <div className="label">Fair-use flags</div>
      {flags.length === 0 && <p className="muted">No flags raised.</p>}
      <div className="col gap2">
        {flags.map((flag) => (
          <div key={flag.id} className="row gap2">
            <Badge tone={fairUseFlagTone(flag.status)}>{flag.status}</Badge>
            <span className="grow">{flag.reason}</span>
            <span className="muted mono">{new Date(flag.createdAt).toLocaleDateString()}</span>
            <Select
              value={flag.status}
              onChange={(e) => void setStatus(flag.id, e.target.value as FairUseFlagStatusValue)}
            >
              {FAIR_USE_FLAG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <div className="row gap2">
        <Field label="New flag reason">
          <Input
            placeholder="e.g. automated abuse, account sharing"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Button variant="subtle" size="sm" disabled={busy || reason.trim() === ""} onClick={() => void raise()}>
          Raise flag
        </Button>
      </div>
    </section>
  );
}

interface DeletionPanelProps {
  user: AdminUserDetailDto;
  getToken: () => Promise<string | null>;
  onRequested: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}

function DeletionPanel({ user, getToken, onRequested, onDeleted, onError }: DeletionPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) return;
      await requestUserDeletion(t, user.id);
      onRequested();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to record request.");
    } finally {
      setBusy(false);
    }
  }, [getToken, user.id, onRequested, onError]);

  const execute = useCallback(async () => {
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) return;
      await deleteUser(t, user.id);
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete user.");
      setBusy(false);
    }
  }, [getToken, user.id, onDeleted, onError]);

  return (
    <section className="card card-pad">
      <div className="label">Data deletion</div>
      {user.deletion != null && (
        <p className="muted">
          Last request: <Badge tone="amber">{statusLabel(user.deletion.status)}</Badge> on{" "}
          {new Date(user.deletion.requestedAt).toLocaleString()}
        </p>
      )}
      <p className="muted">
        Deleting a user permanently removes their account and all owned data (conversations,
        uploads, subscriptions, usage) — this cannot be undone. An audit entry is kept.
      </p>
      <div className="row gap2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void request()}>
          Record deletion request
        </Button>
        {!confirming ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            Delete data…
          </Button>
        ) : (
          <>
            <Badge tone="red">Permanently delete {user.email}?</Badge>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void execute()}>
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
