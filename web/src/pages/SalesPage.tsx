import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleRow } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime } from '../lib/format'
import { SaleChip } from '../ui/StatusChip'

const salesQueryKey = ['sales'] as const

function SaleCard({ sale, isAdmin }: { sale: SaleRow; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: salesQueryKey })
  const onError = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const setPayment = useMutation({
    mutationFn: ({ paid, method }: { paid: boolean; method?: PaymentMethod }) =>
      api.updateSalePayment(sale.id, paid ? 'paid' : 'pending', method),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (err) => onError(err, 'No se pudo actualizar el pago.'),
  })

  const resend = useMutation({
    mutationFn: () => api.resendSaleEmail(sale.id),
    onSuccess: ({ email_status }) => {
      setError(email_status === 'sent' ? null : 'El email no salió. Probá de nuevo.')
    },
    onError: (err) => onError(err, 'No se pudo reenviar el email.'),
  })

  const voidSale = useMutation({
    mutationFn: () => api.voidSale(sale.id),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (err) => onError(err, 'No se pudo anular la venta.'),
  })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicSaleURL(sale.code))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('No se pudo copiar; abrí la entrada y compartila desde ahí.')
    }
  }

  const voided = sale.voided_at !== null

  return (
    <div className={`lrow${voided ? ' panel--voided' : ''}`}>
      <div className="lrow__head">
        <span>
          <b>{sale.buyer_name}</b>
          <span className="lrow__sub" style={{ display: 'block' }}>
            {sale.quantity} {sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
            {formatDateTime(sale.function_starts_at)}
            {isAdmin && <> · vendió {sale.seller_name}</>}
          </span>
        </span>
        <SaleChip sale={sale} />
      </div>

      {error && (
        <p className="alert" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}

      {!voided && (
        <div className="sale-actions">
          {!sale.is_comp &&
            (sale.payment_status === 'pending' ? (
              <>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={setPayment.isPending}
                  onClick={() => setPayment.mutate({ paid: true, method: 'cash' })}
                >
                  Pagó en efectivo
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={setPayment.isPending}
                  onClick={() => setPayment.mutate({ paid: true, method: 'transfer' })}
                >
                  Pagó por transferencia
                </button>
              </>
            ) : (
              <button
                className="button button--ghost"
                type="button"
                disabled={setPayment.isPending}
                onClick={() => setPayment.mutate({ paid: false })}
              >
                Volver a pendiente
              </button>
            ))}

          <button className="button button--ghost" type="button" onClick={() => void copyLink()}>
            {copied ? 'Copiado ✓' : 'Copiar link'}
          </button>

          {sale.buyer_email && (
            <button
              className="button button--ghost"
              type="button"
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {resend.isPending ? 'Enviando…' : 'Reenviar email'}
            </button>
          )}

          {isAdmin && (
            <button
              className="button button--ghost button--danger"
              type="button"
              disabled={voidSale.isPending}
              onClick={() => {
                if (window.confirm(`¿Anular la venta de ${sale.buyer_name}? Libera el cupo.`)) {
                  voidSale.mutate()
                }
              }}
            >
              Anular
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Filtros del listado (C2/C3); llegan preaplicados via ?filtro=. */
export type SalesFilter = 'todas' | 'deben' | 'pagas' | 'cortesias'

export function matchesFilter(sale: SaleRow, filter: SalesFilter): boolean {
  switch (filter) {
    case 'deben':
      return sale.voided_at === null && !sale.is_comp && sale.payment_status === 'pending'
    case 'pagas':
      return sale.voided_at === null && !sale.is_comp && sale.payment_status === 'paid'
    case 'cortesias':
      return sale.voided_at === null && sale.is_comp
    case 'todas':
      return true
  }
}

function parseFilter(raw: string | null): SalesFilter {
  return raw === 'deben' || raw === 'pagas' || raw === 'cortesias' ? raw : 'todas'
}

export function SalesPage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('filtro'))

  const { data, isPending } = useQuery({
    queryKey: salesQueryKey,
    queryFn: () => api.listSales(),
  })

  const visible = (data?.sales ?? []).filter((sale) => matchesFilter(sale, filter))

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{isAdmin ? 'Ventas' : 'Mis ventas'}</h1>
        <Link className="button" style={{ width: 'auto', textDecoration: 'none', display: 'inline-block' }} to="/ventas/nueva">
          Nueva venta
        </Link>
      </div>

      {filter !== 'todas' && (
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
          Filtrado: <strong>{filter === 'deben' ? 'Deben' : filter === 'pagas' ? 'Pagas' : 'Cortesías'}</strong>{' '}
          ·{' '}
          <button
            type="button"
            onClick={() => setSearchParams({})}
            style={{ border: 'none', background: 'none', color: 'var(--brand-blue)', fontWeight: 700, cursor: 'pointer', font: 'inherit' }}
          >
            Ver todas
          </button>
        </p>
      )}

      {isPending ? (
        <p className="muted">Cargando…</p>
      ) : visible.length > 0 ? (
        <div className="stack">
          {visible.map((sale) => (
            <SaleCard key={sale.id} sale={sale} isAdmin={isAdmin} />
          ))}
        </div>
      ) : (
        <p className="muted">
          {filter === 'deben'
            ? 'Nadie debe nada. ¡Todo cobrado!'
            : 'Todavía no hay ventas acá.'}
        </p>
      )}
    </>
  )
}
