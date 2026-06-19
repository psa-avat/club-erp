export type LedgerEntry = {
  id: number
  amount: string
  label: string
}

// ── PCG Seed ──────────────────────────────────────────────────────────────────

export type PcgSeedItem = {
  code: string
  name: string
  type: number // 1=Asset,2=Liability,3=Equity,4=Expense,5=Revenue
  is_posting_allowed: boolean
  is_reconcilable: boolean
  require_id: number // 0=none,1=member,2=asset,3=supplier
}

export type PcgSeedExportResponse = {
  items: PcgSeedItem[]
  total: number
}

export type PcgSeedImportRequest = {
  items: PcgSeedItem[]
}
