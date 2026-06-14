/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MembersWorkspacePage: workspace Membres (annuaire, commissions, fiches, reinscription)
 */

import { useTranslation } from "react-i18next";
import { ClipboardList, FileText, RefreshCw, Users } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { MembersListPage } from "./MembersListPage";
import { CommitteesManagementPage } from "./CommitteesManagementPage";
import { MemberSheetsPage } from "./MemberSheetsPage";

export function MembersWorkspacePage() {
  const { t } = useTranslation("members");

  return (
    <WorkspaceShell
      title={t("workspace.members.title", "Membres")}
      description={t(
        "workspace.members.description",
        "Annuaire, commissions, fiches pilotes et reinscription.",
      )}
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
          value: "fiches",
          label: t("workspace.members.tabs.sheets", "Fiches"),
          icon: FileText,
          content: <MemberSheetsPage />,
        },
        {
          value: "reinscription",
          label: t("workspace.members.tabs.renewal", "Reinscription"),
          icon: RefreshCw,
          content: (
            <PlaceholderPage
              title={t("workspace.members.renewal.title", "Reinscription en ligne")}
              description={t(
                "workspace.members.renewal.description",
                "Module de reinscription pour les membres. Accessible depuis l'espace membre.",
              )}
              eta="Phase 10"
            />
          ),
        },
      ]}
    />
  );
}
