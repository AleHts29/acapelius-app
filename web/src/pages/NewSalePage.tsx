import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { EmailStatus, Sale } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime, formatMoney } from '../lib/format'

interface CreatedSale {
  sale: Sale
  publicURL: string
  emailStatus: EmailStatus
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // El fallback es seleccionar a mano el texto visible.
    }
  }

  return (
    <button className="button" type="button" onClick={() => void copy()}>
      {copied ? 'Copiado ✓' : 'Copiar link para WhatsApp'}
    </button>
  )
}

export function NewSalePage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'

  const [functionId, setFunctionId] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [isComp, setIsComp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedSale | null>(null)

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createSale>[0]) => api.createSale(input),
    onSuccess: (result) => {
      setCreated({
        sale: result.sale,
        publicURL: publicSaleURL(result.sale.code),
        emailStatus: result.email_status,
      })
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const fnID = Number(functionId)
    const qty = Number(quantity)
    if (!fnID) {
      setError('Elegi la funcion.')
      return
    }
    if (buyerName.trim() === '') {
      setError('Falta el nombre de quien compra.')
      return
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('La cantidad tiene que ser 1 o mas.')
      return
    }
    create.mutate({
      function_id: fnID,
      buyer_name: buyerName.trim(),
      buyer_email: buyerEmail.trim() || undefined,
      buyer_phone: buyerPhone.trim() || undefined,
      quantity: qty,
      is_comp: isComp || undefined,
    })
  }

  const selectedFunction = functions.data?.functions.find((f) => f.id === Number(functionId))
  const total =
    selectedFunction && Number(quantity) > 0 && !isComp
      ? selectedFunction.price_cents * Number(quantity)
      : 0

  // Pantalla de exito: el link comparte la entrada; de aca se vuelve a vender.
  if (created) {
    return (
      <>
        <h1 className="page-title">Venta registrada ✓</h1>

        <div className="panel panel--success">
          <p className="panel__label">Entrada de {created.sale.buyer_name}</p>
          <p className="credentials">{created.publicURL}</p>
          <div className="stack">
            <CopyLinkButton url={created.publicURL} />
            {created.emailStatus === 'sent' && (
              <p className="muted" style={{ margin: 0 }}>
                El email con los QR ya salio para {created.sale.buyer_email}.
              </p>
            )}
            {created.emailStatus === 'failed' && (
              <p className="alert" style={{ margin: 0 }}>
                El email no salio. Compartile el link o reintenta desde "Mis ventas".
              </p>
            )}
            {created.emailStatus === 'none' && (
              <p className="muted" style={{ margin: 0 }}>
                Sin email: compartile el link, o en la puerta la buscan por nombre.
              </p>
            )}
          </div>
        </div>

        <div className="stack" style={{ marginTop: '1rem' }}>
          <button
            className="button"
            type="button"
            onClick={() => {
              setCreated(null)
              setBuyerName('')
              setBuyerEmail('')
              setBuyerPhone('')
              setQuantity('1')
              setIsComp(false)
            }}
          >
            Registrar otra venta
          </button>
          <Link className="button button--ghost" style={{ textAlign: 'center' }} to="/ventas">
            Ir a mis ventas
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">{isComp ? 'Nueva cortesia' : 'Nueva venta'}</h1>

      <form className="panel" onSubmit={handleSubmit}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field__label">Funcion</span>
          <select
            className="field__input"
            value={functionId}
            onChange={(e) => setFunctionId(e.target.value)}
          >
            <option value="">Elegi la funcion...</option>
            {functions.data?.functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {formatDateTime(fn.starts_at)} — {fn.name ?? fn.venue}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Nombre de quien compra</span>
          <input
            className="field__input"
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Maria Dutra"
          />
        </label>

        <label className="field">
          <span className="field__label">Email (opcional)</span>
          <input
            className="field__input"
            type="email"
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            placeholder="maria@gmail.com"
          />
          <span className="field__hint">Si lo pones, le llega la entrada con los QR.</span>
        </label>

        <div className="form-grid">
          <label className="field">
            <span className="field__label">Telefono (opcional)</span>
            <input
              className="field__input"
              type="tel"
              value={buyerPhone}
              onChange={(e) => setBuyerPhone(e.target.value)}
              inputMode="tel"
            />
          </label>
          <label className="field">
            <span className="field__label">Cantidad</span>
            <input
              className="field__input"
              type="number"
              min={1}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        </div>

        {isAdmin && (
          <label className="field checkbox-field">
            <input type="checkbox" checked={isComp} onChange={(e) => setIsComp(e.target.checked)} />
            <span>Cortesia (sin cargo, no suma deuda)</span>
          </label>
        )}

        {total > 0 && (
          <p className="sale-total">
            Total: <strong>{formatMoney(total)}</strong>
          </p>
        )}

        <button className="button" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Registrando...' : isComp ? 'Emitir cortesia' : 'Registrar venta'}
        </button>
      </form>
    </>
  )
}
