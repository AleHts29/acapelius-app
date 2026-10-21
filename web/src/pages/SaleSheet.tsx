import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleListItem, SalePayments } from '../api/client'
import { dayLabel, daysAgo, formatMoney, pesosToCents } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { Button, Seg } from '../ui/Button'
import { DataList } from '../ui/DataList'
import { Label } from '../ui/Label'
import { Row } from '../ui/Row'
import { Drawer, Sheet } from '../ui/Sheet'
import { SaleStatus } from '../ui/Status'

/** La clave del listado: el detalle la invalida cuando cambia algo. */
export const salesQueryKey = ['sales'] as const

/**
 * El detalle de una venta (C19 §5.2): drawer en escritorio, hoja en celular.
 * Es una TRANSACCIÓN que se trabaja de corrido, así que no tapa la lista. Los
 * flujos son los de siempre: cobrar (todo o una parte), quitar un cobro,
 * volver a pendiente, copiar el link, reenviar el QR y anular.
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
    mutationFn: ({ paid, method }: { paid: boolean; method?: PaymentMethod }) =>
      api.updateSalePayment(sale.id, paid ? 'paid' : 'pending', method),
    onSuccess: () => {
      refresh()
      onClose()
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
      if (email_status === 'sent') setNotice('Le volvimos a mandar el QR.')
      else if (email_status === 'preview') setNotice('En la demo no se mandan mails: abrí la entrada desde el link.')
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
    ...(cobrable
      ? ([
          debe
            ? ['Cobrado', `${formatMoney(sale.paid_cents)} · debe ${formatMoney(falta)}`]
            : ['Pagó', metodoDe(sale.payment_method)],
        ] as Array<[string, ReactNode]>)
      : []),
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

      <DataList rows={datos} />

      {debe && (
        <div>
          <Label>Cobrar</Label>
          <div className="mini" style={{ marginTop: 7 }}>
            <Row
              title={sale.paid_cents > 0 ? 'Cobré el resto en efectivo' : 'Pagó en efectivo'}
              onClick={ocupado ? undefined : () => setPayment.mutate({ paid: true, method: 'cash' })}
            />
            <Row
              title={sale.paid_cents > 0 ? 'Cobré el resto por transferencia' : 'Pagó por transferencia'}
              onClick={ocupado ? undefined : () => setPayment.mutate({ paid: true, method: 'transfer' })}
            />
            {!parcialAbierto && <Row title="Cobré una parte…" onClick={() => setParcialAbierto(true)} />}
          </div>
          {parcialAbierto && (
            <div className="mini" style={{ marginTop: 'var(--s1)', padding: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <label className="field" style={{ margin: 0 }}>
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
        </div>
      )}

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
            {isAdmin && (
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
      <Button go onClick={() => window.open(publicSaleURL(sale.code), '_blank', 'noopener')}>
        Ver entrada
      </Button>
    </>
  ) : undefined

  const sub = `${sale.quantity} ${sale.quantity === 1 ? 'entrada' : 'entradas'}${
    sale.last_email_at ? ` · QR enviado ${daysAgo(sale.last_email_at)}` : ''
  }`

  return escritorio ? (
    <Drawer open onClose={onClose} label="Venta" title={sale.buyer_name} sub={sub} actions={acciones}>
      <SaleStatus sale={sale} />
      {cuerpo}
    </Drawer>
  ) : (
    <Sheet open onClose={onClose} title={sale.buyer_name} sub={sub} status={<SaleStatus sale={sale} />} actions={acciones}>
      {cuerpo}
    </Sheet>
  )
}
