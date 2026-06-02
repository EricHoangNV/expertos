"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Table } from "@expertos/ui";
import type { AllowedEmailDto, AllowedEmailRole } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AllowedEmailRole>("expert");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = email.trim();
    if (trimmed === "") {
      onError("Enter an email to add.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const token = await getToken();
      if (!token) {
        onError("Please sign in to continue.");
        return;
      }
      await addAllowedEmail(token, { email: trimmed, role });
      setEmail("");
      setRole("expert");
      onAdded(trimmed.toLowerCase());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add the email.");
    } finally {
      setBusy(false);
    }
  }, [email, role, getToken, onAdded, onError]);

  return (
    <div className="row gap2">
      <Field label="Email">
        <Input
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as AllowedEmailRole)}>
          <option value="expert">Expert</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </Button>
    </div>
  );
}

export default function AccessControlPage() {
  const { getIdToken } = useAuth();
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
        setError("Please sign in to continue.");
        return;
      }
      setRows(await listAllowedEmails(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the whitelist.");
    }
  }, [getIdToken]);

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
          setError("Please sign in to continue.");
          return;
        }
        await updateAllowedEmail(token, row.id, { role: next });
        setNotice(`${row.email} is now ${next}.`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change the role.");
      } finally {
        setBusyId(null);
      }
    },
    [getIdToken, load],
  );

  // Remove a row (with confirmation; the API rejects removing your own entry).
  const remove = useCallback(
    async (row: AllowedEmailDto) => {
      if (!window.confirm(`Remove ${row.email} from the admin portal whitelist?`)) {
        return;
      }
      setBusyId(row.id);
      setError(null);
      setNotice(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        await removeAllowedEmail(token, row.id);
        setNotice(`Removed ${row.email}.`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove the email.");
      } finally {
        setBusyId(null);
      }
    },
    [getIdToken, load],
  );

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">System</div>
          <h1 className="h1">Access control</h1>
          <p className="muted">
            The admin portal is invite-only. Only the emails below can sign in; each one&apos;s role
            is synced from this list on every sign-in. Removing an entry blocks access on the next
            sign-in. The consumer app is unaffected.
          </p>
        </div>
      </div>

      {error != null && error !== "" && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      <AddAllowedEmail
        getToken={getIdToken}
        onAdded={(email) => {
          setNotice(`Added ${email}.`);
          void load();
        }}
        onError={(message) => setError(message === "" ? null : message)}
      />

      {rows != null && rows.length === 0 && (
        <p className="muted">No emails are whitelisted yet.</p>
      )}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Added by</th>
              <th>Added at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>
                  <Badge tone={roleTone(row.role)}>{row.role}</Badge>
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
                      {row.role === "admin" ? "Make expert" : "Make admin"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void remove(row)}
                      disabled={busyId === row.id}
                    >
                      Remove
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
