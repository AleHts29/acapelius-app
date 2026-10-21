// El estado (C19 §4.5): punto de color + palabra. Es el ÚNICO sistema de
// estado de la app: mismo texto y mismo color en Ventas, Rendiciones, Equipo,
// Temporadas, Asistencia y Puerta. Prohibido expresar estado de otra forma.
// El punto nunca va solo: el color no puede ser la única señal.

import type { ReactNode } from 'react'

import type { Sale } from '../api/client'
import { formatMoney } from '../lib/format'

export type StatusTone = 'ok' | 'warn' | 'bad' | 'cor' | 'mute'

export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`st st--${tone}`}>
      <i aria-hidden />
      {children}
    </span>
  )
}

/**
 * El estado de una venta, siempre con la misma regla. Cuando falta plata
 * muestra el SALDO, no el total: con cobros parciales una venta de $24.000
 * con $16.000 cobrados debe $8.000.
 */
export function SaleStatus({
  sale,
}: {
  sale: Pick<Sale, 'voided_at' | 'is_comp' | 'payment_method' | 'amount_cents' | 'paid_cents'>
}) {
  if (sale.voided_at !== null) return <Status tone="bad">Anulada</Status>
  if (sale.is_comp) return <Status tone="cor">Cortesía</Status>
  const falta = sale.amount_cents - sale.paid_cents
  if (falta > 0) return <Status tone="warn">Debe {formatMoney(falta)}</Status>
  return <Status tone="ok">{sale.payment_method === 'transfer' ? 'Pagó (transf.)' : 'Pagó'}</Status>
}

/** El saldo a rendir de una corista. */
export function BalanceStatus({ balanceCents }: { balanceCents: number }) {
  if (balanceCents > 0) return <Status tone="warn">Debe {formatMoney(balanceCents)}</Status>
  if (balanceCents < 0) return <Status tone="ok">A favor {formatMoney(-balanceCents)}</Status>
  return <Status tone="ok">Al día</Status>
}
