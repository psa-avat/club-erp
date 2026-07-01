/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MembersWorkspacePage: workspace Membres (annuaire, commissions, reinscription)
 */

import { useTranslation } from "react-i18next";
import { ClipboardList, RefreshCw, Users } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { MembersListPage } from "./MembersListPage";
import { CommitteesManagementPage } from "./CommitteesManagementPage";

export function MembersWorkspacePage() {
  const { t } = useTranslation("members");

  return (
    <WorkspaceShell
      title={t("workspace.members.title", "Membres")}
      description={t(
        "workspace.members.description",
        "Annuaire, commissions et réinscription.",
      )}
      helpSlug="members"
      tabs={[
        {
          value: "annuaire",
          label: t("workspace.members.tabs.directory", "Annuaire"),
          icon: Users,
          content: <MembersListPage defaultScreen="core" />,
        },
        {
          value: "commissions",
          label: t("workspace.members.tabs.committees", "Commissions"),
          icon: ClipboardList,
          content: <CommitteesManagementPage />,
        },
        {
          value: "reinscription",
          label: t("workspace.members.tabs.renewal", "Réinscription"),
          icon: RefreshCw,
          content: (
            <PlaceholderPage
              title={t("workspace.members.renewal.title", "Réinscription en ligne")}
              description={t(
                "workspace.members.renewal.description",
                "Configuration annuelle (licence, type de tarif, heures) et module de réinscription.",
              )}
              eta="Phase 10"
            />
          ),
        },
      ]}
    />
  );
}
