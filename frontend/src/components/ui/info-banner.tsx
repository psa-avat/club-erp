/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - InfoBanner: bannière d'information avec bordure dashed et icône accent
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
import { cn } from "@/lib/utils";

export interface InfoBannerProps {
  icon?: LucideIcon;
  children: React.ReactNode;
  variant?: "info" | "warning" | "success" | "destructive";
}

const variantStyles: Record<string, string> = {
  info: "border-accent/30 text-accent",
  warning: "border-[color:var(--color-warning)]/30 text-[color:var(--color-warning)]",
  success: "border-[color:var(--color-success)]/30 text-[color:var(--color-success)]",
  destructive: "border-destructive/30 text-destructive",
};

const iconStyles: Record<string, string> = {
  info: "text-accent",
  warning: "text-[color:var(--color-warning)]",
  success: "text-[color:var(--color-success)]",
  destructive: "text-destructive",
};

/**
 * InfoBanner — Bannière d'information avec bordure dashed.
 *
 * Inspiré du pattern Lovable : `rounded-xl border border-dashed bg-card/50 p-4`.
 * Utilisé pour les informations contextuelles (date d'effet, alertes, etc.).
 */
export function InfoBanner({ icon: Icon, children, variant = "info" }: InfoBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-dashed bg-card/50 p-4 text-sm",
        variantStyles[variant],
      )}
    >
      {Icon && <Icon className={cn("h-4 w-4 shrink-0", iconStyles[variant])} />}
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}
