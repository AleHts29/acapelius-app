import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { ApiError, api, publicTicketURL, shareOrCopy } from '../api/client'
import type { PublicTicket } from '../api/client'
import { formatDateTime } from '../lib/format'
import './entrada.css'

// La entrada pública va en lenguaje afiche (C17 §D): es lo único del producto
// que ve el comprador, y es un talón de entrada. Los estilos viven en
// entrada.css con sus propios tokens; nada de Papel pautado acá.

/** Dibuja el QR del payload en un canvas, en el browser (spec §7). */
function QRCanvas({ payload }: { payload: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current && payload) {
      void QRCode.toCanvas(ref.current, payload, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#141414', light: '#ffffff' },
      })
    }
  }, [payload])

  return <canvas ref={ref} className="qrbox__qr" aria-label="Código QR de la entrada" />
}

/** Botón para reenviarle a una persona SU entrada (link individual). */
function ShareTicketButton({ code, index }: { code: string; index: number }) {
  const [label, setLabel] = useState<string | null>(null)

  async function share() {
    const result = await shareOrCopy(`Tu entrada (${index}) — Acapelius`, publicTicketURL(code))
    if (result === 'copied') {
      setLabel('Link copiado ✓')
      setTimeout(() => setLabel(null), 2500)
    } else if (result === 'failed') {
      setLabel('No se pudo compartir')
    }
  }

  return (
    <button className="qrbox__share" type="button" onClick={() => void share()}>
      {label ?? 'Reenviar esta entrada'}
    </button>
  )
}

function QRBox({
  ticket,
  index,
  total,
  shareable,
}: {
  ticket: Pick<PublicTicket, 'code' | 'status' | 'payload'>
  index: number
  total: number
  shareable: boolean
}) {
  return (
    <div className="qrbox">
      {ticket.status === 'void' ? (
        <p className="qrbox__void">Entrada anulada</p>
      ) : (
        <QRCanvas payload={ticket.payload} />
      )}
      <p className="qrbox__label">
        Entrada {index} de {total}
        {ticket.status === 'checked_in' && (
          <>
            {' · '}
            <em>ya ingresó</em>
          </>
        )}
      </p>
      {shareable && ticket.status === 'issued' && <ShareTicketButton code={ticket.code} index={index} />}
    </div>
  )
}

function Talon({
  title,
  startsAt,
  venue,
  buyer,
  isComp,
  seller,
  children,
}: {
  title: string
  startsAt: string
  venue: string
  buyer: string
  isComp: boolean
  seller: string
  children: React.ReactNode
}) {
  return (
    <div className="ent">
      <div className="ent__col">
        <header className="ent__top">
          <b>ACAPELIUS</b>
          <span>Entrada</span>
        </header>
        <article className="talon">
          <div className="talon__head">
            <p className="talon__eyebrow">Función</p>
            <h1 className="talon__title">{title}</h1>
            <p className="talon__when">{formatDateTime(startsAt)}</p>
            <p className="talon__venue">{venue}</p>
          </div>
          <div className="talon__buyer">
            <div>
              <small>A nombre de</small>
              <b>{buyer}</b>
            </div>
            {isComp && <span className="talon__chip">Cortesía</span>}
          </div>
          <div className="talon__cut" aria-hidden="true" />
          {children}
        </article>
        <footer className="ent__foot">
          <span>Vendida por {seller}</span>
          <a href="/">acapelius</a>
        </footer>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="ent ent--centered">
      <p className="ent__note">Cargando tu entrada…</p>
    </div>
  )
}

function ErrorScreen({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError && error.status === 404
      ? 'Esta entrada no existe. Revisá el link.'
      : 'No se pudo cargar la entrada. Probá de nuevo en un rato.'
  return (
    <div className="ent ent--centered">
      <div className="ent__col" style={{ width: '100%' }}>
        <header className="ent__top">
          <b>ACAPELIUS</b>
          <span>Entrada</span>
        </header>
        <p className="ent__alert" role="alert">
          {message}
        </p>
      </div>
    </div>
  )
}

// TicketPage es la página pública /e/{sale_code}: todas las entradas de la
// compra, cada una con su botón para reenviarla individualmente.
export function TicketPage() {
  const { saleCode } = useParams()

  const { data, error, isPending } = useQuery({
    queryKey: ['public-sale', saleCode],
    queryFn: () => api.publicSale(saleCode ?? ''),
    enabled: Boolean(saleCode),
    retry: 1,
  })

  if (isPending) return <LoadingScreen />
  if (error || !data) return <ErrorScreen error={error} />

  return (
    <Talon
      title={data.function.name ?? 'Acapelius'}
      startsAt={data.function.starts_at}
      venue={data.function.venue}
      buyer={data.buyer_name}
      isComp={data.is_comp}
      seller={data.seller_name}
    >
      {data.voided ? (
        <p className="ent__alert" role="alert">
          Esta entrada fue anulada. Cualquier duda, hablá con {data.seller_name}.
        </p>
      ) : (
        <>
          {data.tickets.map((ticket, i) => (
            <QRBox
              key={ticket.code}
              ticket={ticket}
              index={i + 1}
              total={data.tickets.length}
              shareable={data.tickets.length > 1}
            />
          ))}
          <p className="ent__note" style={{ padding: '0 16px 14px' }}>
            Entrada general, sin numerar · un QR por persona en la puerta
            {data.tickets.length > 1 && ' · con "Reenviar" le mandás a cada uno la suya'}
          </p>
        </>
      )}
    </Talon>
  )
}

// SingleTicketPage es /t/{ticket_code}: UNA sola entrada, pensada para que el
// comprador le reenvíe a cada persona la suya.
export function SingleTicketPage() {
  const { ticketCode } = useParams()

  const { data, error, isPending } = useQuery({
    queryKey: ['public-ticket', ticketCode],
    queryFn: () => api.publicTicket(ticketCode ?? ''),
    enabled: Boolean(ticketCode),
    retry: 1,
  })

  if (isPending) return <LoadingScreen />
  if (error || !data) return <ErrorScreen error={error} />

  return (
    <Talon
      title={data.function.name ?? 'Acapelius'}
      startsAt={data.function.starts_at}
      venue={data.function.venue}
      buyer={data.buyer_name}
      isComp={data.is_comp}
      seller={data.seller_name}
    >
      {data.voided || !data.payload ? (
        <p className="ent__alert" role="alert">
          Esta entrada fue anulada. Cualquier duda, hablá con {data.seller_name}.
        </p>
      ) : (
        <>
          <QRBox
            ticket={{ code: data.code, status: data.status, payload: data.payload }}
            index={data.ticket_index}
            total={data.sale_quantity}
            shareable={false}
          />
          <p className="ent__note" style={{ padding: '0 16px 14px' }}>
            Entrada general, sin numerar · mostrá este QR en la puerta
          </p>
        </>
      )}
    </Talon>
  )
}
