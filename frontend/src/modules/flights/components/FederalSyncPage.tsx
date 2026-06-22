/*
    ERP-CLUB - ERP pour Club de vol à voile
    - FederalSyncPage: Tableau de bord synchronisation fédérale générique (GesAsso / OSRT)
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

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useFederalSyncStatusQuery,
  useFederalSyncMutation,
  type SyncStatusItem,
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
  3: { label: "Échec",        icon: AlertCircle,   badgeClass: "badge-destructive" },
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FederalSyncPageProps {
  platform: "gesasso" | "osrt";
  label: string;
}

export function FederalSyncPage({ platform, label }: FederalSyncPageProps) {
  const { t } = useTranslation("flights");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: syncStatus = [], isLoading, refetch } = useFederalSyncStatusQuery(platform);
  const syncMutation = useFederalSyncMutation(platform);

  const toggleSelect = (uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === syncStatus.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(syncStatus.map((r) => r.flight_uuid)));
    }
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

  const columns = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={syncStatus.length > 0 && selected.size === syncStatus.length}
          onCheckedChange={toggleAll}
          aria-label="Tout sélectionner"
        />
      ),
      cell: (row: SyncStatusItem) => (
        <Checkbox
          checked={selected.has(row.flight_uuid)}
          onCheckedChange={() => toggleSelect(row.flight_uuid)}
          aria-label="Sélectionner ce vol"
        />
      ),
      className: "w-10",
    },
    {
      key: "flight_uuid",
      header: t("federalSync.colFlight", "Vol (UUID)"),
      cell: (row: SyncStatusItem) => (
        <span className="font-mono text-xs text-muted-foreground">{row.flight_uuid.slice(0, 8)}…</span>
      ),
    },
    {
      key: "status",
      header: t("federalSync.colStatus", "Statut {{label}}", { label }),
      cell: (row: SyncStatusItem) => <StatusBadge status={row.status} />,
    },
    {
      key: "external_id",
      header: t("federalSync.colExternalId", "ID externe"),
      cell: (row: SyncStatusItem) =>
        row.external_id ? (
          <span className="font-mono text-xs">{row.external_id}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "last_attempt_at",
      header: t("federalSync.colLastAttempt", "Dernière tentative"),
      cell: (row: SyncStatusItem) =>
        row.last_attempt_at ? (
          <span className="text-xs">{new Date(row.last_attempt_at).toLocaleString("fr-FR")}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  const selectedArr = Array.from(selected);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">
          {t("federalSync.title", "Synchronisation {{label}}", { label })}
        </h2>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isLoading}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          {t("common.refresh", "Actualiser")}
        </Button>

        <Button
          size="sm"
          onClick={() => handleSync(selectedArr)}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          {syncMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {t("federalSync.syncSelected", "Envoyer ({{count}})", { count: selected.size })}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => handleSync(selectedArr, true)}
          disabled={selected.size === 0 || syncMutation.isPending}
          title={t("federalSync.forceHint", "Renvoie même les vols déjà transférés")}
        >
          {t("federalSync.forceResend", "Forcer le renvoi")}
        </Button>
      </div>

      {/* Selection summary */}
      {selected.size > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("federalSync.selectedCount", "{{count}} vol(s) sélectionné(s)", {
            count: selected.size,
          })}
        </p>
      )}

      {/* Table */}
      <DataTable<SyncStatusItem>
        columns={columns}
        data={syncStatus}
        getRowKey={(row) => row.flight_uuid}
        emptyState={
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("federalSync.empty", "Aucun vol synchronisé sur cette plateforme.")}
          </p>
        }
      />
    </div>
  );
}
