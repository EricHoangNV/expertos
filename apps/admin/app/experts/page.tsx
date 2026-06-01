"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Table, Textarea } from "@expertos/ui";
import type { AdminExpertSummaryDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { createExpert, listExperts } from "../../src/lib/admin-client";

const PAGE_SIZE = 50;

type ActiveFilter = "" | "true" | "false";

export default function ExpertsPage() {
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
        setError("Please sign in to continue.");
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
      setError(err instanceof Error ? err.message : "Failed to load experts.");
    }
  }, [getIdToken, active, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Roster</div>
          <h1 className="h1">Experts</h1>
          <p className="muted">
            The experts whose voices and knowledge power the product. Create one here, then author a
            voice profile and publish their knowledge.
          </p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      <CreateExpert
        getToken={getIdToken}
        onCreated={(name) => {
          setNotice(`Created ${name}.`);
          void load();
        }}
        onError={setError}
      />

      <div className="row gap2">
        <Field label="Active">
          <Select value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}>
            <option value="">any</option>
            <option value="true">active</option>
            <option value="false">inactive</option>
          </Select>
        </Field>
        <Field label="Search">
          <Input
            placeholder="slug or name"
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

      {rows != null && rows.length === 0 && <p className="muted">No experts match.</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Title</th>
              <th>State</th>
              <th>Voices</th>
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
                  <Badge tone={e.active ? "green" : "ink"}>{e.active ? "active" : "inactive"}</Badge>
                </td>
                <td className="mono">{e.voiceProfileCount}</td>
                <td>
                  <Link href={`/experts/${e.id}`} className="navitem">
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

interface CreateExpertProps {
  getToken: () => Promise<string | null>;
  onCreated: (displayName: string) => void;
  onError: (message: string) => void;
}

function CreateExpert({ getToken, onCreated, onError }: CreateExpertProps) {
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
      const t = await getToken();
      if (!t) return;
      await createExpert(t, {
        slug: slug.trim(),
        displayName: displayName.trim(),
        title: title.trim() === "" ? undefined : title.trim(),
        bio: bio.trim() === "" ? undefined : bio.trim(),
      });
      reset();
      setOpen(false);
      onCreated(displayName.trim());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create expert.");
    } finally {
      setBusy(false);
    }
  }, [slug, displayName, title, bio, getToken, reset, onCreated, onError]);

  if (!open) {
    return (
      <div className="row">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          New expert
        </Button>
      </div>
    );
  }

  return (
    <section className="card card-pad">
      <div className="label">New expert</div>
      <div className="col gap2">
        <div className="row gap2">
          <Field label="Slug (lowercase, hyphens)">
            <Input
              placeholder="dr-lan"
              value={slug}
              disabled={busy}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>
          <Field label="Display name">
            <Input
              placeholder="Dr. Lan"
              value={displayName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="Title (optional)">
            <Input
              placeholder="Cardiologist"
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Bio (optional)">
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
            {busy ? "Creating…" : "Create"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}
