import { create } from 'zustand'

import type { MemberFilters } from '../types'

type MembersStore = {
  selectedMemberId: string | null
  selectedYear: number
  filters: MemberFilters
  setSelectedMemberId: (memberId: string | null) => void
  setSelectedYear: (year: number) => void
  setFilters: (filters: MemberFilters) => void
}

const currentYear = new Date().getUTCFullYear()

export const useMembersStore = create<MembersStore>((set) => ({
  selectedMemberId: null,
  selectedYear: currentYear,
  filters: {
    year: currentYear,
    status: 1,
  },
  setSelectedMemberId: (selectedMemberId) => set({ selectedMemberId }),
  setSelectedYear: (selectedYear) =>
    set((state) => ({
      selectedYear,
      filters: {
        ...state.filters,
        year: selectedYear,
      },
    })),
  setFilters: (filters) => set({ filters }),
}))

