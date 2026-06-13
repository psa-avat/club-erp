/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - RhWorkspacePage: Workspace RH (tabs: conges, presences, equipe)
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
import { CalendarDays, Clock, Users } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";

/**
 * RhWorkspacePage — Workspace Ressources Humaines.
 *
 * Regroupe en une seule page avec tabs :
 * - conges     → Planning des congés (Placeholder, Phase 10)
 * - presences  → Suivi du temps / présences (Placeholder, Phase 10)
 * - equipe     → Annuaire interne et contrats (Placeholder, Phase 10)
 */
export function RhWorkspacePage() {
  const { t } = useTranslation("common");

  return (
    <WorkspaceShell
      title={t("workspace.rh.title", "Ressources humaines")}
      description={t(
        "workspace.rh.description",
        "Planning équipe, congés et présences.",
      )}
      tabs={[
        {
          value: "conges",
          label: t("workspace.rh.tabs.leaves", "Planning congés"),
          icon: CalendarDays,
          content: (
            <PlaceholderPage
              title={t("workspace.rh.leaves.title", "Planning des congés")}
              description={t(
                "workspace.rh.leaves.description",
                "Disponibilités, rotations, congés des instructeurs et membres d'équipe.",
              )}
              eta="Phase 10"
            />
          ),
        },
        {
          value: "presences",
          label: t("workspace.rh.tabs.attendance", "Suivi des présences"),
          icon: Clock,
          content: (
            <PlaceholderPage
              title={t("workspace.rh.attendance.title", "Suivi du temps")}
              description={t(
                "workspace.rh.attendance.description",
                "Heures de présence et permanences.",
              )}
              eta="Phase 10"
            />
          ),
        },
        {
          value: "equipe",
          label: t("workspace.rh.tabs.team", "Équipe"),
          icon: Users,
          content: (
            <PlaceholderPage
              title={t("workspace.rh.team.title", "Annuaire interne")}
              description={t(
                "workspace.rh.team.description",
                "Annuaire interne et contrats.",
              )}
              eta="Phase 10"
            />
          ),
        },
      ]}
    />
  );
}
