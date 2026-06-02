"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Table } from "@expertos/ui";
import type { AllowedEmailDto, AllowedEmailRole } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { useT } from "../../src/lib/i18n";
import {
  addAllowedEmail,
  listAllowedEmails,
  removeAllowedEmail,
  updateAllowedEmail,
} from "../../src/lib/admin-client";

/** Role → badge tone: admin reads as the elevated (red) role, expert as informational (info). */
function roleTone(role: AllowedEmailRole): "red" | "info" {
  return role === "admin" ? "red" : "info";
}

/** The add-to-whitelist form: email + role, posting a new entry then refreshing the table. */
function AddAllowedEmail({
  getToken,
  onAdded,
  onError,
}: {
  getToken: () => Promise<string | null>;
  onAdded: (email: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT("accessControl");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AllowedEmailRole>("expert");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = email.trim();
    if (trimmed === "") {
      onError(t("errorEnterEmail"));
      return;
    }
    setBusy(true);
    onError("");
    try {
      const token = await getToken();
      if (!token) {
        onError(t("errorSignIn"));
        return;
      }
      await addAllowedEmail(token, { email: trimmed, role });
      setEmail("");
      setRole("expert");
      onAdded(trimmed.toLowerCase());
    } catch (err) {
      onError(err instanceof Error ? err.message : t("errorAdd"));
    } finally {
      setBusy(false);
    }
  }, [email, role, getToken, onAdded, onError, t]);

  return (
    <div className="row gap2">
      <Field label={t("emailLabel")}>
        <Input
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </Field>
      <Field label={t("roleLabel")}>
        <Select value={role} onChange={(e) => setRole(e.target.value as AllowedEmailRole)}>
          <option value="expert">{t("roleExpert")}</option>
          <option value="admin">{t("roleAdmin")}</option>
        </Select>
      </Field>
      <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? t("adding") : t("add")}
      </Button>
    </div>
  );
}

export default function AccessControlPage() {
  const { getIdToken } = useAuth();
  const t = useT("accessControl");
  const roleLabel = useCallback(
    (role: AllowedEmailRole) => (role === "admin" ? t("roleAdmin") : t("roleExpert")),
    [t],
  );
  const [rows, setRows] = useState<AllowedEmailDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errorSignIn"));
        return;
      }
      setRows(await listAllowedEmails(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoad"));
    }
  }, [getIdToken, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Flip a row between expert ↔ admin (the API rejects demoting your own admin access).
  const toggleRole = useCallback(
    async (row: AllowedEmailDto) => {
      const next: AllowedEmailRole = row.role === "admin" ? "expert" : "admin";
      setBusyId(row.id);
      setError(null);
      setNotice(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("errorSignIn"));
          return;
        }
        await updateAllowedEmail(token, row.id, { role: next });
        setNotice(t("noticeRoleChanged", { email: row.email, role: roleLabel(next) }));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorChangeRole"));
      } finally {
        setBusyId(null);
      }
    },
    [getIdToken, load, t, roleLabel],
  );

  // Remove a row (with confirmation; the API rejects removing your own entry).
  const remove = useCallback(
    async (row: AllowedEmailDto) => {
      if (!window.confirm(t("confirmRemove", { email: row.email }))) {
        return;
      }
      setBusyId(row.id);
      setError(null);
      setNotice(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("errorSignIn"));
          return;
        }
        await removeAllowedEmail(token, row.id);
        setNotice(t("noticeRemoved", { email: row.email }));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorRemove"));
      } finally {
        setBusyId(null);
      }
    },
    [getIdToken, load, t],
  );

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("heading")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
      </div>

      {error != null && error !== "" && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      <AddAllowedEmail
        getToken={getIdToken}
        onAdded={(email) => {
          setNotice(t("noticeAdded", { email }));
          void load();
        }}
        onError={(message) => setError(message === "" ? null : message)}
      />

      {rows != null && rows.length === 0 && (
        <p className="muted">{t("empty")}</p>
      )}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("thEmail")}</th>
              <th>{t("thRole")}</th>
              <th>{t("thAddedBy")}</th>
              <th>{t("thAddedAt")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>
                  <Badge tone={roleTone(row.role)}>{roleLabel(row.role)}</Badge>
                </td>
                <td>{row.createdByEmail ?? <span className="muted">—</span>}</td>
                <td className="muted mono">{new Date(row.createdAt).toLocaleString()}</td>
                <td>
                  <div className="row gap1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggleRole(row)}
                      disabled={busyId === row.id}
                    >
                      {row.role === "admin" ? t("makeExpert") : t("makeAdmin")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void remove(row)}
                      disabled={busyId === row.id}
                    >
                      {t("remove")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}
