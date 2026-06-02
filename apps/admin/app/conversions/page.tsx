"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Select, Stat, Table } from "@expertos/ui";
import type {
  AdminExpertSummaryDto,
  ConsultationStatusValue,
  ExpertConversionsDto,
  RecommendationFunnelResponse,
  RecommendationTriggerValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getExpertConversions, listExperts } from "../../src/lib/admin-client";
import { useStatusLabel, useT } from "../../src/lib/i18n";
import {
  consultationStatusTone,
  funnelResponseTone,
} from "../../src/lib/status-tone";

/** Display order for the breakdown tables (matches the DTO record keys). */
const TRIGGERS: readonly RecommendationTriggerValue[] = [
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
];
const RESPONSES: readonly RecommendationFunnelResponse[] = [
  "book",
  "maybe_later",
  "ask_another",
  "pending",
];
const STATUSES: readonly ConsultationStatusValue[] = [
  "recommended",
  "booked",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
];

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Expert consultation-conversions dashboard (M8.5). An expert sees the funnel from conversations
 * held in their voice; an admin picks an expert from the roster. The API enforces the scope —
 * this page just renders the aggregates the `/expert/conversions` read returns.
 */
export default function ConversionsPage() {
  const t = useT("conversions");
  const statusLabel = useStatusLabel();
  const { getIdToken, role } = useAuth();
  const isAdmin = role === "admin";
  const [experts, setExperts] = useState<AdminExpertSummaryDto[]>([]);
  const [expertId, setExpertId] = useState("");
  const [data, setData] = useState<ExpertConversionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Admins pick an expert from the roster; experts are always scoped to their own voice.
  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) {
          return;
        }
        setExperts(await listExperts(token, { active: true }));
      } catch {
        /* a roster failure surfaces on the data load below */
      }
    })();
  }, [isAdmin, getIdToken]);

  const load = useCallback(async () => {
    // Wait for the role to resolve so we don't briefly load the wrong scope.
    if (role === null) {
      return;
    }
    setError(null);
    setData(null);
    // An admin must pick an expert first; a non-admin is implicitly their own.
    if (isAdmin && expertId === "") {
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errorSignIn"));
        return;
      }
      setData(await getExpertConversions(token, isAdmin ? expertId : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoad"));
    }
  }, [getIdToken, role, isAdmin, expertId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
        </div>
        {isAdmin && (
          <Field label={t("expert")}>
            <Select value={expertId} onChange={(e) => setExpertId(e.target.value)}>
              <option value="">{t("selectExpertPlaceholder")}</option>
              {experts.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <p className="muted">{t("intro")}</p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {isAdmin && expertId === "" && (
        <p className="muted">{t("selectExpertPrompt")}</p>
      )}

      {data != null && data.expert == null && !isAdmin && (
        <p className="muted">{t("noExpertProfile")}</p>
      )}

      {data != null && data.expert != null && (
        <>
          <div className="row gap1">
            <Stat label={t("recommendations")} value={data.recommendationCount} />
            <Stat label={t("booked")} value={data.byResponse.book} />
            <Stat label={t("revenue")} value={usd(data.revenueCents)} />
          </div>

          <h3 className="h3">{t("byTrigger")}</h3>
          <Table>
            <thead>
              <tr>
                <th>{t("colTrigger")}</th>
                <th>{t("colRecommendations")}</th>
              </tr>
            </thead>
            <tbody>
              {TRIGGERS.map((trigger) => (
                <tr key={trigger}>
                  <td>{statusLabel(trigger)}</td>
                  <td className="mono">{data.byTrigger[trigger]}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h3 className="h3">{t("byResponse")}</h3>
          <div className="row gap2">
            {RESPONSES.map((r) => (
              <Badge key={r} tone={funnelResponseTone(r)}>
                {statusLabel(r)}: {data.byResponse[r]}
              </Badge>
            ))}
          </div>

          <h3 className="h3">{t("byStatus")}</h3>
          <div className="row gap2">
            {STATUSES.map((s) => (
              <Badge key={s} tone={consultationStatusTone(s)}>
                {statusLabel(s)}: {data.byConsultationStatus[s]}
              </Badge>
            ))}
          </div>

          <h3 className="h3">{t("recentRecommendations")}</h3>
          {data.recent.length === 0 ? (
            <p className="muted">{t("noRecommendations")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("colWhen")}</th>
                  <th>{t("colTrigger")}</th>
                  <th>{t("colResponse")}</th>
                  <th>{t("colConsultation")}</th>
                  <th>{t("colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((item) => (
                  <tr key={item.recommendationId}>
                    <td className="muted mono">{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{statusLabel(item.trigger)}</td>
                    <td>
                      <Badge tone={funnelResponseTone(item.response)}>
                        {statusLabel(item.response)}
                      </Badge>
                    </td>
                    <td>
                      {item.consultationStatus != null ? (
                        <Badge tone={consultationStatusTone(item.consultationStatus)}>
                          {statusLabel(item.consultationStatus)}
                        </Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono">
                      {item.amountCents != null ? usd(item.amountCents) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </AdminFrame>
  );
}
