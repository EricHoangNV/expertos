"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Table } from "@expertos/ui";
import { ROLES, type AdminUserSummaryDto, type Role } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { listUsers } from "../../src/lib/admin-client";
import { roleTone, statusLabel } from "../../src/lib/status-tone";

const PAGE_SIZE = 50;

export default function UsersPage() {
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<AdminUserSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | "">("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setRows(
        await listUsers(token, {
          role: role === "" ? undefined : role,
          search: search.trim() === "" ? undefined : search.trim(),
          limit: PAGE_SIZE,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    }
  }, [getIdToken, role, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">People</div>
          <h1 className="h1">Users</h1>
          <p className="muted">
            Everyone on the platform — across all tenants. Open a user to change their role, raise a
            fair-use flag, or delete their data.
          </p>
        </div>
      </div>

      <div className="row gap2">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">any</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search">
          <Input
            placeholder="email or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
        </Field>
        <Button variant="subtle" size="sm" onClick={() => void load()}>
          Apply
        </Button>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {rows != null && rows.length === 0 && <p className="muted">No users match.</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.displayName ?? <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={roleTone(u.role)}>{u.role}</Badge>
                </td>
                <td>
                  {u.planKey != null ? (
                    <span>
                      {u.planKey}
                      {u.subscriptionStatus != null && (
                        <span className="muted"> · {statusLabel(u.subscriptionStatus)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">free</span>
                  )}
                </td>
                <td className="muted mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <Link href={`/users/${u.id}`} className="navitem">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}
