/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - AppHeader: shadcn header with user menu, fiscal year selector, search
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

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, Search, ChevronDown } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/auth/store/authStore";
import { useCurrentUser, useLogout } from "@/auth/api/useAuth";
import { ChangePasswordDialog } from "@/auth/components/ChangePasswordDialog";
import { useActiveFiscalYearQuery, useFiscalYearsQuery } from "@/modules/banque/api";
import { useFiscalYearStore } from "@/store/fiscalYearStore";
import type { FiscalYear } from "@/modules/banque/api";

// ── Fiscal Year widgets ───────────────────────────────────────────────────────

function fyStateBadgeClass(state: number): string {
  if (state === 1) return "badge-success";
  if (state === 3) return "badge-warning";
  return "badge-info";
}

function fyStateLabel(state: number): string {
  if (state === 1) return "Open";
  if (state === 3) return "Reopened";
  return "Closed";
}

type FiscalYearSelectorProps = {
  fiscalYears: FiscalYear[];
  activeFiscalYearUuid: string | null;
  onSelect: (uuid: string) => void;
};

function FiscalYearSelector({ fiscalYears, activeFiscalYearUuid, onSelect }: FiscalYearSelectorProps) {
  const activeFY = fiscalYears.find((fy) => fy.uuid === activeFiscalYearUuid) ?? fiscalYears[0];

  return (
    <div className="flex items-center gap-1.5">
      {activeFY ? (
        <Badge className={fyStateBadgeClass(activeFY.state)} variant="outline">
          {fyStateLabel(activeFY.state)}
        </Badge>
      ) : null}
      <Select value={activeFiscalYearUuid ?? ""} onValueChange={onSelect}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fiscalYears.map((fy) => (
            <SelectItem key={fy.uuid} value={fy.uuid} className="text-xs">
              {fy.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── AppHeader ─────────────────────────────────────────────────────────────────

export function AppHeader() {
  const navigate = useNavigate();
  const { i18n, t } = useTranslation("common");
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logoutMutation = useLogout();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const meQuery = useCurrentUser(Boolean(token));
  const canChangePassword = meQuery.data?.can_change_password !== false;

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid);
  const setActiveFiscalYear = useFiscalYearStore((s) => s.setActiveFiscalYear);
  const activeFiscalYearQuery = useActiveFiscalYearQuery(Boolean(token));
  const fiscalYearsQuery = useFiscalYearsQuery(Boolean(token));
  const fiscalYears = fiscalYearsQuery.data ?? [];

  useEffect(() => {
    if (!activeFiscalYearUuid && activeFiscalYearQuery.data) {
      const fy = activeFiscalYearQuery.data;
      setActiveFiscalYear(fy.uuid, fy);
    }
  }, [activeFiscalYearUuid, activeFiscalYearQuery.data, setActiveFiscalYear]);

  async function handleLogout() {
    await logoutMutation.mutateAsync();
    navigate("/", { replace: true });
  }

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join("").toUpperCase() || "U";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un membre, un vol, un appareil…"
          className="h-9 w-[220px] pl-8 lg:w-[340px]"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Language switcher */}
        <Select value={i18n.language} onValueChange={(v) => { void i18n.changeLanguage(v); }}>
          <SelectTrigger className="h-8 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr" className="text-xs">FR</SelectItem>
            <SelectItem value="en" className="text-xs">EN</SelectItem>
          </SelectContent>
        </Select>

        {/* Fiscal year selector (authenticated only) */}
        {token && fiscalYears.length > 0 ? (
          <FiscalYearSelector
            fiscalYears={fiscalYears}
            activeFiscalYearUuid={activeFiscalYearUuid}
            onSelect={(uuid) => {
              const fy = fiscalYears.find((f) => f.uuid === uuid);
              if (fy) setActiveFiscalYear(fy.uuid, fy);
            }}
          />
        ) : null}

        {/* Notification bell (placeholder) */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
        </Button>

        {/* User menu */}
        {token ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 px-1.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {initials}
                </div>
                <span className="hidden text-xs text-foreground md:inline">
                  {user?.prenom} {user?.nom}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{user?.prenom} {user?.nom}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {canChangePassword ? (
                <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
                  {t("auth.changePassword.title")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={logoutMutation.isPending}
                onClick={() => { void handleLogout(); }}
                className="text-destructive focus:text-destructive"
              >
                {logoutMutation.isPending ? t("auth.logoutLoading") : t("auth.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" onClick={() => navigate("/login")}>
            {t("auth.login")}
          </Button>
        )}
      </div>

      {showChangePassword ? (
        <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />
      ) : null}
    </header>
  );
}
