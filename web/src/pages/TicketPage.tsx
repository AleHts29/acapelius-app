import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { ApiError, api } from '../api/client'
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

function TicketCard({ ticket, index, total }: { ticket: PublicTicket; index: number; total: number }) {
  return (
    <div className="ticket">
      {ticket.status === 'void' ? (
        <p className="ticket__void">Entrada anulada</p>
      ) : (
        <QRCanvas payload={ticket.payload} />
      )}
      <p className="ticket__label">
        Entrada {index + 1} de {total}
        {ticket.status === 'checked_in' && ' · ya ingresada'}
      </p>
    </div>
  )
}

// TicketPage es la pagina publica /e/{sale_code}: sin login, pensada para
// abrirse desde el mail o un link de WhatsApp y mostrarse en la puerta.
export function TicketPage() {
  const { saleCode } = useParams()

  const { data, error, isPending } = useQuery({
    queryKey: ['public-sale', saleCode],
    queryFn: () => api.publicSale(saleCode ?? ''),
    enabled: Boolean(saleCode),
    retry: 1,
  })

  if (isPending) {
    return (
      <div className="centered-screen">
        <p className="muted">Cargando tu entrada...</p>
      </div>
    )
  }

  if (error || !data) {
    const message =
      error instanceof ApiError && error.status === 404
        ? 'Esta entrada no existe. Revisa el link.'
        : 'No se pudo cargar la entrada. Proba de nuevo en un rato.'
    return (
      <div className="centered-screen">
        <div className="card">
          <h1 className="card__title">Acapelius</h1>
          <p className="alert">{message}</p>
        </div>
      </div>
    )
  }

  const title = data.function.name ?? 'Acapelius'

  return (
    <div className="ticket-page">
      <header className="ticket-page__head">
        <h1 className="ticket-page__title">{title}</h1>
        <p className="ticket-page__meta">
          {formatDateTime(data.function.starts_at)}
          <br />
          {data.function.venue}
        </p>
        <p className="ticket-page__buyer">
          {data.buyer_name}
          {data.is_comp && ' · cortesia'}
        </p>
      </header>

      {data.voided ? (
        <p className="alert" role="alert">
          Esta entrada fue anulada. Cualquier duda, habla con {data.seller_name}.
        </p>
      ) : (
        <>
          <div className="stack">
            {data.tickets.map((ticket, i) => (
              <TicketCard key={ticket.code} ticket={ticket} index={i} total={data.tickets.length} />
            ))}
          </div>
          <p className="muted ticket-page__note">
            Entrada general, sin numerar. Mostra un QR por persona en la puerta.
          </p>
        </>
      )}
    </div>
  )
}
