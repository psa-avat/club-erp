import { create } from 'zustand'

type BanqueState = {
  activeMemberId: number | null
  setActiveMemberId: (memberId: number | null) => void
}

export const useBanqueStore = create<BanqueState>((set) => ({
  activeMemberId: null,
  setActiveMemberId: (memberId) => set({ activeMemberId: memberId }),
}))
