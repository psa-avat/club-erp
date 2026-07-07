/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FinanceAccountingCockpitPage: tableau de bord comptable "à faire"
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

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  ListChecks,
  Repeat,
  ScanSearch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCapability } from "@/auth/hooks/useCapability";
import { useFiscalYearStore } from "@/store/fiscalYearStore";
import { useAccountingHealthQuery } from "../api";

// ── Cockpit tile ──────────────────────────────────────────────────────────────

interface CockpitTileProps {
  icon: LucideIcon;
  title: string;
  count: number;
  goodStateLabel: string;
  hint?: string;
  action?: { label: string; to: string };
}

function CockpitTile({ icon: Icon, title, count, goodStateLabel, hint, action }: CockpitTileProps) {
  const hasIssue = count > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-5",
        hasIssue ? "border-[color:var(--color-warning)]/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        <div
          className={cn(
            "rounded-md p-1.5",
            hasIssue ? "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]" : "bg-secondary text-accent",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>

      {hasIssue ? (
        <>
          <span className="tabular text-2xl font-semibold text-foreground">{count}</span>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {action && (
            <Button size="sm" variant="outline" asChild className="mt-1 w-fit">
              <Link to={action.to}>{action.label}</Link>
            </Button>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-[color:var(--color-success)]" />
          {goodStateLabel}
        </div>
      )}
    </div>
  );
}

// ── FinanceAccountingCockpitPage ──────────────────────────────────────────────

export function FinanceAccountingCockpitPage() {
  const { t } = useTranslation("banque");
  const canPost = useCapability("POST_ACCOUNTING_ENTRIES");
  const canManageSettings = useCapability("MANAGE_ACCOUNTING_SETTINGS");
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid);

  const healthQuery = useAccountingHealthQuery(fiscalYearUuid ?? undefined);
  const health = healthQuery.data;

  if (healthQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("workspace.accounting.cockpit.loading", "Chargement…")}</p>;
  }

  if (!health || !health.fiscal_year) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-warning)]/40 bg-card p-5 text-sm">
        <AlertTriangle className="h-4 w-4 text-[color:var(--color-warning)]" />
        {t("workspace.accounting.cockpit.noFiscalYear", "Aucun exercice comptable actif. Créez un exercice pour commencer.")}
      </div>
    );
  }

  const draftsLink = "/workspace/finance?tab=comptabilite&section=saisie&subtab=journal&preset=drafts";
  const missingTiersLink = "/workspace/finance?tab=comptabilite&section=saisie&subtab=journal&preset=missing-tiers";
  const reconciliationLink = "/workspace/finance?tab=comptabilite&section=rapprochement";
  const recurrentesLink = "/workspace/finance?tab=comptabilite&section=parametres&subtab=recurrentes";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CockpitTile
          icon={ListChecks}
          title={t("workspace.accounting.cockpit.drafts.title", "Écritures à valider")}
          count={health.draft_entries_count}
          goodStateLabel={t("workspace.accounting.cockpit.drafts.empty", "Aucune écriture à valider")}
          hint={
            canPost
              ? t("workspace.accounting.cockpit.drafts.hintCanPost", "En brouillon, en attente de validation.")
              : t("workspace.accounting.cockpit.drafts.hintCannotPost", "Préparées, en attente de validation par un comptable.")
          }
          action={
            canPost
              ? { label: t("workspace.accounting.cockpit.drafts.action", "Valider"), to: draftsLink }
              : { label: t("workspace.accounting.cockpit.drafts.viewAction", "Voir"), to: draftsLink }
          }
        />

        <CockpitTile
          icon={ScanSearch}
          title={t("workspace.accounting.cockpit.unreconciled.title", "Lignes bancaires à rapprocher")}
          count={health.unreconciled_bank_lines_count}
          goodStateLabel={t("workspace.accounting.cockpit.unreconciled.empty", "Aucune ligne en attente de rapprochement")}
          action={{ label: t("workspace.accounting.cockpit.unreconciled.action", "Rapprocher"), to: reconciliationLink }}
        />

        <CockpitTile
          icon={AlertTriangle}
          title={t("workspace.accounting.cockpit.discrepancies.title", "Écarts de rapprochement")}
          count={health.reconciliation_discrepancies_count}
          goodStateLabel={t("workspace.accounting.cockpit.discrepancies.empty", "Aucun écart détecté")}
          action={
            canPost
              ? { label: t("workspace.accounting.cockpit.discrepancies.action", "Résoudre"), to: reconciliationLink }
              : { label: t("workspace.accounting.cockpit.discrepancies.viewAction", "Voir"), to: reconciliationLink }
          }
        />

        <CockpitTile
          icon={FileWarning}
          title={t("workspace.accounting.cockpit.missingTiers.title", "Écritures sans tiers")}
          count={health.missing_required_tiers_count}
          goodStateLabel={t("workspace.accounting.cockpit.missingTiers.empty", "Toutes les écritures ont un tiers renseigné")}
          action={{ label: t("workspace.accounting.cockpit.missingTiers.action", "Compléter"), to: missingTiersLink }}
        />

        <CockpitTile
          icon={Repeat}
          title={t("workspace.accounting.cockpit.recurring.title", "Écritures récurrentes dues")}
          count={health.due_recurring_entries_count}
          goodStateLabel={t("workspace.accounting.cockpit.recurring.empty", "Aucune écriture récurrente due")}
          hint={
            !canManageSettings
              ? t("workspace.accounting.cockpit.recurring.hintNoAccess", "À générer par un administrateur comptable.")
              : undefined
          }
          action={
            canManageSettings
              ? { label: t("workspace.accounting.cockpit.recurring.action", "Générer"), to: recurrentesLink }
              : undefined
          }
        />

        <div
          className={cn(
            "flex flex-col gap-2 rounded-xl border bg-card p-5",
            health.fiscal_year.state === 2 ? "border-[color:var(--color-warning)]/40" : "border-border",
          )}
        >
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("workspace.accounting.cockpit.fiscalYear.title", "Exercice comptable")}
            </span>
            <div className="rounded-md bg-secondary p-1.5 text-accent">
              <CalendarClock className="h-3.5 w-3.5" />
            </div>
          </div>
          <span className="text-lg font-semibold text-foreground">{health.fiscal_year.label}</span>
          <span className="text-xs text-muted-foreground">
            {health.fiscal_year.state === 2
              ? t("workspace.accounting.cockpit.fiscalYear.closed", "Clôturé")
              : t("workspace.accounting.cockpit.fiscalYear.open", "Ouvert")}
          </span>
          {health.fiscal_year.state !== 2 && canManageSettings && (
            <Button size="sm" variant="outline" asChild className="mt-1 w-fit">
              <Link to="/admin?tab=parametres&subtab=exercices">
                {t("workspace.accounting.cockpit.fiscalYear.checkClose", "Vérifier la clôture")}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
