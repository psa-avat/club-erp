import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { LoginPage, ProtectedRoute, PublicOnlyRoute } from './auth'
import { GlobalMenuBar } from './components/layout'
import { PricingPage } from './modules/pricing'

function DashboardHome() {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Gestion du club</h1>
      <p className="max-w-2xl text-sm text-slate-600">
        Utilisez la barre de menu globale pour naviguer entre les modules. Connectez-vous depuis
        le bouton en haut a droite pour acceder aux pages protegees.
      </p>
    </section>
  )
}

function AppFrame() {
  return (
    <div className="min-h-screen">
      <GlobalMenuBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route path="/" element={<DashboardHome />} />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/pricing" element={<PricingPage />} />
        </Route>

        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes>
  )
}

export default App
