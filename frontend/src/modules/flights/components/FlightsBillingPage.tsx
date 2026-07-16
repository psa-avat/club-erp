/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FlightsBillingPage: Cockpit facturation fusionné (vols + facturation)
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * FlightsBillingPage — Cockpit facturation unifié.
 *
 * Fusionne les fonctionnalités de FlightsPage (liste détaillée, pagination,
 * recherche texte, champs facturation éditables) et OpsFlightsTab (sélection
 * batch, aperçu/appliquer/poster, filtre statut) en une seule vue.
 *
 * Source de données : GET /api/v1/flights/billable (enrichi avec pagination
 * et champs supplémentaires).
 */
import { useState, Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Send,
  RotateCw,
  Eye,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  CheckSquare,
  Square,
  Percent,
  Info,
  Undo2,
  Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCapability } from "@/auth/hooks/useCapability";
import { useFiscalYearStore } from "@/store/fiscalYearStore";
import { exportRowsToCsv } from "@/lib/exportCsv";
import {
  useBillableFlightsQuery,
  useFlightBillingPreviewMutation,
  useFlightBillingBatchPreviewMutation,
  useFlightBillingApplyMutation,
  useFlightBillingPostMutation,
  useFlightBillingBatchApplyMutation,
  useFlightBillingUnbillMutation,
  fetchAllBillableFlights,
  type BillableFlight,
  type FlightBillingPreviewResponse,
  type FlightBillingBatchPreviewResponse,
} from "../../banque/api";
import { useUpdateFlightBillingFieldsMutation } from "../api";
import { useMemberOptionsQuery } from "../../members/api";
import { FlightDetailDialog } from "../../banque/components/FlightDetailDialog";

// ── Constants ────────────────────────────────────────────────────────────

const TRIGRAM_FLIGHT_TYPES = new Set([0, 5, 6]); // Instruction, Lâcher, Supervisé

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDecimal(
  value: string | number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMoney(
  value: string | number | null | undefined,
): string {
  const formatted = formatDecimal(value, 2);
  return formatted === "—" ? formatted : `${formatted} EUR`;
}

/** Format decimal hours to hh:mm (e.g. 1.5 → 1h30). */
function formatQuantity(
  value: string,
  unit: number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (unit === 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    const totalMinutes = Math.round(numeric * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h${m.toString().padStart(2, "0")}`;
  }
  return formatDecimal(value, 4);
}

function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 12) : "—";
}

function formatDuration(takeoff: string | null, landing: string | null): string {
  if (!takeoff || !landing) return "—";
  const [th, tm] = takeoff.split(":").map(Number);
  const [lh, lm] = landing.split(":").map(Number);
  if (isNaN(th) || isNaN(tm) || isNaN(lh) || isNaN(lm)) return `${takeoff} → ${landing}`;
  const start = th * 60 + tm;
  const end = lh * 60 + lm;
  let diff = end - start;
  if (diff < 0) diff += 1440; // cross-midnight
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function formatSecondPilot(flight: BillableFlight): string {
  if (!flight.second_pilot_erp_id) return "—";
  if (
    flight.type_of_flight !== null &&
    TRIGRAM_FLIGHT_TYPES.has(flight.type_of_flight)
  ) {
    return flight.second_pilot_trigram ?? flight.second_pilot_name ?? flight.second_pilot_erp_id;
  }
  return flight.second_pilot_name ?? flight.second_pilot_erp_id;
}

const LAUNCH_METHOD_LABELS: Record<number, string> = {
  0: "Extérieur",
  1: "Treuil",
  2: "Remorqueur",
  3: "Autonome",
};

function formatLaunchMethod(flight: BillableFlight): string {
  const method = flight.launch_method;
  if (method === null || method === undefined) return "—";
  if (method === 0) return "Extérieur";
  if (method === 3) return "Autonome";
  const label = LAUNCH_METHOD_LABELS[method] ?? `Méthode ${method}`;
  return flight.launch_asset_code
    ? `${label} ${flight.launch_asset_code}`
    : label;
}

function statusColor(status: string): string {
  switch (status) {
    case "posted":
      return "bg-green-100 text-green-700";
    case "applied":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

// ── Billing Preview Panel ────────────────────────────────────────────────

interface FlightPreviewPanelProps {
  preview: FlightBillingPreviewResponse;
}

function FlightPreviewPanel({ preview }: FlightPreviewPanelProps) {
  const { t } = useTranslation("flights");
  const blockingErrors = preview.errors.filter((e) => e.blocking);

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("billing.title", "Aperçu facturation")}
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            {preview.flight_date ?? "—"} · {preview.type_label ?? preview.type_of_flight ?? "—"}
          </h2>
          <p className="text-xs text-slate-500">
            {t("billing.hash", "Hash")}: {shortHash(preview.billing_hash)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("billing.total", "Total")}
          </p>
          <p className="text-2xl font-semibold text-slate-900">
            {formatMoney(preview.total_amount)}
          </p>
          <p
            className={
              preview.can_apply
                ? "text-xs text-emerald-700"
                : "text-xs text-amber-700"
            }
          >
            {preview.no_bill
              ? t("billing.noBill", "Non facturable")
              : preview.can_apply
                ? t("billing.ready", "Prêt à appliquer")
                : t("billing.blocked", "Blocages")}
          </p>
        </div>
      </div>

      {/* Errors & warnings */}
      {(blockingErrors.length > 0 || preview.warnings.length > 0) && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {blockingErrors.length > 0 && (
            <Alert>
              <span className="font-semibold">
                {t("billing.errors", "Erreurs")}
              </span>
              <ul className="mt-1 space-y-1">
                {blockingErrors.map((error) => (
                  <li key={`${error.scope}-${error.code}-${error.message}`} className="text-xs">
                    {error.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {preview.warnings.length > 0 && (
            <Alert>
              <span className="font-semibold">
                {t("billing.warnings", "Avertissements")}
              </span>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((w) => (
                  <li key={`${w.scope}-${w.code}-${w.message}`} className="text-xs">
                    {w.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      {/* Payers & applied lines */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {t("billing.payers", "Payeurs")}
          </h3>
          <div className="mt-2 space-y-2">
            {preview.payers.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t("billing.empty", "Aucun")}
              </p>
            ) : (
              preview.payers.map((payer) => (
                <div
                  key={`${payer.role}-${payer.member_uuid}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-800">
                      {payer.member_name ?? payer.member_account_id ?? "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {payer.role} · {payer.reason}
                    </p>
                  </div>
                  <span className="text-slate-700">
                    {formatDecimal(Number(payer.share) * 100, 0)}%
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  {t("billing.item", "Article")}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  {t("billing.payer", "Payeur")}
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  {t("billing.quantity", "Qté")}
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  {t("billing.unitPrice", "PU")}
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  {t("billing.pack", "Forfait")}
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  {t("billing.amount", "Montant")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.applied_lines.map((line, index) => (
                <tr
                  key={`${line.pricing_item_uuid}-${line.payer_member_uuid}-${index}`}
                >
                  <td className="px-3 py-2 text-slate-800">
                    {line.pricing_item_name ?? "—"}
                    <br />
                    <span className="text-slate-500">
                      {line.source} · {line.asset_code ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {line.payer_member_account_id ?? line.payer_role}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {formatQuantity(line.quantity, line.unit)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {formatMoney(line.applied_unit_price)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {line.discount_reason
                      ? formatQuantity(line.pack_hours_used, 1)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">
                    {formatMoney(line.amount)}
                  </td>
                </tr>
              ))}
              {preview.applied_lines.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-5 text-center text-slate-500"
                    colSpan={6}
                  >
                    {t("billing.empty", "Aucune ligne")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Accounting lines */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">
                {t("billing.account", "Compte")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">
                {t("billing.member", "Membre")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">
                {t("billing.description", "Description")}
              </th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">
                {t("billing.debit", "Débit")}
              </th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">
                {t("billing.credit", "Crédit")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.accounting_lines.map((line, index) => (
              <tr
                key={`${line.side}-${line.account_code}-${index}`}
              >
                <td className="px-3 py-2 text-slate-800">
                  {line.account_code ?? "—"}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {line.tiers_uuid ?? "—"}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {line.description ?? "—"}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {Number(line.debit) > 0 ? formatMoney(line.debit) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {Number(line.credit) > 0 ? formatMoney(line.credit) : "—"}
                </td>
              </tr>
            ))}
            {preview.accounting_lines.length === 0 && (
              <tr>
                <td
                  className="px-3 py-5 text-center text-slate-500"
                  colSpan={5}
                >
                  {t("billing.empty", "Aucune ligne")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Editable Charge Fields ───────────────────────────────────────────────

function EditableChargeFields({ flight }: { flight: BillableFlight }) {
  const { t } = useTranslation("flights");
  const updateMutation = useUpdateFlightBillingFieldsMutation();
  const activeFiscalYearData = useFiscalYearStore((s) => s.activeFiscalYearData);
  const { data: memberOptions = [] } = useMemberOptionsQuery({
    registered_for_year: activeFiscalYearData?.year,
  });
  const [editing, setEditing] = useState(false);
  const [chargeTo, setChargeTo] = useState(flight.charge_to_erp_id ?? "");
  const [chargeComment, setChargeComment] = useState(
    flight.charge_comment ?? "",
  );

  const memberSelectOptions = memberOptions.map((m) => ({
    value: m.account_id,
    label: `${m.last_name} ${m.first_name} (${m.account_id})`,
  }));

  async function handleSave() {
    await updateMutation.mutateAsync({
      flightUuid: flight.uuid,
      payload: {
        charge_to_erp_id: chargeTo || null,
        charge_comment: chargeComment || null,
      },
    });
    setEditing(false);
  }

  if (!editing) {
    const displayName = flight.charge_to_name ?? flight.charge_to_erp_id;
    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-600">
            <span className="font-medium">
              {t("table.chargeTo", "Facturation à")} :
            </span>{" "}
            {displayName ? (
              <>
                {displayName}
                {flight.charge_to_erp_id && flight.charge_to_name && (
                  <span className="ml-1 text-slate-400">
                    ({flight.charge_to_erp_id})
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-300">
                {t("common.notDefined", "non défini")}
              </span>
            )}
            {flight.charge_comment && (
              <span className="ml-2 text-slate-400">
                — {flight.charge_comment}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChargeTo(flight.charge_to_erp_id ?? "");
              setChargeComment(flight.charge_comment ?? "");
              setEditing(true);
            }}
          >
            {t("common.edit", "Modifier")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">
            {t("table.chargeTo", "Charge à")}
          </Label>
          <SearchableSelect
            options={memberSelectOptions}
            value={chargeTo}
            onChange={setChargeTo}
            clearable
            clearLabel={t("common.reset", "Réinitialiser")}
            placeholder={t("flights:billing.selectMember", "Choisir un membre…")}
            searchPlaceholder={t("common.search", "Rechercher…")}
            noResultsText={t("common.noResults", "Aucun résultat")}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">
            {t("table.chargeComment", "Commentaire")}
          </Label>
          <Input
            value={chargeComment}
            onChange={(e) => setChargeComment(e.target.value)}
            placeholder={t("flights:billing.chargeCommentPlaceholder", "Raison de la facturation")}
          />
        </div>
        <div className="flex items-end gap-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending
              ? t("common.saving", "Sauvegarde…")
              : t("common.save", "Sauvegarder")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(false)}
          >
            {t("common.cancel", "Annuler")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export function FlightsBillingPage() {
  const { t } = useTranslation(["flights", "common"]);
  const canEditFlights = useCapability("EDIT_FLIGHTS");
  const canPost = useCapability("POST_ACCOUNTING_ENTRIES");
  const activeFiscalYearUuid = useFiscalYearStore(
    (s) => s.activeFiscalYearUuid,
  );

  // ── Filter state ────────────────────────────────────────────────────
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterType, setFilterType] = useState<number | undefined>(undefined);
  const [filterLaunch, setFilterLaunch] = useState<number | undefined>(
    undefined,
  );
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [filterPilot, setFilterPilot] = useState("");
  const [filterAsset, setFilterAsset] = useState("");

  // ── UI state ────────────────────────────────────────────────────────
  const [flightPage, setFlightPage] = useState(1);
  const pageSize = 50;
  const [selectedFlights, setSelectedFlights] = useState<Set<string>>(
    new Set(),
  );
  const [expandedFlight, setExpandedFlight] = useState<string | null>(null);
  const [detailFlightUuid, setDetailFlightUuid] = useState<string | null>(
    null,
  );
  const [flightPreviews, setFlightPreviews] = useState<
    Record<string, FlightBillingPreviewResponse>
  >({});
  const [batchPreview, setBatchPreview] =
    useState<FlightBillingBatchPreviewResponse | null>(null);
  const [applyFlightUuid, setApplyFlightUuid] = useState<string | null>(null);
  const [postFlightUuid, setPostFlightUuid] = useState<string | null>(null);
  const [unbillFlightUuid, setUnbillFlightUuid] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────
  const resolvedPilot = filterPilot || undefined;
  const resolvedAsset = filterAsset || undefined;

  const flightsQuery = useBillableFlightsQuery(
    filterDateFrom || undefined,
    filterDateTo || undefined,
    filterType,
    filterLaunch,
    filterStatus !== "pending" ? filterStatus : undefined,
    resolvedPilot,
    resolvedAsset,
    flightPage,
    pageSize,
    true,
  );

  const flights = flightsQuery.data?.items ?? [];

  // ── Mutations ───────────────────────────────────────────────────────
  const previewMutation = useFlightBillingPreviewMutation();
  const applyMutation = useFlightBillingApplyMutation();
  const postMutation = useFlightBillingPostMutation();
  const unbillMutation = useFlightBillingUnbillMutation();
  const batchPreviewMutation = useFlightBillingBatchPreviewMutation();
  const batchApplyMutation = useFlightBillingBatchApplyMutation();

  // ── Handlers ────────────────────────────────────────────────────────

  function toggleExpand(flight: BillableFlight) {
    const willExpand = expandedFlight !== flight.uuid;
    setExpandedFlight(willExpand ? flight.uuid : null);

    if (willExpand && !flightPreviews[flight.uuid]) {
      previewMutation.mutate(
        {
          flightUuid: flight.uuid,
          fiscalYearUuid: activeFiscalYearUuid,
        },
        {
          onSuccess: (data) => {
            setFlightPreviews((prev) => ({
              ...prev,
              [flight.uuid]: data,
            }));
          },
        },
      );
    }
  }

  function handleRowPreview(flight: BillableFlight) {
    setExpandedFlight(flight.uuid);
    if (flightPreviews[flight.uuid]) return;

    previewMutation.mutate(
      {
        flightUuid: flight.uuid,
        fiscalYearUuid: activeFiscalYearUuid,
      },
      {
        onSuccess: (data) => {
          setFlightPreviews((prev) => ({
            ...prev,
            [flight.uuid]: data,
          }));
        },
      },
    );
  }

  function handleBatchPreview() {
    // Use selected flights if any, otherwise all flights on the current page
    const uuids =
      selectedFlights.size > 0
        ? Array.from(selectedFlights)
        : flights.map((f) => f.uuid);
    if (uuids.length === 0) return;
    batchPreviewMutation.mutate(
      {
        flight_uuids: uuids,
        fiscal_year_uuid: activeFiscalYearUuid,
      },
      {
        onSuccess: setBatchPreview,
      },
    );
  }

  function handleBatchApply() {
    if (!activeFiscalYearUuid) return;
    const uuids = flights.map((f) => f.uuid);
    batchApplyMutation.mutate(
      {
        flight_uuids: uuids,
        fiscal_year_uuid: activeFiscalYearUuid,
      },
      {
        onSuccess: () => {
          setBatchPreview(null);
          setFlightPreviews({});
        },
      },
    );
  }

  async function handleApply(flightUuid: string) {
    if (!activeFiscalYearUuid) return;
    setApplyFlightUuid(flightUuid);
    try {
      await applyMutation.mutateAsync({
        flightUuid,
        fiscalYearUuid: activeFiscalYearUuid,
      });
      setFlightPreviews((prev) => {
        const next = { ...prev };
        delete next[flightUuid];
        return next;
      });
    } finally {
      setApplyFlightUuid(null);
    }
  }

  async function handlePost(flightUuid: string) {
    if (!activeFiscalYearUuid) return;
    setPostFlightUuid(flightUuid);
    try {
      await postMutation.mutateAsync({
        flightUuid,
        fiscalYearUuid: activeFiscalYearUuid,
      });
      setFlightPreviews((prev) => {
        const next = { ...prev };
        delete next[flightUuid];
        return next;
      });
    } finally {
      setPostFlightUuid(null);
    }
  }

  async function handleUnbill(flightUuid: string) {
    setUnbillFlightUuid(flightUuid);
    try {
      await unbillMutation.mutateAsync(flightUuid);
      setFlightPreviews((prev) => {
        const next = { ...prev };
        delete next[flightUuid];
        return next;
      });
    } finally {
      setUnbillFlightUuid(null);
    }
  }

  function toggleSelect(uuid: string) {
    setSelectedFlights((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedFlights.size === flights.length) {
      setSelectedFlights(new Set());
    } else {
      setSelectedFlights(new Set(flights.map((f) => f.uuid)));
    }
  }

  function clearFilters() {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterType(undefined);
    setFilterLaunch(undefined);
    setFilterStatus("pending");
    setFilterPilot("");
    setFilterAsset("");
    setFlightPage(1);
  }

  async function handleExportCsv() {
    setIsExportingCsv(true);
    try {
      const allFlights = await fetchAllBillableFlights({
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        typeOfFlight: filterType,
        launchMethod: filterLaunch,
        status: filterStatus !== "pending" ? filterStatus : undefined,
        pilotQuery: resolvedPilot,
        assetCode: resolvedAsset,
      });
      const headers = [
        t("flights:table.date", "Date"),
        t("flights:table.pilot", "Pilote"),
        t("flights:table.secondPilot", "Second"),
        t("flights:table.glider", "Planeur"),
        t("flights:table.type", "Type vol"),
        t("flights:table.duration", "Durée"),
        t("flights:table.launch", "Lancement"),
        t("flights:table.amount", "Montant"),
        t("flights:table.status", "Statut"),
        t("flights:table.observations", "Observations"),
      ];
      const rows = allFlights.map((f) => [
        f.jour ? new Date(f.jour).toLocaleDateString("fr-FR") : "",
        f.pilot_name ?? f.pilot_erp_id ?? "",
        f.second_pilot_name
          ? formatSecondPilot(f)
          : f.charge_to_name
            ? `Fact: ${f.charge_to_name}`
            : "",
        f.asset_code ?? "",
        f.type_label ?? String(f.type_of_flight ?? ""),
        formatDuration(f.takeoff_time, f.landing_time),
        formatLaunchMethod(f),
        formatMoney(f.total_preview),
        f.status,
        f.observations ?? "",
      ]);
      exportRowsToCsv("vols.csv", headers, rows);
    } finally {
      setIsExportingCsv(false);
    }
  }

  // ── Derived state ───────────────────────────────────────────────────
  const isLoading = flightsQuery.isLoading;
  const isPreviewing = previewMutation.isPending;
  const isBatchPreviewing = batchPreviewMutation.isPending;
  const isApplying = batchApplyMutation.isPending;
  const busy = isLoading || isPreviewing || isBatchPreviewing || isApplying;
  const totalPages = flightsQuery.data?.total_pages ?? 1;
  const hasActiveFilters =
    !!filterDateFrom ||
    !!filterDateTo ||
    filterType !== undefined ||
    filterLaunch !== undefined ||
    !!filterPilot ||
    !!filterAsset ||
    filterStatus !== "pending";

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {/* Date from */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterDateFrom", "Du")}
            </Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setFlightPage(1);
              }}
            />
          </div>
          {/* Date to */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterDateTo", "Au")}
            </Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setFlightPage(1);
              }}
            />
          </div>
          {/* Flight type */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterType", "Type")}
            </Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterType ?? ""}
              onChange={(e) => {
                setFilterType(
                  e.target.value ? Number(e.target.value) : undefined,
                );
                setFlightPage(1);
              }}
            >
              <option value="">
                {t("flights:table.filterAll", "Tous")}
              </option>
              <option value="0">Instruction</option>
              <option value="1">Solo</option>
              <option value="2">Initiation</option>
              <option value="3">Partage</option>
              <option value="4">Passager</option>
              <option value="5">Lâcher</option>
              <option value="6">Supervisé</option>
              <option value="7">Essai</option>
            </select>
          </div>
          {/* Launch method */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterLaunch", "Lancement")}
            </Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterLaunch ?? ""}
              onChange={(e) => {
                setFilterLaunch(
                  e.target.value ? Number(e.target.value) : undefined,
                );
                setFlightPage(1);
              }}
            >
              <option value="">
                {t("flights:table.filterAll", "Tous")}
              </option>
              <option value="0">Extérieur</option>
              <option value="1">Treuil</option>
              <option value="2">Remorqueur</option>
              <option value="3">Autonome</option>
            </select>
          </div>
          {/* Billing status */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterStatus", "Statut")}
            </Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setFlightPage(1);
              }}
            >
              <option value="pending">
                {t("ops.flights.status.pending", "En attente")}
              </option>
              <option value="applied">
                {t("ops.flights.status.applied", "Appliqué")}
              </option>
              <option value="posted">
                {t("ops.flights.status.posted", "Posté")}
              </option>
              <option value="all">
                {t("ops.flights.status.all", "Tous")}
              </option>
            </select>
          </div>
          {/* Pilot search */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterPilot", "Pilote")}
            </Label>
            <Input
              placeholder={t(
                "flights:table.filterPilotPlaceholder",
                "Nom ou ID…",
              )}
              value={filterPilot}
              onChange={(e) => {
                setFilterPilot(e.target.value);
                setFlightPage(1);
              }}
            />
          </div>
          {/* Asset code */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("flights:table.filterAsset", "Machine")}
            </Label>
            <Input
              placeholder={t(
                "flights:table.filterAssetPlaceholder",
                "Code machine…",
              )}
              value={filterAsset}
              onChange={(e) => {
                setFilterAsset(e.target.value);
                setFlightPage(1);
              }}
            />
          </div>
          {/* Actions */}
          <div className="flex items-end gap-2">
            {hasActiveFilters && (
              <Button
                size="sm"
                variant="secondary"
                onClick={clearFilters}
                type="button"
              >
                {t("flights:table.filterClear", "Effacer")}
              </Button>
            )}
          </div>
        </div>

        {/* Batch actions row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => flightsQuery.refetch()}
              disabled={busy}
              title={t("common.refresh", "Rafraîchir")}
            >
              <RotateCw
                className={`h-3.5 w-3.5 ${flightsQuery.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
            {flightsQuery.data && (
              <span className="text-xs text-slate-500">
                {t("flights:table.count", {
                  defaultValue: "{{total}} vol(s)",
                  total: flightsQuery.data.total,
                })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCsv}
              disabled={isExportingCsv || (flightsQuery.data?.total ?? 0) === 0}
            >
              {isExportingCsv ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              {t("flights:table.exportCsv", "Exporter CSV")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {canEditFlights && flights.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={handleBatchPreview}
              >
                {isBatchPreviewing ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1 h-3.5 w-3.5" />
                )}
                {t("ops.flights.preview", "Prévisualiser")}
              </Button>
            )}
            {canEditFlights && canPost && flights.length > 0 && (
              <Button
                size="sm"
                disabled={busy || !activeFiscalYearUuid}
                onClick={handleBatchApply}
              >
                {isApplying ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1 h-3.5 w-3.5" />
                )}
                {t("ops.flights.apply", "Appliquer tout")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Batch preview result */}
      {batchPreview && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {t("ops.flights.batchPreview.title", {
                  defaultValue: "Aperçu groupé ({{count}} vols)",
                  count: batchPreview.total,
                })}
              </p>
              <p className="text-xs text-slate-500">
                {batchPreview.billable_count}{" "}
                {t("ops.flights.batchPreview.billable", "facturable")}
                {batchPreview.billable_count > 1 ? "s" : ""}
                {batchPreview.error_count > 0 && (
                  <span className="ml-2 text-amber-600">
                    <AlertTriangle className="inline h-3 w-3" />{" "}
                    {batchPreview.error_count}{" "}
                    {t("ops.flights.batchPreview.errors", "erreur")}
                    {batchPreview.error_count > 1 ? "s" : ""}
                  </span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-slate-900">
                {formatMoney(batchPreview.total_amount)}
              </p>
            </div>
          </div>
          {batchPreview.total_amount !== "0" && canPost && activeFiscalYearUuid && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={handleBatchApply}
                disabled={isApplying}
              >
                {isApplying ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                )}
                {t("ops.flights.batchPreview.applyAll", "Appliquer tout")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Batch apply result */}
      {batchApplyMutation.data && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">
              {t("ops.flights.success.applied", {
                defaultValue: "{{count}} vol(s) facturé(s)",
                count: batchApplyMutation.data.success_count,
              })}
            </p>
            {batchApplyMutation.data.error_count > 0 && (
              <p className="text-sm text-amber-700">
                ({batchApplyMutation.data.error_count} erreur
                {batchApplyMutation.data.error_count > 1 ? "s" : ""})
              </p>
            )}
          </div>
        </div>
      )}

      {/* Flights table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-400">
              {t("common:loading", "Chargement…")}
            </span>
          </div>
        ) : flights.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center">
            <p className="text-sm text-slate-400">
              {t("ops.flights.empty", "Aucun vol à facturer")}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="w-8 px-2 py-3">
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-700"
                        onClick={toggleSelectAll}
                      >
                        {selectedFlights.size === flights.length &&
                        flights.length > 0 ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </th>
                    <th className="w-8 px-2 py-3" />
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.date", "Date")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.pilot", "Pilote")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.secondPilot", "Second / Charge")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.glider", "Machine")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.type", "Type")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.duration", "Durée")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("flights:table.launch", "Lancement")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("ops.flights.discount", "Remise")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("ops.flights.status", "Statut")}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">
                      {t("common:actions", "Actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((f: BillableFlight) => (
                    <Fragment key={f.uuid}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-slate-50 ${
                          selectedFlights.has(f.uuid) ? "bg-sky-50" : ""
                        }`}
                      >
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            className="text-slate-400 hover:text-slate-700"
                            onClick={() => toggleSelect(f.uuid)}
                          >
                            {selectedFlights.has(f.uuid) ? (
                              <CheckSquare className="h-4 w-4 text-sky-600" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                            onClick={() => toggleExpand(f)}
                          >
                            {expandedFlight === f.uuid ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                          {f.jour
                            ? new Date(f.jour).toLocaleDateString("fr-FR")
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                          {f.pilot_name ?? f.pilot_erp_id ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                          {f.second_pilot_name && (
                            <span>
                              {formatSecondPilot(f)}
                            </span>
                          )}
                          {f.second_pilot_name && f.charge_to_name && (
                            <span className="mx-1">·</span>
                          )}
                          {f.charge_to_name && (
                            <span>
                              {t("ops.flights.chargeTo", "Fact")}: {f.charge_to_name}
                            </span>
                          )}
                          {!f.second_pilot_name && !f.charge_to_name && (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {f.asset_code ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {f.type_label ?? String(f.type_of_flight ?? "—")}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                          {formatDuration(f.takeoff_time, f.landing_time)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                          {formatLaunchMethod(f)}
                        </td>
                        <td className="px-3 py-2">
                          {f.has_discount ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                              title="Remise forfait appliquée"
                            >
                              <Percent className="h-3 w-3" /> Pack
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(f.status)}`}
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {canEditFlights && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded p-1 text-slate-400 hover:text-slate-700"
                                title={t(
                                  "ops.flights.rawDetails",
                                  "Détails bruts (BDD)",
                                )}
                                onClick={() =>
                                  setDetailFlightUuid(f.uuid)
                                }
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40"
                                title={t(
                                  "ops.flights.preview",
                                  "Aperçu facturation",
                                )}
                                disabled={
                                  isPreviewing &&
                                  previewMutation.variables
                                    ?.flightUuid === f.uuid
                                }
                                onClick={() => handleRowPreview(f)}
                              >
                                {isPreviewing &&
                                previewMutation.variables
                                  ?.flightUuid === f.uuid ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Play className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {canPost && f.status === "pending" && (
                                <>
                                  <button
                                    type="button"
                                    className="rounded p-1 text-blue-400 hover:text-blue-700 disabled:opacity-40"
                                    title={t(
                                      "ops.flights.apply",
                                      "Appliquer (Draft)",
                                    )}
                                    disabled={
                                      applyFlightUuid === f.uuid ||
                                      !activeFiscalYearUuid
                                    }
                                    onClick={() => handleApply(f.uuid)}
                                  >
                                    {applyFlightUuid === f.uuid ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1 text-emerald-400 hover:text-emerald-700 disabled:opacity-40"
                                    title={t(
                                      "ops.flights.applyPost",
                                      "Appliquer + Post",
                                    )}
                                    disabled={
                                      postFlightUuid === f.uuid ||
                                      !activeFiscalYearUuid
                                    }
                                    onClick={() => handlePost(f.uuid)}
                                  >
                                    {postFlightUuid === f.uuid ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Send className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </>
                              )}
                              {canPost && f.status === "applied" && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-amber-500 hover:text-amber-700 disabled:opacity-40"
                                  title={t(
                                    "ops.flights.unbill",
                                    "Annuler la facturation (Draft)",
                                  )}
                                  disabled={unbillFlightUuid === f.uuid}
                                  onClick={() => handleUnbill(f.uuid)}
                                >
                                  {unbillFlightUuid === f.uuid ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Undo2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandedFlight === f.uuid && (
                        <tr key={`${f.uuid}-expanded`}>
                          <td
                            colSpan={12}
                            className="bg-slate-50/50 px-6 py-4"
                          >
                            {/* Flight tags */}
                            {(f.observations ||
                              f.correction_reason ||
                              f.aero) && (
                              <div className="mb-3 flex flex-wrap gap-3">
                                {f.aero && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                                    {t("flights:table.aerodrome", "Aérodrome")}:{" "}
                                    {f.aero}
                                  </span>
                                )}
                                {f.observations && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700"
                                    title={f.observations}
                                  >
                                    💬{" "}
                                    {f.observations.length > 50
                                      ? f.observations.slice(0, 50) + "…"
                                      : f.observations}
                                  </span>
                                )}
                                {f.correction_reason && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700"
                                    title={f.correction_reason}
                                  >
                                    ✏️{" "}
                                    {t(
                                      "flights:table.correction",
                                      "Corr.",
                                    )}:{" "}
                                    {f.correction_reason.length > 50
                                      ? f.correction_reason.slice(0, 50) +
                                        "…"
                                      : f.correction_reason}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Editable billing fields — only for unbilled flights */}
                            {f.status === "pending" && (
                              <EditableChargeFields flight={f} />
                            )}

                            {/* Preview panel */}
                            {previewMutation.error &&
                            previewMutation.variables
                              ?.flightUuid === f.uuid ? (
                              <Alert>
                                <p className="text-sm text-red-700">
                                  {previewMutation.error instanceof Error
                                    ? previewMutation.error.message
                                    : t(
                                        "ops.flights.errors.preview",
                                        "Erreur de chargement de l'aperçu",
                                      )}
                                </p>
                              </Alert>
                            ) : flightPreviews[f.uuid] ? (
                              <FlightPreviewPanel
                                preview={flightPreviews[f.uuid]}
                              />
                            ) : (
                              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t(
                                  "common:loading",
                                  "Chargement de l'aperçu…",
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 border-t border-slate-100 px-4 py-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage <= 1}
                  onClick={() =>
                    setFlightPage((p) => Math.max(1, p - 1))
                  }
                >
                  {t("flights:table.prev", "Précédent")}
                </Button>
                <span className="px-2 text-sm text-slate-700">
                  {t("flights:table.pageInfo", {
                    defaultValue: "Page {{page}}/{{total}}",
                    page: flightPage,
                    total: totalPages,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage >= totalPages}
                  onClick={() => setFlightPage((p) => p + 1)}
                >
                  {t("flights:table.next", "Suivant")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Global errors */}
      {batchPreviewMutation.error && (
        <Alert>
          <p className="text-sm text-red-700">
            {batchPreviewMutation.error instanceof Error
              ? batchPreviewMutation.error.message
              : t(
                  "ops.flights.errors.preview",
                  "Erreur de prévisualisation",
                )}
          </p>
        </Alert>
      )}
      {batchApplyMutation.error && (
        <Alert>
          <p className="text-sm text-red-700">
            {batchApplyMutation.error instanceof Error
              ? batchApplyMutation.error.message
              : t(
                  "ops.flights.errors.apply",
                  "Erreur d'application",
                )}
          </p>
        </Alert>
      )}

      <FlightDetailDialog
        flightUuid={detailFlightUuid}
        onClose={() => setDetailFlightUuid(null)}
      />
    </div>
  );
}
