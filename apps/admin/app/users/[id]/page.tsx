"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { fairUseFlagTone, roleTone } from "../../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../../src/lib/i18n";

export default function UserDetailPage() {
  const t = useT("users");
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const { getIdToken } = useAuth();

  const [user, setUser] = useState<AdminUserDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => {
    const tok = await getIdToken();
    if (!tok) {
      setError(t("signInError"));
      return null;
    }
    return tok;
  }, [getIdToken, t]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const tok = await token();
      if (!tok) return;
      setUser(await getUser(tok, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("detail.loadError"));
    }
  }, [token, userId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/users">{t("detail.back")}</Link>
          </div>
          <h1 className="h1">{user?.email ?? t("detail.fallbackTitle")}</h1>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      {user != null && (
        <div className="col gap3">
          <div className="row gap2">
            <Badge tone={roleTone(user.role)}>{t(`roles.${user.role}`)}</Badge>
            <span className="muted">{user.displayName ?? "—"}</span>
            <span className="grow" />
            <span className="muted mono">{t("detail.localePrefix", { locale: user.locale })}</span>
            <span className="muted mono">
              {t("detail.joinedPrefix", { date: new Date(user.createdAt).toLocaleDateString() })}
            </span>
          </div>

          <div className="row gap3">
            <Stat label={t("detail.statConversations")} value={String(user.activity.conversationCount)} />
            <Stat label={t("detail.statUploads")} value={String(user.activity.uploadCount)} />
            <Stat label={t("detail.statConsultations")} value={String(user.activity.consultationCount)} />
          </div>

          <Subscription user={user} />

          <RoleEditor
            user={user}
            getToken={token}
            onSaved={(role) => {
              setUser((prev) => (prev ? { ...prev, role } : prev));
              setNotice(t("detail.roleUpdated"));
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
              setNotice(t("detail.deletionRequested"));
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
  const t = useT("users");
  const statusLabel = useStatusLabel();
  const sub = user.subscription;
  return (
    <section className="card card-pad">
      <div className="label">{t("detail.subscription.label")}</div>
      {sub == null ? (
        <p className="muted">{t("detail.subscription.none")}</p>
      ) : (
        <div className="col gap1">
          <div className="row gap2">
            <strong>{sub.planName}</strong>
            <Badge tone="info">{statusLabel(sub.status)}</Badge>
            <span className="muted">{t("detail.subscription.intervalPrefix", { interval: sub.interval })}</span>
          </div>
          {sub.currentPeriodEnd != null && (
            <span className="muted mono">
              {t("detail.subscription.renews", {
                date: new Date(sub.currentPeriodEnd).toLocaleDateString(),
              })}
            </span>
          )}
          {sub.cancelAt != null && (
            <span className="muted mono">
              {t("detail.subscription.cancels", {
                date: new Date(sub.cancelAt).toLocaleDateString(),
              })}
            </span>
          )}
          <p className="muted">{t("detail.subscription.managed")}</p>
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
  const t = useT("users");
  const [role, setRole] = useState<Role>(user.role);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      const saved = await updateUserRole(tok, user.id, { role });
      onSaved(saved.role);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.role.saveError"));
    } finally {
      setSaving(false);
    }
  }, [getToken, user.id, role, onSaved, onError, t]);

  return (
    <section className="card card-pad">
      <div className="label">{t("detail.role.label")}</div>
      <div className="row gap2">
        <Field label={t("detail.role.fieldLabel")}>
          <Select value={role} disabled={saving} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
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
          {saving ? t("detail.role.saving") : t("detail.role.save")}
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
  const t = useT("users");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const raise = useCallback(async () => {
    if (reason.trim() === "") return;
    setBusy(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      await flagFairUse(tok, userId, { reason: reason.trim() });
      setReason("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.fairUse.raiseError"));
    } finally {
      setBusy(false);
    }
  }, [reason, getToken, userId, onChanged, onError, t]);

  const setStatus = useCallback(
    async (flagId: string, status: FairUseFlagStatusValue) => {
      try {
        const tok = await getToken();
        if (!tok) return;
        await updateFairUseFlag(tok, flagId, { status });
        onChanged();
      } catch (err) {
        onError(err instanceof Error ? err.message : t("detail.fairUse.updateError"));
      }
    },
    [getToken, onChanged, onError, t],
  );

  return (
    <section className="card card-pad">
      <div className="label">{t("detail.fairUse.label")}</div>
      {flags.length === 0 && <p className="muted">{t("detail.fairUse.empty")}</p>}
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
        <Field label={t("detail.fairUse.newReasonLabel")}>
          <Input
            placeholder={t("detail.fairUse.newReasonPlaceholder")}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Button variant="subtle" size="sm" disabled={busy || reason.trim() === ""} onClick={() => void raise()}>
          {t("detail.fairUse.raise")}
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
  const t = useT("users");
  const statusLabel = useStatusLabel();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      await requestUserDeletion(tok, user.id);
      onRequested();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.deletion.recordError"));
    } finally {
      setBusy(false);
    }
  }, [getToken, user.id, onRequested, onError, t]);

  const execute = useCallback(async () => {
    setBusy(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      await deleteUser(tok, user.id);
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.deletion.deleteError"));
      setBusy(false);
    }
  }, [getToken, user.id, onDeleted, onError, t]);

  return (
    <section className="card card-pad">
      <div className="label">{t("detail.deletion.label")}</div>
      {user.deletion != null && (
        <p className="muted">
          {t("detail.deletion.lastRequestPrefix")}{" "}
          <Badge tone="amber">{statusLabel(user.deletion.status)}</Badge>{" "}
          {t("detail.deletion.lastRequestOn", {
            date: new Date(user.deletion.requestedAt).toLocaleString(),
          })}
        </p>
      )}
      <p className="muted">{t("detail.deletion.warning")}</p>
      <div className="row gap2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void request()}>
          {t("detail.deletion.recordRequest")}
        </Button>
        {!confirming ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            {t("detail.deletion.deleteData")}
          </Button>
        ) : (
          <>
            <Badge tone="red">{t("detail.deletion.confirmQuestion", { email: user.email })}</Badge>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void execute()}>
              {busy ? t("detail.deletion.deleting") : t("detail.deletion.confirmDelete")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              {t("detail.deletion.cancel")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
