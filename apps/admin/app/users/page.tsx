"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Table } from "@expertos/ui";
import { ROLES, type AdminUserSummaryDto, type Role } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { listUsers } from "../../src/lib/admin-client";
import { roleTone } from "../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../src/lib/i18n";

const PAGE_SIZE = 50;

export default function UsersPage() {
  const t = useT("users");
  const statusLabel = useStatusLabel();
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
        setError(t("signInError"));
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
      setError(err instanceof Error ? err.message : t("list.loadError"));
    }
  }, [getIdToken, role, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("list.title")}</h1>
          <p className="lede">{t("list.intro")}</p>
        </div>
      </div>

      <div className="row gap2">
        <Field label={t("list.roleLabel")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">{t("list.roleAny")}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("list.searchLabel")}>
          <Input
            placeholder={t("list.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
        </Field>
        <Button variant="subtle" size="sm" onClick={() => void load()}>
          {t("list.apply")}
        </Button>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {rows != null && rows.length === 0 && <p className="muted">{t("list.empty")}</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("list.colEmail")}</th>
              <th>{t("list.colName")}</th>
              <th>{t("list.colRole")}</th>
              <th>{t("list.colPlan")}</th>
              <th>{t("list.colJoined")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.displayName ?? <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={roleTone(u.role)}>{t(`roles.${u.role}`)}</Badge>
                </td>
                <td>
                  {u.planKey != null ? (
                    <span className="row gap1">
                      {u.planKey === "premium" ? (
                        <Badge tone="red">{u.planKey}</Badge>
                      ) : (
                        <span>{u.planKey}</span>
                      )}
                      {u.subscriptionStatus != null && (
                        <span className="muted"> · {statusLabel(u.subscriptionStatus)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">{t("list.planFree")}</span>
                  )}
                </td>
                <td className="muted mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <Link href={`/users/${u.id}`} className="btn btn-subtle btn-sm">
                    {t("list.manage")}
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
