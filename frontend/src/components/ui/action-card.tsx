/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - ActionCard: carte cliquable pour grille d'actions (Admin, RH, Intégrations)
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

export interface ActionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick?: () => void;
}

/**
 * ActionCard — carte cliquable pour les grilles d'actions.
 *
 * Inspiré du pattern Lovable pour Admin, RH et Intégrations :
 * ```
 * ┌─────────────────────────────────────────────┐
 * │ [icon]  Title                               │
 * │         Description text                     │
 * └─────────────────────────────────────────────┘
 * ```
 */
export function ActionCard({ icon: Icon, title, description, onClick }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:border-accent/40"
    >
      <div className="rounded-lg bg-secondary p-2.5">
        <Icon className="h-5 w-5 text-accent" />
      </div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
