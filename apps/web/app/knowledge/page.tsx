"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  formatDateTime,
  type Locale,
  type Translator,
} from "@expertos/ui";
import type { UploadedFileDto } from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { useLocale, useT } from "../../src/lib/i18n";
import { deleteUpload, listUploads } from "../../src/lib/upload-client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Human-readable file size (binary units, matching the API's upload limit). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

/**
 * Relative expiry copy for a `temporary` upload (M18.3.2). `expiresAt` is ISO-8601; the label is
 * computed from whole days remaining: an already-past expiry reads "expired" (a sweep may not have
 * run yet), under a day reads "expires today", else "expires in N day(s)".
 */
function expiryLabel(expiresAt: string, now: number, t: Translator): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return t("expired");
  const days = Math.floor(remaining / DAY_MS);
  if (days <= 0) return t("expiresToday");
  if (days === 1) return t("expiresInDaysOne", { count: days });
  return t("expiresInDays", { count: days });
}

/** Searchable-chunks badge (M18.3.2) — green when indexed, amber when stored-but-not-searchable. */
function SearchableBadge({ count, t }: { count: number; t: Translator }) {
  if (count <= 0) return <Badge tone="amber">{t("notSearchable")}</Badge>;
  const key = count === 1 ? "searchableChunksOne" : "searchableChunks";
  return <Badge tone="green">{t(key, { count })}</Badge>;
}

/** One upload row: filename, mode badge, size, searchable badge, added date, expiry, delete. */
function UploadRow({
  file,
  now,
  locale,
  t,
  deleting,
  confirming,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  file: UploadedFileDto;
  now: number;
  locale: Locale;
  t: Translator;
  deleting: boolean;
  confirming: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const persistent = file.mode === "persistent";
  return (
    <div className="meter">
      <div className="row gap2 wrap" style={{ alignItems: "baseline" }}>
        <span>{file.filename}</span>
        <Badge tone={persistent ? "green" : "info"}>
          {persistent ? t("badgePersistent") : t("badgeTemporary")}
        </Badge>
        <span className="muted">{formatBytes(file.sizeBytes)}</span>
        <SearchableBadge count={file.chunkCount} t={t} />
        <span className="muted">
          {t("added", { when: formatDateTime(locale, file.createdAt, { dateStyle: "medium" }) })}
        </span>
        {!persistent && file.expiresAt && (
          <span className="muted">{expiryLabel(file.expiresAt, now, t)}</span>
        )}
      </div>
      {confirming ? (
        <div className="col gap1">
          <span className="label">{t("confirmTitle")}</span>
          <span className="muted">{t("confirmBody")}</span>
          <div className="row gap2">
            <Button variant="primary" disabled={deleting} onClick={onConfirmDelete}>
              {deleting ? t("deleting") : t("confirmDelete")}
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={onCancelDelete}>
              {t("confirmCancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          aria-label={t("deleteAria", { name: file.filename })}
          onClick={onRequestDelete}
        >
          {t("delete")}
        </Button>
      )}
    </div>
  );
}

/**
 * "My Knowledge" (M18.3.2, PRD §"M18 — Uploaded document management"). A read+delete management
 * surface over the user's existing M5 uploads: a **Saved (persistent)** section (indexed private
 * knowledge that powers future answers) and a **Temporary (expiring)** section, so a user can verify
 * a file landed, see what their knowledge contains, and remove a file. Consumer surface — RLS scopes
 * the list/delete to the signed-in user; neither is entitlement-gated, so a downgraded user can still
 * see and delete what they saved. Deleting a cited file does not rewrite history (the confirm copy
 * says so) — it only removes the file from future retrieval.
 */
export default function KnowledgePage() {
  const { user, getIdToken } = useAuth();
  const t = useT("knowledge");
  const { locale } = useLocale();
  const [files, setFiles] = useState<UploadedFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // One "now" per render so every row's relative expiry is computed against the same instant.
  const now = Date.now();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInPrompt"));
        return;
      }
      setFiles(await listUploads(token, "all"));
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [getIdToken, t]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, load]);

  const remove = useCallback(
    async (id: string) => {
      setDeletingId(id);
      setDeleteError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setDeleteError(t("signInPrompt"));
          return;
        }
        await deleteUpload(token, id);
        setFiles((prev) => prev.filter((f) => f.id !== id));
        setConfirmingId(null);
      } catch {
        setDeleteError(t("deleteError"));
      } finally {
        setDeletingId(null);
      }
    },
    [getIdToken, t],
  );

  if (!user) {
    return (
      <main className="card card-pad">
        <h1>{t("heading")}</h1>
        <Badge tone="info">{t("signInPrompt")}</Badge>
      </main>
    );
  }

  const persistent = files.filter((f) => f.mode === "persistent");
  const temporary = files.filter((f) => f.mode === "temporary");

  const renderRow = (file: UploadedFileDto) => (
    <UploadRow
      key={file.id}
      file={file}
      now={now}
      locale={locale}
      t={t}
      deleting={deletingId === file.id}
      confirming={confirmingId === file.id}
      onRequestDelete={() => {
        setDeleteError(null);
        setConfirmingId(file.id);
      }}
      onConfirmDelete={() => void remove(file.id)}
      onCancelDelete={() => setConfirmingId(null)}
    />
  );

  return (
    <main className="card card-pad">
      <h1>{t("heading")}</h1>
      <p className="lede">{t("lede")}</p>

      {loading && <Badge tone="info">{t("loading")}</Badge>}
      {error && <Badge tone="red">{error}</Badge>}
      {deleteError && <Badge tone="red">{deleteError}</Badge>}

      {!loading && !error && (
        <>
          <Card className="card-pad">
            <span className="label">{t("savedHeading")}</span>
            <p className="muted">{t("savedDescription")}</p>
            {persistent.length > 0 ? (
              persistent.map(renderRow)
            ) : (
              <p className="muted">{t("empty")}</p>
            )}
          </Card>

          <Card className="card-pad">
            <span className="label">{t("temporaryHeading")}</span>
            <p className="muted">{t("temporaryDescription")}</p>
            {temporary.length > 0 ? (
              temporary.map(renderRow)
            ) : (
              <p className="muted">{t("emptyTemporary")}</p>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
