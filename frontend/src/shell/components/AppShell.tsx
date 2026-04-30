import { Outlet } from 'react-router-dom'
import { useState } from 'react'

import { Header } from './Header'
import { MobileDrawer } from './MobileDrawer'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
      <MobileDrawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <div className="mx-auto flex w-full w-full">
        <Sidebar />
        <main className="min-h-[calc(100vh-4rem)] flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
