import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleListItem, SalePayments } from '../api/client'
import { dayLabel, daysAgo, centavosAMonto, escribirMonto, formatMoney, pesosToCents } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { Button, Seg } from '../ui/Button'
import { DataList } from '../ui/DataList'
import { Figure } from '../ui/Figure'
import { Label } from '../ui/Label'
import { Row } from '../ui/Row'
import { Modal } from '../ui/Modal'
import { Sheet } from '../ui/Sheet'
import { SaleStatus } from '../ui/Status'

/** La clave del listado: el detalle la invalida cuando cambia algo. */
export const salesQueryKey = ['sales'] as const

/**
 * El detalle de una venta (C19 §5.2): popup en escritorio, hoja en celular.
 * Si falta cobrar, eso va primero: cuánto falta y dos botones. Cobrar NO cierra
 * el popup: confirma en palabras, muestra el cobro y deja quitarlo si fue sin
 * querer. También: copiar el link, reenviar el QR y anular.
 */
export function SaleSheet({
  sale: saleInicial,
  isAdmin,
  onClose,
}: {
  sale: SaleListItem
  isAdmin: boolean
  onClose: () => void
}) {
  const escritorio = useIsDesktop()
  const queryClient = useQueryClient()
  // El detalle se queda con su propia copia de la venta: registrar o quitar un
  // cobro devuelve la venta ya recalculada, así que los números de acá se
  // actualizan sin esperar a que la lista de atrás se refresque.
  const [sale, setSale] = useState(saleInicial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [parcialAbierto, setParcialAbierto] = useState(false)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('cash')

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: salesQueryKey })
    // "Te falta cobrar", "últimas ventas" y los badges salen de la home.
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const setPayment = useMutation({
    meta: { exito: 'Cobro guardado' },
    mutationFn: ({ paid, method }: { paid: boolean; method?: PaymentMethod }) =>
      api.updateSalePayment(sale.id, paid ? 'paid' : 'pending', method),
    onSuccess: ({ sale: actualizada }) => {
      setSale((prev) => ({
        ...prev,
        paid_cents: actualizada.paid_cents,
        payment_status: actualizada.payment_status,
        payment_method: actualizada.payment_method,
      }))
      setError(null)
      setNotice('La venta volvió a pendiente: se quitaron sus cobros.')
      void queryClient.invalidateQueries({ queryKey: ['sale-payments', sale.id] })
      refresh()
    },
    onError: (err) => fail(err, 'No se pudo actualizar el pago.'),
  })

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
    meta: { exito: 'Cobro registrado' },
    mutationFn: ({ cents, method }: { cents: number; method: PaymentMethod }) =>
      api.addSalePayment(sale.id, cents, method),
    onSuccess: (data, { cents, method }) => {
      tomarRespuesta(data)
      const resta = data.sale.amount_cents - data.sale.paid_cents
      setNotice(
        `Cobro registrado: ${formatMoney(cents)} ${method === 'cash' ? 'en efectivo' : 'por transferencia'}. ` +
          (resta > 0 ? `Falta cobrar ${formatMoney(resta)}.` : 'La venta quedó paga.'),
      )
      setParcialAbierto(false)
      setMonto('')
    },
    onError: (err) => fail(err, 'No se pudo registrar el cobro.'),
  })

  const delPayment = useMutation({
    meta: { exito: 'Cobro quitado' },
    mutationFn: (paymentId: number) => api.deleteSalePayment(sale.id, paymentId),
    onSuccess: (data) => {
      tomarRespuesta(data)
      setNotice(`Cobro quitado. Falta cobrar ${formatMoney(data.sale.amount_cents - data.sale.paid_cents)}.`)
    },
    onError: (err) => fail(err, 'No se pudo quitar el cobro.'),
  })

  const ocupado = setPayment.isPending || addPayment.isPending || delPayment.isPending

  function registrarParcial() {
    const cents = pesosToCents(monto)
    if (cents === null || cents <= 0) {
      setError('El monto no es válido. Ejemplo: 8.000 o 8.000,50.')
      return
    }
    addPayment.mutate({ cents, method: metodo })
  }

  const resend = useMutation({
    meta: { exito: false },
    mutationFn: () => api.resendSaleEmail(sale.id),
    onSuccess: ({ email_status }) => {
      refresh()
      if (email_status === 'sent') setNotice('Le volvimos a mandar el QR.')
      else if (email_status === 'preview') setNotice('En la demo no se mandan mails: abrí la entrada desde el link.')
      else setError('El email no salió. Probá de nuevo.')
    },
    onError: (err) => fail(err, 'No se pudo reenviar el email.'),
  })

  const voidSale = useMutation({
    meta: { exito: 'Venta anulada' },
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
      setNotice('Link copiado.')
    } catch {
      setError('No se pudo copiar el link.')
    }
  }

  const viva = sale.voided_at === null
  const cobrable = viva && !sale.is_comp
  const falta = sale.amount_cents - sale.paid_cents
  const debe = cobrable && falta > 0
  const pago = cobrable && falta <= 0
  const metodoDe = (m: PaymentMethod | null) => (m === 'transfer' ? 'transferencia' : 'efectivo')

  const datos: Array<[string, ReactNode]> = [
    ['Mail', sale.buyer_email ?? 'Sin email'],
    ['Vendió', sale.seller_name],
    ['Función', `${dayLabel(sale.function_starts_at)} · ${sale.function_name ?? sale.function_venue}`],
    ...(sale.is_comp ? [] : ([['Total', formatMoney(sale.amount_cents)]] as Array<[string, ReactNode]>)),
    ...(pago ? ([['Pagó', metodoDe(sale.payment_method)]] as Array<[string, ReactNode]>) : []),
    ['Ingreso', sale.entered === 0 ? 'todavía no' : `${sale.entered} de ${sale.quantity}`],
  ]

  const cuerpo = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
      {error && (
        <p className="st st--bad" role="alert" style={{ margin: 0, whiteSpace: 'normal' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="st st--ok" role="status" style={{ margin: 0, whiteSpace: 'normal' }}>
          {notice}
        </p>
      )}

      {debe && (
        <section className="cobrar" aria-label="Cobrar">
          <Figure label="Falta cobrar" tone="warn">
            {formatMoney(falta)}
          </Figure>
          <p className="rs" style={{ margin: 0, whiteSpace: 'normal' }}>
            {sale.paid_cents > 0
              ? `Ya cobró ${formatMoney(sale.paid_cents)} de ${formatMoney(sale.amount_cents)}.`
              : 'Todavía no cobró nada de esta venta.'}
          </p>
          {!parcialAbierto && (
            <>
              <Label>¿Cómo pagó {formatMoney(falta)}?</Label>
              <div className="cobrar__b">
                <Button go disabled={ocupado} onClick={() => addPayment.mutate({ cents: falta, method: 'cash' })}>
                  En efectivo
                </Button>
                <Button go disabled={ocupado} onClick={() => addPayment.mutate({ cents: falta, method: 'transfer' })}>
                  Por transferencia
                </Button>
              </div>
              <button className="card__a" type="button" disabled={ocupado} onClick={() => setParcialAbierto(true)}>
                Pagó solo una parte
              </button>
            </>
          )}
          {parcialAbierto && (
            <div className="mini" style={{ padding: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <label className="field" style={{ margin: 0 }}>
                <span className="field__label">Cuánto cobró ($)</span>
                <input
                  className="field__input"
                  type="text"
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(escribirMonto(e.target.value))}
                  placeholder={centavosAMonto(Math.floor(falta / 100) * 100)}
                  autoFocus
                />
              </label>
              <Seg<PaymentMethod>
                label="Método"
                value={metodo}
                onChange={setMetodo}
                options={[
                  { value: 'cash', label: 'Efectivo' },
                  { value: 'transfer', label: 'Transferencia' },
                ]}
              />
              <span className="rs">
                Falta {formatMoney(falta)} de {formatMoney(sale.amount_cents)}.
              </span>
              <div style={{ display: 'flex', gap: 'var(--s1)' }}>
                <Button onClick={() => setParcialAbierto(false)}>Cancelar</Button>
                <Button go disabled={ocupado} onClick={registrarParcial}>
                  {addPayment.isPending ? 'Registrando…' : 'Registrar cobro'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <DataList rows={datos} />

      {cobrable && cobros.length > 0 && (
        <div>
          <Label>Cobros</Label>
          <div className="mini" style={{ marginTop: 7 }}>
            {cobros.map((cobro) => (
              <Row
                key={cobro.id}
                title={`${formatMoney(cobro.amount_cents)} · ${metodoDe(cobro.method)}`}
                sub={`${dayLabel(cobro.created_at)} · ${cobro.by_name}`}
                status={
                  <button
                    className="card__a"
                    type="button"
                    disabled={ocupado}
                    aria-label={`Quitar el cobro de ${formatMoney(cobro.amount_cents)}`}
                    onClick={() => delPayment.mutate(cobro.id)}
                  >
                    Quitar
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}

      {viva && (
        <div>
          <Label>Más</Label>
          <div className="mini" style={{ marginTop: 7 }}>
            <Row title="Copiar link de la entrada" onClick={() => void copyLink()} />
            {pago && <Row title="Volver a pendiente" onClick={ocupado ? undefined : () => setPayment.mutate({ paid: false })} />}
            {isAdmin && (sale.entered > 0 || sale.paid_cents > 0) && (
              <Row
                title="Anular venta"
                sub={sale.entered > 0 ? 'Ya entró: no se puede anular' : 'Ya tiene cobros: quitalos antes de anular'}
                dim
              />
            )}
            {isAdmin && sale.entered === 0 && sale.paid_cents === 0 && (
              <Row
                title={confirmVoid ? '¿Seguro? Tocá de nuevo para anular' : 'Anular venta'}
                sub="Libera el cupo. No se puede deshacer"
                onClick={
                  voidSale.isPending ? undefined : () => (confirmVoid ? voidSale.mutate() : setConfirmVoid(true))
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  )

  const acciones = viva ? (
    <>
      <Button disabled={!sale.buyer_email || resend.isPending} onClick={() => resend.mutate()}>
        {resend.isPending ? 'Enviando…' : 'Reenviar QR'}
      </Button>
      {/* Mientras falte cobrar, lo naranja es cobrar. */}
      <Button go={!debe} onClick={() => window.open(publicSaleURL(sale.code), '_blank', 'noopener')}>
        Ver entrada
      </Button>
    </>
  ) : undefined

  const sub = `${sale.quantity} ${sale.quantity === 1 ? 'entrada' : 'entradas'}${
    sale.last_email_at ? ` · QR enviado ${daysAgo(sale.last_email_at)}` : ''
  }`

  return escritorio ? (
    <Modal open onClose={onClose} label="Venta" title={sale.buyer_name} sub={sub} footer={acciones}>
      {!debe && <SaleStatus sale={sale} />}
      {cuerpo}
    </Modal>
  ) : (
    <Sheet open onClose={onClose} title={sale.buyer_name} sub={sub} status={<SaleStatus sale={sale} />} actions={acciones}>
      {cuerpo}
    </Sheet>
  )
}
