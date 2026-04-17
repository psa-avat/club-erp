import { create } from 'zustand'

type ClubState = {
  selectedMemberId: number | null
  setSelectedMemberId: (memberId: number | null) => void
}

export const useClubStore = create<ClubState>((set) => ({
  selectedMemberId: null,
  setSelectedMemberId: (memberId) => set({ selectedMemberId: memberId }),
}))
