import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL, shortSaleURL, telefonoWhatsApp, whatsAppURL } from '../api/client'
import type { PaymentMethod, SaleListItem, SalePayments } from '../api/client'
import {
  dayLabel,
  daysAgo,
  centavosAMonto,
  escribirMonto,
  formatMoney,
  functionDay,
  functionTime,
  mensajeEntradas,
  pesosToCents,
} from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSession } from '../auth/session'
import { useSeason } from '../season/SeasonProvider'
import { Menu } from '../ui/Menu'
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
  const { user } = useSession()
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
  const [editando, setEditando] = useState(false)
  // Si dirección la pasó de función: cuándo y entre cuáles, para mirar si la
  // puerta de cada una ya tiene el cambio.
  const [movida, setMovida] = useState<Movida | null>(null)

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

  // El mismo mensaje que al vender, al número que quedó en la ficha. Sin
  // teléfono (o uno que no sirve), WhatsApp pregunta a quién mandarlo.
  const whatsapp = whatsAppURL(
    mensajeEntradas(
      sale.buyer_name,
      shortSaleURL(sale.code),
      {
        venue: sale.function_venue,
        starts_at: sale.function_starts_at,
        address: sale.function_address,
        maps_url: sale.function_maps_url,
      },
      { que: user?.organization_name, cantidad: sale.quantity, cortesia: sale.is_comp },
    ),
    sale.buyer_phone,
  )
  const conNumero = telefonoWhatsApp(sale.buyer_phone) !== ''

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
    ['Teléfono', sale.buyer_phone ?? 'Sin teléfono'],
    ['Vendió', sale.seller_name],
    ['Función', `${dayLabel(sale.function_starts_at)} · ${sale.function_name ?? sale.function_venue}`],
    ...(sale.is_comp ? [] : ([['Total', formatMoney(sale.amount_cents)]] as Array<[string, ReactNode]>)),
    ...(pago ? ([['Pagó', metodoDe(sale.payment_method)]] as Array<[string, ReactNode]>) : []),
    ['Ingreso', sale.entered === 0 ? 'todavía no' : `${sale.entered} de ${sale.quantity}`],
    ...(sale.over_capacity ? ([['Cupo', 'Sobre cupo: vendida con la función agotada']] as Array<[string, ReactNode]>) : []),
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

      {editando ? (
        <EditarVenta
          sale={sale}
          onCancel={() => setEditando(false)}
          onSaved={(cambios, aviso, mov) => {
            if (mov) setMovida(mov)
            setSale((prev) => ({ ...prev, ...cambios }))
            setEditando(false)
            setError(null)
            setNotice(aviso)
            refresh()
          }}
        />
      ) : (
        <DataList rows={datos} />
      )}

      {movida && <PuertaAlDia movida={movida} />}

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
            <Row
              title="Mandar por WhatsApp"
              sub={conNumero ? `Al ${sale.buyer_phone}` : 'Sin teléfono: WhatsApp te pregunta a quién'}
              onClick={() => window.open(whatsapp, '_blank', 'noopener,noreferrer')}
            />
            <Row title="Copiar link de la entrada" onClick={() => void copyLink()} />
            {isAdmin && !editando && (
              <Row
                title="Editar datos"
                sub="Nombre, mail, teléfono o función"
                onClick={() => {
                  setNotice(null)
                  setEditando(true)
                }}
              />
            )}
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

/** Lo que la ficha tiene que actualizar después de editar. */
type CambiosVenta = Pick<
  SaleListItem,
  | 'buyer_name'
  | 'buyer_email'
  | 'buyer_phone'
  | 'function_id'
  | 'function_name'
  | 'function_venue'
  | 'function_starts_at'
  | 'function_address'
  | 'function_maps_url'
  | 'over_capacity'
>

/**
 * Sólo dirección: corregir a nombre de quién está la venta o pasarla a otra
 * función. Las entradas y sus QR siguen siendo los mismos; si cambia la
 * función o el mail, al comprador le llega el mail de nuevo (con la fecha
 * nueva avisada). Con entradas ya ingresadas, la función no se puede cambiar.
 */
function EditarVenta({
  sale,
  onCancel,
  onSaved,
}: {
  sale: SaleListItem
  onCancel: () => void
  onSaved: (cambios: CambiosVenta, aviso: string, movida: Movida | null) => void
}) {
  const { seasonId } = useSeason()
  const [nombre, setNombre] = useState(sale.buyer_name)
  const [mail, setMail] = useState(sale.buyer_email ?? '')
  const [telefono, setTelefono] = useState(sale.buyer_phone ?? '')
  const [functionId, setFunctionId] = useState(sale.function_id)
  const [error, setError] = useState<string | null>(null)
  const [sinLugar, setSinLugar] = useState(false)

  const functions = useQuery({
    queryKey: ['functions', seasonId],
    queryFn: () => api.listFunctions(seasonId),
    enabled: seasonId !== undefined,
  })
  // Sólo las que todavía no pasaron, más la actual (aunque haya pasado).
  const limite = Date.now() - 3 * 60 * 60 * 1000
  const opciones = (functions.data?.functions ?? []).filter(
    (fn) => fn.id === sale.function_id || new Date(fn.starts_at).getTime() >= limite,
  )
  const elegida = opciones.find((fn) => fn.id === functionId)
  const yaEntro = sale.entered > 0
  const cambiaFuncion = functionId !== sale.function_id
  const cambiaMail = mail.trim().toLowerCase() !== (sale.buyer_email ?? '').toLowerCase()

  const guardar = useMutation({
    meta: { exito: false },
    mutationFn: (sobreCupo: boolean) =>
      api.updateSaleDetails(sale.id, {
        buyer_name: nombre.trim(),
        buyer_email: mail.trim(),
        buyer_phone: telefono.trim(),
        function_id: functionId,
        over_capacity: sobreCupo,
      }),
    onSuccess: ({ sale: s, email_status, changed_at }) => {
      const fn = elegida
      const mailAviso =
        email_status === 'sent'
          ? cambiaFuncion
            ? ' Le mandamos el mail con la fecha nueva: el QR es el mismo.'
            : ' Le mandamos el QR al mail nuevo.'
          : email_status === 'preview'
            ? ' En la demo no se mandan mails.'
            : email_status === 'failed'
              ? ' El mail no salió: reenvialo con "Reenviar QR".'
              : ''
      onSaved(
        {
          buyer_name: s.buyer_name,
          buyer_email: s.buyer_email,
          buyer_phone: s.buyer_phone,
          function_id: s.function_id,
          function_name: fn?.name ?? sale.function_name,
          function_venue: fn?.venue ?? sale.function_venue,
          function_starts_at: fn?.starts_at ?? sale.function_starts_at,
          function_address: fn ? fn.address : sale.function_address,
          function_maps_url: fn ? fn.maps_url : sale.function_maps_url,
          over_capacity: s.over_capacity,
        },
        'Datos guardados.' + mailAviso,
        cambiaFuncion
          ? {
              changedAt: changed_at,
              funciones: [
                { id: sale.function_id, label: `${dayLabel(sale.function_starts_at)} (la anterior)` },
                { id: s.function_id, label: fn ? `${functionDay(fn.starts_at)} · ${functionTime(fn.starts_at)} (la nueva)` : 'la nueva' },
              ],
            }
          : null,
      )
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'no_capacity') setSinLugar(true)
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los datos.')
    },
  })

  const campo = (label: string, input: ReactNode) => (
    <label className="field" style={{ margin: 0 }}>
      <span className="field__label">{label}</span>
      {input}
    </label>
  )

  return (
    <form
      className="mini"
      style={{ padding: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        setSinLugar(false)
        guardar.mutate(false)
      }}
    >
      <Label>Editar datos</Label>
      {error && (
        <p className="st st--bad" role="alert" style={{ margin: 0, whiteSpace: 'normal' }}>
          {error}
        </p>
      )}
      {campo(
        'A nombre de',
        <input id="editar-nombre" className="field__input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />,
      )}
      {campo(
        'Mail',
        <input
          id="editar-mail"
          className="field__input"
          type="email"
          value={mail}
          onChange={(e) => setMail(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="email"
          required
        />,
      )}
      {campo(
        'Teléfono',
        <input
          id="editar-telefono"
          className="field__input"
          type="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          inputMode="tel"
          placeholder="Opcional"
        />,
      )}
      <div>
        <span className="field__label">Función</span>
        <div style={{ marginTop: 7 }}>
          {yaEntro ? (
            <span className="rs" style={{ whiteSpace: 'normal' }}>
              {dayLabel(sale.function_starts_at)} · ya entró alguien con esta venta: la función no se puede cambiar.
            </span>
          ) : (
            <Menu
              trigger="field"
              ariaLabel="Función"
              label={
                elegida
                  ? `${functionDay(elegida.starts_at)} · ${functionTime(elegida.starts_at)}`
                  : `${dayLabel(sale.function_starts_at)}`
              }
              value={String(functionId)}
              groups={[
                {
                  options: opciones.map((fn) => {
                    const libres = fn.capacity - fn.sold
                    return {
                      id: String(fn.id),
                      label: fn.name ?? fn.venue,
                      hint: `${functionDay(fn.starts_at)} · ${functionTime(fn.starts_at)}${
                        fn.id === sale.function_id ? ' · la actual' : ` · ${Math.max(libres, 0)} libres`
                      }`,
                      onSelect: () => {
                        setFunctionId(fn.id)
                        setSinLugar(false)
                      },
                    }
                  }),
                },
              ]}
            />
          )}
        </div>
      </div>
      {(cambiaFuncion || cambiaMail) && (
        <span className="rs" style={{ whiteSpace: 'normal' }}>
          {cambiaFuncion
            ? 'Al guardar le llega un mail avisando la fecha nueva. El QR es el mismo y deja de valer para la función anterior.'
            : 'Al guardar le mandamos el QR al mail nuevo.'}
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
        <Button type="button" onClick={onCancel}>
          Cancelar
        </Button>
        {sinLugar ? (
          <Button go type="button" disabled={guardar.isPending} onClick={() => guardar.mutate(true)}>
            Pasarla igual, sobre cupo
          </Button>
        ) : (
          <Button go type="submit" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        )}
      </div>
    </form>
  )
}

interface Movida {
  /** Hora del server en que quedó el cambio. */
  changedAt: string
  funciones: Array<{ id: number; label: string }>
}

/**
 * Después de pasar una venta de función: ¿la puerta ya tiene el cambio? Mira
 * los celulares que tienen abierta la puerta de la función vieja y de la
 * nueva. Una función sin puerta abierta no tiene nada viejo: cuando la abran
 * baja la lista al día. Se refresca sola hasta que todas lo tengan.
 */
function PuertaAlDia({ movida }: { movida: Movida }) {
  // Cada 10 segundos mientras la ficha está abierta: es una consulta chica.
  const consultas = useQueries({
    queries: movida.funciones.map((fn) => ({
      queryKey: ['door-devices', fn.id],
      queryFn: () => api.doorDevices(fn.id),
      refetchInterval: 10_000,
    })),
  })

  const filas = movida.funciones.flatMap((fn, i) =>
    (consultas[i].data?.devices ?? []).map((d) => ({
      key: `${fn.id}-${d.device_id}`,
      funcion: fn.label,
      nombre: d.user_name,
      alDia: new Date(d.last_snapshot_at).getTime() >= new Date(movida.changedAt).getTime(),
      desde: d.last_snapshot_at,
    })),
  )
  if (filas.length === 0) return null

  return (
    <div>
      <Label>Puerta</Label>
      <div className="mini" style={{ marginTop: 7 }}>
        {filas.map((f) => (
          <Row
            key={f.key}
            title={f.alDia ? `${f.nombre} ya tiene el cambio` : `${f.nombre} todavía no tiene el cambio`}
            sub={
              f.alDia
                ? `Puerta de ${f.funcion}`
                : `Puerta de ${f.funcion} · su lista es de las ${new Date(f.desde).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23',
                  })}. Si no se actualiza en un minuto, avisale que busque señal y toque "Actualizar ahora".`
            }
            status={f.alDia ? <span className="st st--ok">Al día</span> : <span className="st st--warn">Esperando</span>}
          />
        ))}
      </div>
    </div>
  )
}
