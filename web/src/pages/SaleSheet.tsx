import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, HandCoins, Landmark, Link2, Mail, RotateCcw, X } from 'lucide-react'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleListItem, SalePayments } from '../api/client'
import { dayLabel, daysAgo, formatMoney, pesosToCents } from '../lib/format'
import { initials } from '../lib/search'
import { ActionPanel, SheetAction } from '../ui/ActionPanel'
import { SegmentedToggle } from '../ui/controls'

/** La clave del listado: la hoja la invalida cuando cambia algo. */
export const salesQueryKey = ['sales'] as const

/** Sheet de acciones de una venta (C3.4): nada de botones en la fila. */
export function SaleSheet({
  sale: saleInicial,
  isAdmin,
  onClose,
}: {
  sale: SaleListItem
  isAdmin: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  // La hoja se queda con su propia copia de la venta: registrar o quitar un
  // cobro devuelve la venta ya recalculada, así que los números de acá se
  // actualizan sin esperar a que la lista de atrás se refresque.
  const [sale, setSale] = useState(saleInicial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: salesQueryKey })
    // "Te falta cobrar", "últimas ventas" y los badges salen de la home.
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const setPayment = useMutation({
    mutationFn: ({ paid, method }: { paid: boolean; method?: PaymentMethod }) =>
      api.updateSalePayment(sale.id, paid ? 'paid' : 'pending', method),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo actualizar el pago.'),
  })

  // Historial de cobros: se pide al abrir la hoja. La venta que devuelven el
  // alta y la baja de un cobro es la recalculada, así que la hoja se queda con
  // los números al día sin esperar a que se refresque la lista de atrás.
  const [parcialAbierto, setParcialAbierto] = useState(false)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('cash')

  const payments = useQuery({
    queryKey: ['sale-payments', sale.id],
    queryFn: () => api.salePayments(sale.id),
    enabled: sale.voided_at === null && !sale.is_comp,
  })
  const cobros = payments.data?.payments ?? []

  const tomarRespuesta = (data: SalePayments) => {
    setSale((prev) => ({
      ...prev,
      paid_cents: data.sale.paid_cents,
      payment_status: data.sale.payment_status,
      payment_method: data.sale.payment_method,
    }))
    setError(null)
    void queryClient.invalidateQueries({ queryKey: ['sale-payments', sale.id] })
    refresh()
  }

  const addPayment = useMutation({
    mutationFn: (cents: number) => api.addSalePayment(sale.id, cents, metodo),
    onSuccess: (data) => {
      tomarRespuesta(data)
      setParcialAbierto(false)
      setMonto('')
    },
    onError: (err) => fail(err, 'No se pudo registrar el cobro.'),
  })

  const delPayment = useMutation({
    mutationFn: (paymentId: number) => api.deleteSalePayment(sale.id, paymentId),
    onSuccess: tomarRespuesta,
    onError: (err) => fail(err, 'No se pudo quitar el cobro.'),
  })

  const ocupado = setPayment.isPending || addPayment.isPending || delPayment.isPending

  function registrarParcial() {
    const cents = pesosToCents(monto)
    if (cents === null || cents <= 0) {
      setError('El monto no es válido. Ejemplo: 8000 o 8000,50.')
      return
    }
    addPayment.mutate(cents)
  }

  const resend = useMutation({
    mutationFn: () => api.resendSaleEmail(sale.id),
    onSuccess: ({ email_status }) => {
      refresh()
      if (email_status === 'sent') setNotice('Email enviado ✓')
      else setError('El email no salió. Probá de nuevo.')
    },
    onError: (err) => fail(err, 'No se pudo reenviar el email.'),
  })

  const voidSale = useMutation({
    mutationFn: () => api.voidSale(sale.id),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo anular la venta.'),
  })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicSaleURL(sale.code))
      setNotice('Link copiado ✓')
    } catch {
      setError('No se pudo copiar el link.')
    }
  }

  const cobrable = sale.voided_at === null && !sale.is_comp
  const falta = sale.amount_cents - sale.paid_cents
  const pendingPayment = cobrable && falta > 0
  const paid = cobrable && falta <= 0

  return (
    <ActionPanel open onClose={onClose} label={`Acciones de la venta de ${sale.buyer_name}`}>
      <div className="sheet-head">
        <span className="ini">{initials(sale.buyer_name)}</span>
        <span>
          <b>{sale.buyer_name}</b>
          <span>
            {sale.quantity} {sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
            {sale.function_name ?? sale.function_venue} · vendió {sale.seller_name}
            {!sale.is_comp && <> · {formatMoney(sale.amount_cents)}</>}
          </span>
        </span>
      </div>

      {error && <p className="alert" role="alert" style={{ margin: '10px 0 0' }}>{error}</p>}
      {notice && <p className="muted" style={{ margin: '10px 0 0', fontWeight: 700, color: 'var(--ok)' }}>{notice}</p>}

      {pendingPayment && (
        <>
          <SheetAction icon={<Banknote size={15} />} tone="ok" disabled={ocupado}
            onClick={() => setPayment.mutate({ paid: true, method: 'cash' })}>
            {sale.paid_cents > 0 ? 'Cobré el resto — efectivo' : 'Marcar pagó — efectivo'}
          </SheetAction>
          <SheetAction icon={<Landmark size={15} />} tone="ok" disabled={ocupado}
            onClick={() => setPayment.mutate({ paid: true, method: 'transfer' })}>
            {sale.paid_cents > 0 ? 'Cobré el resto — transferencia' : 'Marcar pagó — transferencia'}
          </SheetAction>
          {parcialAbierto ? (
            <div className="pay-part">
              <label className="field" style={{ marginTop: 0 }}>
                <span className="field__label">Cuánto cobró ($)</span>
                <input
                  className="field__input"
                  type="text"
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder={String(Math.floor(falta / 100))}
                  autoFocus
                />
              </label>
              <div className="field">
                <span className="field__label">Método</span>
                <SegmentedToggle<PaymentMethod>
                  value={metodo}
                  onChange={setMetodo}
                  options={[
                    { value: 'cash', label: 'Efectivo' },
                    { value: 'transfer', label: 'Transferencia' },
                  ]}
                />
              </div>
              <div className="form-row">
                <button className="button" type="button" disabled={ocupado} onClick={registrarParcial}>
                  {addPayment.isPending ? 'Registrando…' : 'Registrar cobro'}
                </button>
                <button
                  className="button button--ghost form-row__action"
                  type="button"
                  onClick={() => setParcialAbierto(false)}
                >
                  Cancelar
                </button>
              </div>
              <p className="muted" style={{ fontSize: 10.5, margin: '6px 0 0' }}>
                Falta {formatMoney(falta)} de {formatMoney(sale.amount_cents)}.
              </p>
            </div>
          ) : (
            <SheetAction icon={<HandCoins size={15} />} disabled={ocupado}
              onClick={() => setParcialAbierto(true)}>
              Cobré una parte…
            </SheetAction>
          )}
        </>
      )}

      {cobrable && cobros.length > 0 && (
        <div className="pay-hist">
          <p className="panel__label">
            Cobrado {formatMoney(sale.paid_cents)}
            {falta > 0 && <> · debe {formatMoney(falta)}</>}
          </p>
          {cobros.map((cobro) => (
            <div key={cobro.id} className="pay-hist__row">
              <span>
                <b>{formatMoney(cobro.amount_cents)}</b>{' '}
                <span className="muted">{cobro.method === 'transfer' ? 'transferencia' : 'efectivo'}</span>
                <br />
                <span className="muted" style={{ fontSize: 11 }}>
                  {dayLabel(cobro.created_at)} · {cobro.by_name}
                </span>
              </span>
              <button
                className="pay-hist__del"
                type="button"
                disabled={ocupado}
                aria-label={`Quitar el cobro de ${formatMoney(cobro.amount_cents)}`}
                onClick={() => delPayment.mutate(cobro.id)}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      {paid && (
        <SheetAction icon={<RotateCcw size={15} />} disabled={ocupado}
          onClick={() => setPayment.mutate({ paid: false })}>
          Volver a pendiente
        </SheetAction>
      )}
      {sale.voided_at === null && (
        <SheetAction icon={<Link2 size={15} />} onClick={() => void copyLink()}>
          Copiar link de la entrada
        </SheetAction>
      )}
      {sale.voided_at === null && sale.buyer_email && (
        <SheetAction
          icon={<Mail size={15} />}
          hint={sale.last_email_at ? `enviado ${daysAgo(sale.last_email_at)}` : 'nunca se envió'}
          disabled={resend.isPending}
          onClick={() => resend.mutate()}
        >
          {resend.isPending ? 'Enviando…' : 'Reenviar email'}
        </SheetAction>
      )}
      {isAdmin && sale.voided_at === null && (
        <SheetAction icon={<X size={15} />} tone="danger" disabled={voidSale.isPending}
          onClick={() => {
            if (confirmVoid) voidSale.mutate()
            else setConfirmVoid(true)
          }}>
          {confirmVoid ? '¿Seguro? Anular definitivamente (libera el cupo)' : 'Anular venta'}
        </SheetAction>
      )}
    </ActionPanel>
  )
}
