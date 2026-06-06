import { useState } from 'react'
import {
  useMemberPortalFlights,
  useMemberPortalFlightBilling,
} from '../api'

export function FlightsPage() {
  const [expandedFlight, setExpandedFlight] = useState<string | null>(null)
  const { data, isLoading } = useMemberPortalFlights()

  function toggleExpand(uuid: string) {
    setExpandedFlight((prev) => (prev === uuid ? null : uuid))
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Mes vols</h1>

      {isLoading ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm text-slate-400">Aucun vol trouvé</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((flight) => (
            <div
              key={flight.uuid}
              className="rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() => toggleExpand(flight.uuid)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <span className="text-sm text-slate-400">
                  {expandedFlight === flight.uuid ? '▼' : '▶'}
                </span>
                <span className="min-w-[80px] text-sm font-medium text-slate-700">
                  {flight.jour ?? '—'}
                </span>
                <span className="min-w-[80px] text-sm text-slate-600">
                  {flight.asset_code ?? '—'}
                </span>
                <span className="flex-1 text-sm text-slate-600">
                  {flight.type_label ?? `Type ${flight.type_of_flight}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    flight.billing_quote_state === 'posted'
                      ? 'bg-green-100 text-green-700'
                      : flight.billing_quote_state === 'applied'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {flight.billing_quote_state === 'posted'
                    ? 'Comptabilisé'
                    : flight.billing_quote_state === 'applied'
                      ? 'Brouillon'
                      : 'En attente'}
                </span>
                {flight.has_discount && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Forfait
                  </span>
                )}
              </button>

              {expandedFlight === flight.uuid && (
                <FlightDetail flightUuid={flight.uuid} />
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.total > 50 && (
        <p className="text-center text-sm text-slate-400">
          {data.total} vol(s) — utilisez les filtres pour réduire
        </p>
      )}
    </div>
  )
}

function FlightDetail({ flightUuid }: { flightUuid: string }) {
  const { data, isLoading } = useMemberPortalFlightBilling(flightUuid)

  if (isLoading) {
    return (
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-400">Chargement…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-400">Aucune facturation disponible</p>
      </div>
    )
  }

  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="space-y-3">
        {data.applied_lines.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Lignes de facturation</p>
            {data.applied_lines.map((line, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-sm">
                <span className="text-slate-600">
                  {line.asset_code} — {line.pricing_item_name}
                </span>
                <span className="font-medium text-slate-800">
                  {line.amount} €
                </span>
              </div>
            ))}
          </div>
        )}

        {data.consumptions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-blue-600">Remises forfait</p>
            {data.consumptions.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-sm">
                <span className="text-slate-600">
                  {c.pack_type} — {c.quantity_consumed} unité(s)
                </span>
                <span className="font-medium text-green-600">
                  -{c.total_discount_amount} €
                </span>
              </div>
            ))}
          </div>
        )}

        {data.entry_state && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-medium">
            <span className="text-slate-600">Net à payer</span>
            <span className={Number(data.total_discount) > 0 ? 'text-green-600' : 'text-slate-800'}>
              {data.net_amount} €
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
