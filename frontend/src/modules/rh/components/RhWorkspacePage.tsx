/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - RhWorkspacePage: Workspace RH (tabs: conges, presences, equipe, calendriers)
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
import { Calendar, CalendarDays, Clock, Users } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";

import { TeamProfilesPage } from "./TeamProfilesPage";
import { CalendarManagementPage } from "./CalendarManagementPage";

/**
 * RhWorkspacePage — Workspace Ressources Humaines.
 *
 * Tabs :
 * - conges      → Planning des congés (Placeholder)
 * - presences   → Suivi du temps / présences (Placeholder)
 * - equipe      → Profils employés (TeamProfilesPage)
 * - calendriers → Saisons, calendriers, affectations (CalendarManagementPage)
 */
export function RhWorkspacePage() {
  const { t } = useTranslation("rh");

  return (
    <WorkspaceShell
      title={t("workspace.title", "Ressources humaines")}
      description={t(
        "workspace.description",
        "Gestion des employés, congés et présences.",
      )}
      tabs={[
        {
          value: "conges",
          label: t("workspace.tabs.leaves", "Congés"),
          icon: CalendarDays,
          content: (
            <PlaceholderPage
              title={t("workspace.tabs.leaves", "Planning des congés")}
              description="Demandes de congés, planification et suivi des soldes."
              eta="Phase 10"
            />
          ),
        },
        {
          value: "presences",
          label: t("workspace.tabs.attendance", "Présences"),
          icon: Clock,
          content: (
            <PlaceholderPage
              title={t("workspace.tabs.attendance", "Suivi des présences")}
              description="Enregistrement des heures de présence et permanences."
              eta="Phase 10"
            />
          ),
        },
        {
          value: "equipe",
          label: t("workspace.tabs.team", "Équipe"),
          icon: Users,
          content: <TeamProfilesPage />,
        },
        {
          value: "calendriers",
          label: t("workspace.tabs.calendars", "Calendriers"),
          icon: Calendar,
          content: <CalendarManagementPage />,
        },
      ]}
    />
  );
}
