/*
    ERP-CLUB - ERP pour Club de vol à voile
    - FederalSyncPage: vérification et envoi manuel des vols vers GesAsso
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

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useFederalSyncCandidatesQuery,
  useFederalSyncMutation,
  type SyncCandidateItem,
} from "../api";

// ---------------------------------------------------------------------------
// Status badge config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  number,
  { label: string; icon: React.ElementType; badgeClass: string }
> = {
  0: { label: "Non envoyé",   icon: Clock,         badgeClass: "bg-muted text-muted-foreground" },
  1: { label: "En attente",   icon: Clock,         badgeClass: "badge-warning" },
  2: { label: "Transféré",    icon: CheckCircle2,  badgeClass: "badge-success" },
  3: { label: "Échec",        icon: XCircle,       badgeClass: "badge-destructive" },
  4: { label: "Ignoré",       icon: XCircle,       badgeClass: "bg-muted text-muted-foreground line-through" },
};

function StatusBadge({ status }: { status: number }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG[0];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function defaultMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FederalSyncPageProps {
  platform: "gesasso";
  label: string;
}

export function FederalSyncPage({ platform, label }: FederalSyncPageProps) {
  const { t } = useTranslation("flights");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const defaults = useMemo(defaultMonthRange, []);
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "sent" | "failed" | "blocked">("");

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    statusFilter: statusFilter || undefined,
    page,
    pageSize: 50,
  };

  const { data, isLoading, isFetching, refetch } = useFederalSyncCandidatesQuery(platform, filters);
  const syncMutation = useFederalSyncMutation(platform);

  const items = data?.items ?? [];
  const summary = data?.summary ?? { pending: 0, sent: 0, failed: 0, blocked: 0 };

  const notYetSentSelectableUuids = items
    .filter((r) => !r.issues.some((i) => i.blocking) && r.status !== 2)
    .map((r) => r.flight_uuid);

  const toggleSelect = (uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const toggleAll = () => {
    const allSelected = notYetSentSelectableUuids.length > 0 &&
      notYetSentSelectableUuids.every((u) => selected.has(u));
    setSelected(allSelected ? new Set() : new Set(notYetSentSelectableUuids));
  };

  const handleSync = (uuids: string[], force = false) => {
    if (uuids.length === 0) return;
    syncMutation.mutate(
      { flightUuids: uuids, force },
      {
        onSuccess: (result) => {
          const parts: string[] = [];
          if (result.synced > 0) parts.push(`${result.synced} transféré(s)`);
          if (result.already_transferred > 0)
            parts.push(`${result.already_transferred} déjà transféré(s)`);
          if (result.failed > 0) parts.push(`${result.failed} échec(s)`);
          toast.success(parts.join(" · ") || "Synchronisation terminée");
          setSelected(new Set());
          void refetch();
        },
        onError: () => toast.error("Erreur lors de la synchronisation"),
      }
    );
  };

  const applyFilters = () => {
    setPage(1);
    setSelected(new Set());
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatusFilter("");
    setPage(1);
    setSelected(new Set());
  };

  const columns = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={notYetSentSelectableUuids.length > 0 && notYetSentSelectableUuids.every((u) => selected.has(u))}
          onCheckedChange={toggleAll}
          aria-label={t("federalSync.selectAll", "Tout sélectionner")}
        />
      ),
      cell: (row: SyncCandidateItem) => (
        <Checkbox
          checked={selected.has(row.flight_uuid)}
          disabled={row.issues.some((i) => i.blocking)}
          onCheckedChange={() => toggleSelect(row.flight_uuid)}
          aria-label={t("federalSync.selectRow", "Sélectionner ce vol")}
        />
      ),
      className: "w-10",
    },
    {
      key: "jour",
      header: t("federalSync.colDate", "Date"),
      cell: (row: SyncCandidateItem) => (
        <span className="text-xs">{row.jour ? new Date(row.jour).toLocaleDateString("fr-FR") : "—"}</span>
      ),
    },
    {
      key: "pilot",
      header: t("federalSync.colPilot", "Pilote"),
      cell: (row: SyncCandidateItem) => (
        <span className="text-xs">{row.pilot_name ?? "—"}</span>
      ),
    },
    {
      key: "second_pilot",
      header: t("federalSync.colSecondPilot", "Instructeur / 2e pilote"),
      cell: (row: SyncCandidateItem) => (
        <span className="text-xs text-muted-foreground">{row.second_pilot_name ?? "—"}</span>
      ),
    },
    {
      key: "asset_code",
      header: t("federalSync.colAircraft", "Aéronef"),
      cell: (row: SyncCandidateItem) => (
        <span className="font-mono text-xs">{row.asset_code ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: t("federalSync.colStatus", "Statut {{label}}", { label }),
      cell: (row: SyncCandidateItem) => <StatusBadge status={row.status} />,
    },
    {
      key: "issues",
      header: t("federalSync.colIssues", "Blocage"),
      cell: (row: SyncCandidateItem) => {
        if (row.issues.length === 0) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        const isBlocking = row.issues.some((i) => i.blocking);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex cursor-help items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                  isBlocking ? "badge-destructive" : "badge-warning"
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                {isBlocking ? t("federalSync.blocked", "Bloqué") : t("federalSync.info", "À vérifier")}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <ul className="list-disc pl-3">
                {row.issues.map((issue) => (
                  <li key={issue.code}>{t(`federalSync.issues.${issue.code}`, issue.code)}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      key: "external_id",
      header: t("federalSync.colExternalId", "ID externe"),
      cell: (row: SyncCandidateItem) =>
        row.external_id ? (
          <span className="font-mono text-xs">{row.external_id}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "last_attempt_at",
      header: t("federalSync.colLastAttempt", "Dernière tentative"),
      cell: (row: SyncCandidateItem) =>
        row.last_attempt_at ? (
          <span className="text-xs">{new Date(row.last_attempt_at).toLocaleString("fr-FR")}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  const selectedArr = Array.from(selected);
  const hasAlreadySentSelected = selectedArr.some(
    (uuid) => items.find((r) => r.flight_uuid === uuid)?.status === 2
  );

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">{t("federalSync.kpi.pending", "En attente")}</div>
          <div className="text-lg font-semibold">{summary.pending}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">{t("federalSync.kpi.sent", "Transférés")}</div>
          <div className="text-lg font-semibold text-emerald-600">{summary.sent}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">{t("federalSync.kpi.failed", "Échecs")}</div>
          <div className="text-lg font-semibold text-destructive">{summary.failed}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">{t("federalSync.kpi.blocked", "Bloqués")}</div>
          <div className="text-lg font-semibold text-amber-600">{summary.blocked}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("federalSync.filters.dateFrom", "Du")}</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("federalSync.filters.dateTo", "Au")}</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("federalSync.filters.status", "Statut")}</Label>
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as typeof statusFilter))}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("federalSync.filters.all", "Tous")}</SelectItem>
              <SelectItem value="pending">{t("federalSync.kpi.pending", "En attente")}</SelectItem>
              <SelectItem value="sent">{t("federalSync.kpi.sent", "Transférés")}</SelectItem>
              <SelectItem value="failed">{t("federalSync.kpi.failed", "Échecs")}</SelectItem>
              <SelectItem value="blocked">{t("federalSync.kpi.blocked", "Bloqués")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={applyFilters}>{t("federalSync.filters.apply", "Filtrer")}</Button>
        <Button size="sm" variant="outline" onClick={clearFilters}>{t("federalSync.filters.clear", "Effacer les filtres")}</Button>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("common.refresh", "Actualiser")}
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">
          {t("federalSync.title", "Synchronisation {{label}}", { label })}
        </h2>

        <Button
          size="sm"
          onClick={() => handleSync(selectedArr)}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          {syncMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {t("federalSync.syncSelected", "Envoyer ({{count}})", { count: selected.size })}
        </Button>

        {hasAlreadySentSelected && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSync(selectedArr, true)}
            disabled={selected.size === 0 || syncMutation.isPending}
            title={t("federalSync.forceHint", "Renvoie même les vols déjà transférés")}
          >
            {t("federalSync.forceResend", "Forcer le renvoi")}
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("federalSync.selectedCount", "{{count}} vol(s) sélectionné(s)", {
            count: selected.size,
          })}
        </p>
      )}

      {/* Table */}
      <DataTable<SyncCandidateItem>
        columns={columns}
        data={items}
        getRowKey={(row) => row.flight_uuid}
        emptyState={
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isLoading
              ? t("common.loading", "Chargement…")
              : t("federalSync.empty", "Aucun vol dans cette période.")}
          </p>
        }
      />

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t("table.prev", "Précédent")}
          </Button>
          <span className="px-2 text-sm text-muted-foreground">
            {t("table.pageInfo", "Page {{page}} / {{total}}", { page, total: data.total_pages })}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
            {t("table.next", "Suivant")}
          </Button>
        </div>
      )}
    </div>
  );
}
