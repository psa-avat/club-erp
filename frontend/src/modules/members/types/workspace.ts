/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Workspace context types for shared member workspace (club + portal)
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

export type WorkspaceMode = 'club' | 'portal';

export interface WorkspaceContext {
  /** Which context is rendering the workspace */
  mode: WorkspaceMode;
  /** The member UUID being viewed (from URL in club mode, from JWT in portal mode) */
  memberUuid: string;
  /** Whether the current view is read-only (portal mode for most things) */
  readOnly: boolean;
}

export type WorkspaceTab = 'logbook' | 'balance' | 'club-expenses' | 'volunteer-fiscal' | 'documents';

export interface WorkspaceTabDefinition {
  id: WorkspaceTab;
  label: string;
  icon: string;
}
