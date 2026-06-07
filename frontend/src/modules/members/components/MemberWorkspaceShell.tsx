/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Shared workspace shell — tabbed member space for both club and portal contexts
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
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { InitialsAvatar } from './MemberRowBadges';
import { memberCategoryLabel } from './membersShared';
import { useMemberQuery } from '../api';
import type {
  WorkspaceMode,
  WorkspaceTab,
  WorkspaceTabDefinition,
} from '../types/workspace';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const ALL_TABS: WorkspaceTabDefinition[] = [
  { id: 'logbook', label: 'Carnet de vol', icon: '📖' },
  { id: 'balance', label: 'Solde & Dépôts', icon: '💰' },
  { id: 'club-expenses', label: 'Notes de frais', icon: '🧾' },
  { id: 'volunteer-fiscal', label: 'Fiscal bénévole', icon: '📋' },
  { id: 'documents', label: 'Documents', icon: '📄' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemberWorkspaceShellProps {
  memberUuid: string;
  mode: WorkspaceMode;
}

// ---------------------------------------------------------------------------
// Placeholder tab content (phases 2-5)
// ---------------------------------------------------------------------------

function TabPlaceholder({ tab }: { tab: WorkspaceTab }) {
  const labels: Record<WorkspaceTab, string> = {
    logbook: 'Carnet de vol — à venir',
    balance: 'Solde & Dépôts — à venir',
    'club-expenses': 'Notes de frais — à venir',
    'volunteer-fiscal': 'Fiscal bénévole — à venir',
    documents: 'Documents — à venir',
  };
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12">
      <p className="text-sm text-slate-500">{labels[tab]}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  tab,
  isActive,
  onClick,
}: {
  tab: WorkspaceTabDefinition;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'border-b-2 border-blue-600 text-blue-700'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      <span>{tab.icon}</span>
      <span>{tab.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MemberWorkspaceShell
// ---------------------------------------------------------------------------

export function MemberWorkspaceShell({ memberUuid, mode }: MemberWorkspaceShellProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('logbook');

  const memberQuery = useMemberQuery(memberUuid);
  const member = memberQuery.data;

  return (
    <section className="space-y-6">
      {/* ── Header ── */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            {mode === 'club' && (
              <button
                type="button"
                onClick={() => navigate('/club/members/core')}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title="Retour à l'annuaire"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            {member ? (
              <>
                <InitialsAvatar firstName={member.first_name} lastName={member.last_name} />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-900">
                      {member.first_name} {member.last_name}
                    </h2>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {memberCategoryLabel(member.member_category)}
                    </span>
                  </div>
                  <p className="font-mono text-sm text-slate-500">
                    {member.account_id}
                    {member.trigram && (
                      <>
                        {' '}
                        <span className="text-slate-300">|</span> {member.trigram}
                      </>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <div className="h-10 w-48 animate-pulse rounded bg-slate-200" />
            )}
          </div>

          {/* ── Header actions ── */}
          <div className="flex items-center gap-2">
            {mode === 'club' && member && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    /* Phase 8 — send portal access */
                  }}
                  disabled={!member.email}
                  title={!member.email ? "L'adhérent n'a pas d'email renseigné" : undefined}
                >
                  <Mail className="mr-1.5 h-4 w-4" />
                  Envoyer l'accès
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/club/members/${memberUuid}/edit`)}
                >
                  Modifier
                </Button>
              </>
            )}
            {mode === 'portal' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  /* Phase 8 — change token dialog */
                }}
              >
                🔑 Changer le code
              </Button>
            )}
          </div>
        </div>

        {/* ── Tab navigation ── */}
        <nav className="flex flex-wrap gap-0 border-t border-slate-200 bg-slate-50/50 px-4">
          {ALL_TABS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </nav>
      </div>

      {/* ── Tab content ── */}
      <div>
        {activeTab === 'logbook' && <TabPlaceholder tab="logbook" />}
        {activeTab === 'balance' && <TabPlaceholder tab="balance" />}
        {activeTab === 'club-expenses' && <TabPlaceholder tab="club-expenses" />}
        {activeTab === 'volunteer-fiscal' && <TabPlaceholder tab="volunteer-fiscal" />}
        {activeTab === 'documents' && <TabPlaceholder tab="documents" />}
      </div>
    </section>
  );
}
