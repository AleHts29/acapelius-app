import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { ApiError, api, publicTicketURL, shareOrCopy } from '../api/client'
import type { PublicTicket } from '../api/client'
import { formatDateTime } from '../lib/format'

/** Dibuja el QR del payload en un canvas, en el browser (spec §7). */
function QRCanvas({ payload }: { payload: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current && payload) {
      void QRCode.toCanvas(ref.current, payload, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
    }
  }, [payload])

  return <canvas ref={ref} className="ticket__qr" aria-label="Codigo QR de la entrada" />
}

/** Boton para reenviarle a una persona SU entrada (link individual). */
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
    <button className="ticket__share" type="button" onClick={() => void share()}>
      {label ?? 'Reenviar esta entrada'}
    </button>
  )
}

function TicketCard({
  ticket,
  index,
  total,
  shareable,
}: {
  ticket: PublicTicket
  index: number
  total: number
  shareable: boolean
}) {
  return (
    <div className="ticket">
      {ticket.status === 'void' ? (
        <p className="ticket__void">Entrada anulada</p>
      ) : (
        <QRCanvas payload={ticket.payload} />
      )}
      <p className="ticket__label">
        Entrada {index} de {total}
        {ticket.status === 'checked_in' && ' · ya ingresada'}
      </p>
      {shareable && ticket.status === 'issued' && (
        <ShareTicketButton code={ticket.code} index={index} />
      )}
    </div>
  )
}

function TicketPageShell({
  title,
  startsAt,
  venue,
  buyerLine,
  children,
}: {
  title: string
  startsAt: string
  venue: string
  buyerLine: string
  children: React.ReactNode
}) {
  return (
    <div className="ticket-page">
      <header className="ticket-page__head">
        <img src="/logo-full-blue.png" alt="Acapelius" style={{ width: 'min(60%, 240px)', marginBottom: '1rem' }} />
        <h1 className="ticket-page__title">{title}</h1>
        <p className="ticket-page__meta">
          {formatDateTime(startsAt)}
          <br />
          {venue}
        </p>
        <p className="ticket-page__buyer">{buyerLine}</p>
      </header>
      {children}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="centered-screen">
      <p className="muted">Cargando tu entrada...</p>
    </div>
  )
}

function ErrorScreen({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError && error.status === 404
      ? 'Esta entrada no existe. Revisá el link.'
      : 'No se pudo cargar la entrada. Probá de nuevo en un rato.'
  return (
    <div className="centered-screen">
      <div className="card">
        <img className="login-logo" src="/logo-full-blue.png" alt="Acapelius" />
        <p className="alert">{message}</p>
      </div>
    </div>
  )
}

// TicketPage es la pagina publica /e/{sale_code}: todas las entradas de la
// compra, cada una con su boton para reenviarla individualmente.
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
    <TicketPageShell
      title={data.function.name ?? 'Acapelius'}
      startsAt={data.function.starts_at}
      venue={data.function.venue}
      buyerLine={`${data.buyer_name}${data.is_comp ? ' · cortesia' : ''}`}
    >
      {data.voided ? (
        <p className="alert" role="alert">
          Esta entrada fue anulada. Cualquier duda, hablá con {data.seller_name}.
        </p>
      ) : (
        <>
          <div className="stack">
            {data.tickets.map((ticket, i) => (
              <TicketCard
                key={ticket.code}
                ticket={ticket}
                index={i + 1}
                total={data.tickets.length}
                shareable={data.tickets.length > 1}
              />
            ))}
          </div>
          <p className="muted ticket-page__note">
            Entrada general, sin numerar. Mostrá un QR por persona en la puerta.
            {data.tickets.length > 1 &&
              ' Con "Reenviar esta entrada" le mandás a cada persona la suya.'}
          </p>
        </>
      )}
    </TicketPageShell>
  )
}

// SingleTicketPage es /t/{ticket_code}: UNA sola entrada, pensada para que el
// comprador le reenvie a cada persona la suya.
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
    <TicketPageShell
      title={data.function.name ?? 'Acapelius'}
      startsAt={data.function.starts_at}
      venue={data.function.venue}
      buyerLine={`Entrada de ${data.buyer_name}${data.is_comp ? ' · cortesia' : ''}`}
    >
      {data.voided || !data.payload ? (
        <p className="alert" role="alert">
          Esta entrada fue anulada. Cualquier duda, hablá con {data.seller_name}.
        </p>
      ) : (
        <>
          <div className="ticket">
            <QRCanvas payload={data.payload} />
            <p className="ticket__label">
              Entrada {data.ticket_index} de {data.sale_quantity}
              {data.status === 'checked_in' && ' · ya ingresada'}
            </p>
          </div>
          <p className="muted ticket-page__note">
            Entrada general, sin numerar. Mostrá este QR en la puerta.
          </p>
        </>
      )}
    </TicketPageShell>
  )
}
