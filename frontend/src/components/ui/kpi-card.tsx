/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - KpiCard: dashboard KPI indicator card (shadcn style)
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

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  accent?: "default" | "success" | "warning" | "destructive";
}

/**
 * KpiCard — dashboard indicator card.
 *
 * Inspiré de la maquette Lovable. Affiche un label, une valeur,
 * un indicateur de tendance optionnel, une icône et un hint.
 */
export function KpiCard({ label, value, hint, icon: Icon, trend, accent = "default" }: KpiCardProps) {
  const accentClass = {
    default: "text-accent",
    success: "text-[color:var(--color-success)]",
    warning: "text-[color:var(--color-warning)]",
    destructive: "text-destructive",
  }[accent];

  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card p-5 transition-colors hover:border-accent/40">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={cn("rounded-md bg-secondary p-1.5", accentClass)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold text-foreground">{value}</span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.positive ? "text-[color:var(--color-success)]" : "text-destructive",
            )}
          >
            {trend.positive ? "+" : ""}
            {trend.value}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
