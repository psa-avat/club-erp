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
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, FileText, FolderOpen, Key, Mail, Receipt, Wallet } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { InitialsAvatar } from './MemberRowBadges';
import { memberCategoryLabel } from './membersShared';
import {
  useDisableExpenseAccessMutation,
  useEnableExpenseAccessMutation,
  useMemberQuery,
  useMemberSheetsQuery,
} from '../api';
import { getPortalProfile } from '../../member-portal/api/client';
import { useChangePortalPasswordMutation } from '../../member-portal/api';
import { MemberLogbookTab } from './MemberLogbookTab';
import { MemberBalanceTab } from './MemberBalanceTab';
import { useMembersStore } from '../store';
import type {
  WorkspaceMode,
  WorkspaceTab,
  WorkspaceTabDefinition,
} from '../types/workspace';
import type { MemberPortalProfile } from '../../member-portal/types';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const ALL_TABS: WorkspaceTabDefinition[] = [
  { id: 'logbook', labelKey: 'workspaceTabLogbook', icon: BookOpen },
  { id: 'balance', labelKey: 'workspaceTabBalance', icon: Wallet },
  { id: 'club-expenses', labelKey: 'workspaceTabExpenses', icon: Receipt },
  { id: 'volunteer-fiscal', labelKey: 'workspaceTabVolunteerFiscal', icon: FileText },
  { id: 'documents', labelKey: 'workspaceTabDocuments', icon: FolderOpen },
  { id: 'portal-access', labelKey: 'workspaceTabPortalAccess', icon: Key, clubOnly: true },
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

function TabPlaceholder({ labelKey }: { labelKey: string }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12">
      <p className="text-sm text-slate-500">{t(labelKey)} — {t('close')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal access tab (club mode only)
// ---------------------------------------------------------------------------

function PortalAccessTab({ memberUuid }: { memberUuid: string }) {
  const { t } = useTranslation('members');
  const { selectedYear, setSelectedYear } = useMembersStore();

  const memberSheetsQuery = useMemberSheetsQuery(memberUuid);
  const enableExpenseAccessMutation = useEnableExpenseAccessMutation();
  const disableExpenseAccessMutation = useDisableExpenseAccessMutation();

  const sheets = memberSheetsQuery.data ?? [];
  const selectedYearSheet = sheets.find((s) => s.year === selectedYear) ?? null;

  const [expenseToken, setExpenseToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  async function handleEnableExpenseAccess() {
    const response = await enableExpenseAccessMutation.mutateAsync({
      memberUuid,
      year: selectedYear,
    });
    setExpenseToken(response.generated_token);
  }

  async function handleDisableExpenseAccess() {
    await disableExpenseAccessMutation.mutateAsync({ memberUuid, year: selectedYear });
    setExpenseToken(null);
  }

  async function handleCopyToken() {
    if (!expenseToken) return;
    try {
      await navigator.clipboard.writeText(expenseToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      const el = document.getElementById('portal-token-value');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Year selector */}
      <div className="flex items-center gap-3">
        <Label className="whitespace-nowrap text-xs text-on-surface-variant" htmlFor="portal-year">
          {t('filters.year')}
        </Label>
        <Input
          id="portal-year"
          className="h-8 w-20 text-sm"
          type="number"
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
        />
      </div>

      {/* Portal access card */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">{t('sheet.portalAccess')}</p>
            <p className="mt-0.5 text-xs text-blue-600">{t('sheet.portalTokenDescription')}</p>
          </div>
          {selectedYearSheet?.expense_access_enabled ? (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              {t('sheet.portalActive')}
            </span>
          ) : (
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              {t('sheet.portalInactive')}
            </span>
          )}
        </div>

        {/* Generated token display */}
        {expenseToken && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-white p-3">
            <p className="text-xs font-medium text-blue-700">{t('sheet.generatedToken')}</p>
            <div className="mt-1 flex items-center gap-2">
              <code
                id="portal-token-value"
                className="flex-1 break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800"
              >
                {expenseToken}
              </code>
              <button
                type="button"
                onClick={handleCopyToken}
                className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                {tokenCopied ? t('sheet.tokenCopied') : t('sheet.copyToken')}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-amber-600">{t('sheet.tokenWarning')}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          {!selectedYearSheet?.expense_access_enabled ? (
            <button
              type="button"
              disabled={enableExpenseAccessMutation.isPending}
              onClick={handleEnableExpenseAccess}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {enableExpenseAccessMutation.isPending ? t('sheet.generating') : t('sheet.regenerateToken')}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={enableExpenseAccessMutation.isPending}
                onClick={handleEnableExpenseAccess}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {enableExpenseAccessMutation.isPending ? t('sheet.generating') : t('sheet.regenerateToken')}
              </button>
              <button
                type="button"
                disabled={disableExpenseAccessMutation.isPending}
                onClick={handleDisableExpenseAccess}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('sheet.disablePortal')}
              </button>
            </>
          )}
        </div>
      </div>
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
  const { t } = useTranslation('common');
  const Icon = tab.icon;
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
      <Icon className="h-4 w-4" />
      <span>{t(tab.labelKey)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MemberWorkspaceShell
// ---------------------------------------------------------------------------

export function MemberWorkspaceShell({ memberUuid, mode }: MemberWorkspaceShellProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const visibleTabs = ALL_TABS.filter((tab) => !tab.clubOnly || mode === 'club');

  // Read initial tab from URL search param ?tab=
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'logbook' as WorkspaceTab;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as WorkspaceTab | null;
    return tab && visibleTabs.some((t) => t.id === tab) ? tab : 'logbook' as WorkspaceTab;
  })();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const changePasswordMutation = useChangePortalPasswordMutation();

  const memberQuery = useMemberQuery(mode === 'club' ? memberUuid : null);
  const portalProfile = getPortalProfile<MemberPortalProfile>();

  const member = mode === 'club' ? memberQuery.data : portalProfile;

  return (
    <section className="space-y-6">
      {/* ── Header ── */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            {mode === 'club' && (
              <button
                type="button"
                onClick={() => navigate('/workspace/members')}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title={t('workspaceBackToDirectory')}
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
                    {mode === 'club' && (member as { trigram?: string | null }).trigram && (
                      <>
                        {' '}
                        <span className="text-slate-300">|</span> {(member as { trigram?: string | null }).trigram}
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
                    /* Phase 8 — send portal access email */
                  }}
                  disabled={!member.email}
                  title={!member.email ? t('workspaceNoEmail') : undefined}
                >
                  <Mail className="mr-1.5 h-4 w-4" />
                  {t('workspaceSendAccess')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/club/members/${memberUuid}/edit`)}
                >
                  {t('workspaceEdit')}
                </Button>
              </>
            )}
            {mode === 'portal' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPasswordDialog(true)}
              >
                <Key className="mr-1 h-4 w-4" />
                {t('workspaceChangePassword')}
              </Button>
            )}
          </div>
        </div>

        {/* ── Tab navigation ── */}
        <nav className="flex flex-wrap gap-0 border-t border-slate-200 bg-slate-50/50 px-4">
          {visibleTabs.map((tab) => (
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
        {activeTab === 'logbook' && <MemberLogbookTab memberUuid={memberUuid} mode={mode} />}
        {activeTab === 'balance' && <MemberBalanceTab memberUuid={memberUuid} mode={mode} />}
        {activeTab === 'club-expenses' && <TabPlaceholder labelKey="workspaceTabExpenses" />}
        {activeTab === 'volunteer-fiscal' && <TabPlaceholder labelKey="workspaceTabVolunteerFiscal" />}
        {activeTab === 'documents' && <TabPlaceholder labelKey="workspaceTabDocuments" />}
        {activeTab === 'portal-access' && mode === 'club' && (
          <PortalAccessTab memberUuid={memberUuid} />
        )}
      </div>

      {/* ── Password change dialog (portal mode) ── */}
      {showPasswordDialog && mode === 'portal' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800">{t('workspaceChangePassword')}</h3>

            {pwSuccess ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-emerald-700">{t('workspacePasswordChanged')}</p>
                <Button variant="secondary" size="sm" onClick={() => { setShowPasswordDialog(false); setPwSuccess(false); }}>
                  {t('workspaceClose')}
                </Button>
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                setPwError(null);
                if (!pwCurrent || !pwNew || !pwConfirm) {
                  setPwError(t('workspacePasswordRequired'));
                  return;
                }
                if (pwNew !== pwConfirm) {
                  setPwError(t('workspacePasswordMismatch'));
                  return;
                }
                if (pwNew.length < 6) {
                  setPwError(t('workspacePasswordTooShort'));
                  return;
                }
                try {
                  await changePasswordMutation.mutateAsync({ currentPassword: pwCurrent, newPassword: pwNew });
                  setPwSuccess(true);
                  setPwCurrent('');
                  setPwNew('');
                  setPwConfirm('');
                } catch {
                  setPwError(t('workspacePasswordWrong'));
                }
              }} className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">{t('workspacePasswordCurrent')}</label>
                  <Input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">{t('workspacePasswordNew')}</label>
                  <Input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">{t('workspacePasswordConfirm')}</label>
                  <Input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} className="mt-1" />
                </div>

                {pwError && <p className="text-sm text-red-600">{pwError}</p>}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowPasswordDialog(false)}>
                    {t('workspaceClose')}
                  </Button>
                  <Button type="submit" size="sm" disabled={changePasswordMutation.isPending}>
                    {changePasswordMutation.isPending ? t('workspaceSaving') : t('workspaceSave')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
