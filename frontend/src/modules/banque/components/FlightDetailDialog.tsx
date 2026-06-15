/*
    ERP-CLUB - ERP pour Club de vol à voile
    - FlightDetailDialog: Modal showing complete raw flight data from DB
      with enum labels resolved and data grouped by category
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Loader2, AlertCircle, Database } from 'lucide-react'
import { useFlightRawDetailsQuery, type RawFlightDetails } from '../api'

interface FlightDetailDialogProps {
  flightUuid: string | null
  onClose: () => void
}

// ── Display helpers ──────────────────────────────────────────────────────

function val(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return String(value)
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('fr-FR')
  } catch {
    return iso
  }
}

// ── Field row component ──────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] gap-2 py-1.5 text-sm border-b border-slate-100 last:border-0">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="text-slate-900 font-mono text-xs break-all">{children}</span>
    </div>
  )
}

// ── Section component ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">{title}</h3>
      <div className="bg-slate-50/50 rounded-lg px-3 py-1">{children}</div>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  return <Field label={label}>{val(value)}</Field>
}

// ── Main component ───────────────────────────────────────────────────────

export function FlightDetailDialog({ flightUuid, onClose }: FlightDetailDialogProps) {
  const { data: flight, isLoading, isError, error } = useFlightRawDetailsQuery(flightUuid)

  return (
    <Dialog open={!!flightUuid} onClose={onClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-500" />
            Détails bruts du vol
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-500">Chargement...</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Erreur: {(error as Error)?.message ?? 'Impossible de charger les détails du vol'}</span>
          </div>
        )}

        {flight && <FlightDetailsContent flight={flight} />}
      </DialogContent>
    </Dialog>
  )
}

// ── Content rendered when flight data is available ───────────────────────

function FlightDetailsContent({ flight }: { flight: RawFlightDetails }) {
  return (
    <div className="space-y-1">
      {/* ── Identification ── */}
      <Section title="Identification">
        <FieldRow label="UUID" value={flight.uuid} />
        <FieldRow label="Planche UUID" value={flight.planche_uuid} />
        <FieldRow label="Aérodrome" value={flight.aero} />
        <FieldRow label="Snapshot UUID" value={flight.source_snapshot_uuid} />
      </Section>

      {/* ── Date & Aéronef ── */}
      <Section title="Date &amp; Aéronef">
        <FieldRow label="Date du vol" value={flight.jour} />
        <FieldRow label="Immatriculation" value={flight.asset_code} />
        <FieldRow label="ERP Glider ID" value={flight.glider_erp_id} />
      </Section>

      {/* ── Pilotes & Facturation ── */}
      <Section title="Pilotes &amp; Facturation">
        <FieldRow label="Pilote (ERP ID)" value={flight.pilot_erp_id} />
        <FieldRow label="Pilote (nom)" value={flight.pilot_name} />
        <FieldRow label="Pilote (compta ID)" value={flight.pilot_compta_id} />
        <FieldRow label="2nd pilote (ERP ID)" value={flight.second_pilot_erp_id} />
        <FieldRow label="2nd pilote (nom)" value={flight.second_pilot_name} />
        <FieldRow label="2nd pilote (legacy ID)" value={flight.second_pilot_id} />
        <FieldRow label="Facturé à (ERP ID)" value={flight.charge_to_erp_id} />
        <FieldRow label="Facturé à (nom)" value={flight.charge_to_name} />
        <FieldRow label="Facturé à (compta ID)" value={flight.charge_to_compta_id} />
        <FieldRow label="Commentaire facturation" value={flight.charge_comment} />
        <FieldRow label="Split instruction" value={flight.instruction_split} />
        <FieldRow label="VI (ERP ID)" value={flight.vi_erp_id} />
        <FieldRow label="VI (nom)" value={flight.vi_name} />
      </Section>

      {/* ── Type de vol & Lancement ── */}
      <Section title="Type de vol &amp; Lancement">
        <Field label="Type de vol">
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">{flight.type_of_flight}</span>
            <span>{flight.type_label ?? '—'}</span>
          </span>
        </Field>
        <Field label="Méthode de lancement">
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">{flight.launch_method}</span>
            <span>{flight.launch_method_label ?? '—'}</span>
          </span>
        </Field>
        <FieldRow label="Type de lancement (code)" value={flight.launch_type} />
      </Section>

      {/* ── Machine de lancement ── */}
      <Section title="Machine de lancement">
        <FieldRow label="Immat remorqueur/treuil" value={flight.launch_asset_code} />
        <FieldRow label="ERP Launch Machine ID" value={flight.launch_machine_erp_id} />
        <FieldRow label="Pilote remorqueur (trigram)" value={flight.launch_pilot_trigram} />
        <FieldRow label="Instructeur lancement (trigram)" value={flight.launch_instructor_trigram} />
      </Section>

      {/* ── Temps & Mesures ── */}
      <Section title="Temps &amp; Mesures">
        <FieldRow label="Décollage (HH:MM)" value={flight.takeoff_time} />
        <FieldRow label="Atterrissage (HH:MM)" value={flight.landing_time} />
        <FieldRow label="Index début" value={flight.start_index} />
        <FieldRow label="Index fin" value={flight.stop_index} />
        <FieldRow label="Temps moteur (1/100 h)" value={flight.engine_time} />
        <FieldRow label="Nombre d'atterrissages" value={flight.landing_count} />
        <FieldRow label="Distance (km)" value={flight.flight_km} />
        <FieldRow label="Décollage (ICAO)" value={flight.takeoff_location} />
        <FieldRow label="Atterrissage (ICAO)" value={flight.landed_location} />
        <FieldRow label="Observations" value={flight.observations} />
      </Section>

      {/* ── Statut ERP ── */}
      <Section title="Statut ERP">
        <Field label="Statut">
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">{flight.erp_status}</span>
            <span>{flight.erp_status_label ?? '—'}</span>
          </span>
        </Field>
        <FieldRow label="Validé le" value={formatDate(flight.validated_at)} />
        <FieldRow label="Validé par" value={flight.validated_by} />
        <FieldRow label="Transféré le" value={formatDate(flight.transferred_at)} />
        <FieldRow label="Transféré par" value={flight.transferred_by} />
        <FieldRow label="Révision" value={flight.revision} />
        <FieldRow label="Source status" value={flight.source_status} />
        <FieldRow label="Corrigé le" value={formatDate(flight.corrected_at)} />
        <FieldRow label="Corrigé par" value={flight.corrected_by} />
        <FieldRow label="Raison correction" value={flight.correction_reason} />
        <FieldRow label="Dernier hash export" value={flight.last_export_hash} />
      </Section>

      {/* ── Comptabilité ── */}
      <Section title="Comptabilité">
        <FieldRow label="Écriture comptable UUID" value={flight.accounting_entry_uuid} />
        <FieldRow label="État du devis" value={flight.billing_quote_state} />
        <Field label="Remise (pack) appliquée">
          <span className={`inline-flex items-center gap-1.5 ${flight.has_discount ? 'text-blue-600' : 'text-slate-400'}`}>
            {flight.has_discount ? 'Oui' : 'Non'}
          </span>
        </Field>
      </Section>
    </div>
  )
}
