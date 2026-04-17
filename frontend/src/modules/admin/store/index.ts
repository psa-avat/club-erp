import { create } from 'zustand'

type AdminState = {
  selectedUserId: number | null
  setSelectedUserId: (userId: number | null) => void
}

export const useAdminStore = create<AdminState>((set) => ({
  selectedUserId: null,
  setSelectedUserId: (userId) => set({ selectedUserId: userId }),
}))
