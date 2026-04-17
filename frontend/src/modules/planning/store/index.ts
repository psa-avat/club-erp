import { create } from 'zustand'

type PlanningState = {
  selectedDate: string | null
  setSelectedDate: (isoDate: string | null) => void
}

export const usePlanningStore = create<PlanningState>((set) => ({
  selectedDate: null,
  setSelectedDate: (isoDate) => set({ selectedDate: isoDate }),
}))
