/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - help: HelpToc — module navigation list for the Help Center
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
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";
import type { HelpTocEntry } from "../types";

export interface HelpTocProps {
  entries: HelpTocEntry[];
  className?: string;
}

export function HelpToc({ entries, className }: HelpTocProps) {
  const { t } = useTranslation("help");

  return (
    <nav className={cn("flex flex-col gap-0.5", className)} aria-label={t("toc.ariaLabel")}>
      {entries.map((entry) => (
        <NavLink
          key={entry.slug}
          to={`/help/${entry.slug}`}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )
          }
        >
          {t(entry.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
