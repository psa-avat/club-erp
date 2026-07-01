/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - help: PortalHelpButton — portal-scoped help entry point for member-portal
      users. Reuses HelpContent but only ever loads the "portal" slug, since
      the member portal is a separate authenticated principal that must never
      see staff-oriented sections (Admin, RH, Comptabilité, etc.) — see
      docs/plans/help-documentation-feature.md.
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

import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpContent } from "./HelpContent";
import { loadHelpContent } from "../content/moduleContentMap";
import type { HelpLocale } from "../types";

const PORTAL_HELP_SLUG = "portal";

export function PortalHelpButton() {
  const { t, i18n } = useTranslation("help");
  const locale: HelpLocale = i18n.language === "en" ? "en" : "fr";
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadHelpContent(PORTAL_HELP_SLUG, locale).then((result) => {
      if (!cancelled) setMarkdown(result?.markdown ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, locale]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("headerButton.ariaLabel")}
        title={t("headerButton.ariaLabel")}
        className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("center.title")}</DialogTitle>
        </DialogHeader>
        {markdown === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <HelpContent markdown={markdown} />
        )}
      </DialogContent>
    </Dialog>
  );
}
