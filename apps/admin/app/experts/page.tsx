"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Table, Textarea } from "@expertos/ui";
import type { AdminExpertSummaryDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { createExpert, listExperts } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

const PAGE_SIZE = 50;

type ActiveFilter = "" | "true" | "false";

export default function ExpertsPage() {
  const t = useT("experts");
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<AdminExpertSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveFilter>("");
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
        await listExperts(token, {
          active: active === "" ? undefined : active === "true",
          search: search.trim() === "" ? undefined : search.trim(),
          limit: PAGE_SIZE,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("list.loadError"));
    }
  }, [getIdToken, active, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("list.title")}</h1>
          <p className="muted">{t("list.intro")}</p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      <CreateExpert
        getToken={getIdToken}
        onCreated={(name) => {
          setNotice(t("list.created", { name }));
          void load();
        }}
        onError={setError}
      />

      <div className="row gap2">
        <Field label={t("list.activeLabel")}>
          <Select value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}>
            <option value="">{t("list.activeAny")}</option>
            <option value="true">{t("active")}</option>
            <option value="false">{t("inactive")}</option>
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

      {rows != null && rows.length === 0 && <p className="muted">{t("list.empty")}</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("list.colName")}</th>
              <th>{t("list.colSlug")}</th>
              <th>{t("list.colTitle")}</th>
              <th>{t("list.colState")}</th>
              <th>{t("list.colVoices")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.displayName}</td>
                <td className="mono muted">{e.slug}</td>
                <td>{e.title ?? <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={e.active ? "green" : "ink"}>{e.active ? t("active") : t("inactive")}</Badge>
                </td>
                <td className="mono">{e.voiceProfileCount}</td>
                <td>
                  <Link href={`/experts/${e.id}`} className="navitem">
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

interface CreateExpertProps {
  getToken: () => Promise<string | null>;
  onCreated: (displayName: string) => void;
  onError: (message: string) => void;
}

function CreateExpert({ getToken, onCreated, onError }: CreateExpertProps) {
  const t = useT("experts");
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setSlug("");
    setDisplayName("");
    setTitle("");
    setBio("");
  }, []);

  const submit = useCallback(async () => {
    if (slug.trim() === "" || displayName.trim() === "") return;
    setBusy(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      await createExpert(tok, {
        slug: slug.trim(),
        displayName: displayName.trim(),
        title: title.trim() === "" ? undefined : title.trim(),
        bio: bio.trim() === "" ? undefined : bio.trim(),
      });
      reset();
      setOpen(false);
      onCreated(displayName.trim());
    } catch (err) {
      onError(err instanceof Error ? err.message : t("create.createError"));
    } finally {
      setBusy(false);
    }
  }, [slug, displayName, title, bio, getToken, reset, onCreated, onError, t]);

  if (!open) {
    return (
      <div className="row">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          {t("create.newExpert")}
        </Button>
      </div>
    );
  }

  return (
    <section className="card card-pad">
      <div className="label">{t("create.newExpert")}</div>
      <div className="col gap2">
        <div className="row gap2">
          <Field label={t("create.slugLabel")}>
            <Input
              placeholder={t("create.slugPlaceholder")}
              value={slug}
              disabled={busy}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>
          <Field label={t("create.displayNameLabel")}>
            <Input
              placeholder={t("create.displayNamePlaceholder")}
              value={displayName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t("create.titleLabel")}>
            <Input
              placeholder={t("create.titlePlaceholder")}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("create.bioLabel")}>
          <Textarea
            rows={3}
            value={bio}
            disabled={busy}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>
        <div className="row gap2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || slug.trim() === "" || displayName.trim() === ""}
            onClick={() => void submit()}
          >
            {busy ? t("create.creating") : t("create.create")}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
            {t("create.cancel")}
          </Button>
        </div>
      </div>
    </section>
  );
}
