import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleRow } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime, formatMoney } from '../lib/format'

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
      setError(email_status === 'sent' ? null : 'El email no salio. Proba de nuevo.')
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
      setError('No se pudo copiar; abri la entrada y compartila desde ahi.')
    }
  }

  const voided = sale.voided_at !== null

  return (
    <div className={`panel${voided ? ' panel--voided' : ''}`}>
      <div className="function-card__head">
        <div>
          <h3 className="function-card__title">{sale.buyer_name}</h3>
          <p className="muted function-card__line">
            {sale.quantity} {sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
            {formatDateTime(sale.function_starts_at)}
            {isAdmin && <> · vendio {sale.seller_name}</>}
          </p>
        </div>
        <span className="badge">
          {voided
            ? 'Anulada'
            : sale.is_comp
              ? 'Cortesia'
              : sale.payment_status === 'paid'
                ? `Paga (${sale.payment_method === 'cash' ? 'efectivo' : 'transf.'})`
                : 'Debe ' + formatMoney(sale.amount_cents)}
        </span>
      </div>

      {error && (
        <p className="alert" role="alert">
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
                  Pago efectivo
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={setPayment.isPending}
                  onClick={() => setPayment.mutate({ paid: true, method: 'transfer' })}
                >
                  Pago transferencia
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
              {resend.isPending ? 'Enviando...' : 'Reenviar email'}
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

export function SalesPage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'

  const { data, isPending } = useQuery({
    queryKey: salesQueryKey,
    queryFn: () => api.listSales(),
  })

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{isAdmin ? 'Ventas' : 'Mis ventas'}</h1>
        <Link className="button" style={{ width: 'auto' }} to="/ventas/nueva">
          Nueva venta
        </Link>
      </div>

      {isPending ? (
        <p className="muted">Cargando...</p>
      ) : data && data.sales.length > 0 ? (
        <div className="stack">
          {data.sales.map((sale) => (
            <SaleCard key={sale.id} sale={sale} isAdmin={isAdmin} />
          ))}
        </div>
      ) : (
        <p className="muted">Todavia no hay ventas registradas.</p>
      )}
    </>
  )
}
