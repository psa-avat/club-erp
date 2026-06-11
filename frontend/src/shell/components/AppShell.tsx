import { Outlet } from 'react-router-dom'
import { useState } from 'react'

import { Header } from './Header'
import { Drawer } from './Drawer'
import { AlertsBanner } from './AlertsBanner'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onOpenDrawer={() => setDrawerOpen(true)} />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="min-h-[calc(100vh-4rem)] p-4 md:p-6">
        <AlertsBanner />
        <Outlet />
      </main>
    </div>
  )
}
