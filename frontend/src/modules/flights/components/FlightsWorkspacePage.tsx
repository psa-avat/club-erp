/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FlightsWorkspacePage: Workspace Facturation & Vols (tabs: vols, facturation, packs, sync)
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

import { useTranslation } from "react-i18next";
import { Plane, Tags, Database, ArrowLeftRight, Plug } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { FlightsBillingPage } from "./FlightsBillingPage";
import { FederalSyncPage } from "./FederalSyncPage";
import { OpsPacksTab } from "../../banque";
import { PlancheFlightsPullPage } from "../../planche";

/**
 * FlightsWorkspacePage — Workspace Facturation & Vols.
 *
 * Regroupe en une seule page avec tabs :
 * - vols      → Cockpit facturation unifié (FlightsBillingPage — fusion vols + facturation)
 * - packs     → Achats et consommation forfaits (OpsPacksTab)
 * - gesasso   → Envoi Gesasso (placeholder, Phase 8)
 * - osrt      → Envoi OSRT (placeholder, Phase 8)
 * - sync      → Import vols depuis Planche (PlancheFlightsPullPage)
 *
 * Note: les tabs "vols" et "facturation" ont été fusionnés en un seul cockpit
 * facturation (FlightsBillingPage) qui combine la liste détaillée des vols
 * avec les actions billing (aperçu, appliquer, post, batch).
 */
export function FlightsWorkspacePage() {
  const { t } = useTranslation("flights");

  return (
    <WorkspaceShell
      title={t("workspace.title", "Facturation & Vols")}
      description={t(
        "workspace.description",
        "Saisie des vols, facturation OSRT/Gesasso, packs et import Planche.",
      )}
      helpSlug="flights"
      actions={
        <span />
      }
      tabs={[
        {
          value: "vols",
          label: t("workspace.tabs.vols", "Vols"),
          icon: Plane,
          content: <FlightsBillingPage />,
        },
        {
          value: "packs",
          label: t("workspace.tabs.packs", "Packs"),
          icon: Tags,
          content: <OpsPacksTab />,
        },
        {
          value: "gesasso",
          label: t("workspace.tabs.gesasso", "Envoi GesAsso"),
          icon: ArrowLeftRight,
          content: <FederalSyncPage platform="gesasso" label="GesAsso" />,
        },
        {
          value: "osrt",
          label: t("workspace.tabs.osrt", "Envoi OSRT"),
          icon: Plug,
          content: <FederalSyncPage platform="osrt" label="OSRT" />,
        },
        {
          value: "sync",
          label: t("workspace.tabs.sync", "Sync Planche"),
          icon: Database,
          content: <PlancheFlightsPullPage />,
        },
      ]}
    />
  );
}
