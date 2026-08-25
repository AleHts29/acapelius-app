// Sistema UNICO de chips de estado (design system §3.4): mismo texto y color
// en Ventas, Rendiciones, Direccion y Asistencia. Prohibido expresar estado
// de otra forma.

import type { Sale } from '../api/client'
import { formatMoney } from '../lib/format'

export type ChipTone = 'ok' | 'warn' | 'blue' | 'danger' | 'neutral'

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return <span className={`chip chip--${tone}`}>{children}</span>
}

/** Chip de estado de una venta, derivado siempre con la misma regla. */
export function SaleChip({ sale }: { sale: Pick<Sale, 'voided_at' | 'is_comp' | 'payment_status' | 'payment_method' | 'amount_cents'> }) {
  if (sale.voided_at !== null) return <Chip tone="danger">Anulada</Chip>
  if (sale.is_comp) return <Chip tone="blue">Cortesía</Chip>
  if (sale.payment_status === 'paid') {
    return <Chip tone="ok">{sale.payment_method === 'transfer' ? 'Pagó (transf.)' : 'Pagó'}</Chip>
  }
  return <Chip tone="warn">Debe {formatMoney(sale.amount_cents)}</Chip>
}

/** Chip de saldo a rendir de una corista. */
export function BalanceChip({ balanceCents }: { balanceCents: number }) {
  if (balanceCents > 0) return <Chip tone="warn">Debe {formatMoney(balanceCents)}</Chip>
  if (balanceCents < 0) return <Chip tone="ok">A favor {formatMoney(-balanceCents)}</Chip>
  return <Chip tone="ok">Al día</Chip>
}
