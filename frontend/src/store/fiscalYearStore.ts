/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - shell: Global fiscal year Zustand store — single source of truth for active FY across all modules
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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { FiscalYear } from '../modules/banque/api'

type FiscalYearState = {
  /** UUID of the fiscal year currently active in all modules. */
  activeFiscalYearUuid: string | null
  /** Full metadata for the active FY (for display: code, year, state, dates). */
  activeFiscalYearData: FiscalYear | null
  /**
   * Optional override for the budget module — allows planning for FY+1
   * without affecting the accounting/pricing/reporting views.
   */
  secondaryFiscalYearUuid: string | null

  setActiveFiscalYear: (uuid: string, data: FiscalYear) => void
  setSecondaryFiscalYear: (uuid: string) => void
  clearSecondary: () => void
}

export const useFiscalYearStore = create<FiscalYearState>()(
  persist(
    (set) => ({
      activeFiscalYearUuid: null,
      activeFiscalYearData: null,
      secondaryFiscalYearUuid: null,

      setActiveFiscalYear: (uuid, data) =>
        set({ activeFiscalYearUuid: uuid, activeFiscalYearData: data }),

      setSecondaryFiscalYear: (uuid) => set({ secondaryFiscalYearUuid: uuid }),

      clearSecondary: () => set({ secondaryFiscalYearUuid: null }),
    }),
    { name: 'fiscal-year-store' },
  ),
)
