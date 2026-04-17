import { create } from 'zustand'

type DashboardState = {
  activeWidget: string | null
  setActiveWidget: (widgetName: string | null) => void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeWidget: null,
  setActiveWidget: (widgetName) => set({ activeWidget: widgetName }),
}))
