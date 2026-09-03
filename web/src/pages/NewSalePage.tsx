import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail } from 'lucide-react'

import { ApiError, api, publicSaleURL, shareOrCopy } from '../api/client'
import type { EmailStatus, Sale } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime, formatMoney } from '../lib/format'
import { Stepper } from '../ui/controls'

interface CreatedSale {
  sale: Sale
  publicURL: string
  emailStatus: EmailStatus
}

function ShareLinkButton({ url, buyerName }: { url: string; buyerName: string }) {
  const [label, setLabel] = useState<string | null>(null)

  async function share() {
    const result = await shareOrCopy(`Entradas de ${buyerName} — Acapelius`, url)
    if (result === 'copied') {
      setLabel('Link copiado ✓')
      setTimeout(() => setLabel(null), 2500)
    } else if (result === 'failed') {
      setLabel('No se pudo copiar; tocá el link de abajo y copialo a mano')
    }
  }

  return (
    <button className="button" type="button" onClick={() => void share()}>
      {label ?? 'Compartir por WhatsApp'}
    </button>
  )
}

export function NewSalePage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()

  const [functionId, setFunctionId] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [isComp, setIsComp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedSale | null>(null)

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })
  // Cupos asignados por direccion (C8): la corista solo vende lo suyo.
  const myAllocations = useQuery({
    queryKey: ['my-allocations'],
    queryFn: () => api.myAllocations(),
    enabled: !isAdmin,
  })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createSale>[0]) => api.createSale(input),
    onSuccess: (result) => {
      setCreated({
        sale: result.sale,
        publicURL: publicSaleURL(result.sale.code),
        emailStatus: result.email_status,
      })
      setError(null)
      // El cupo, el progreso del hero y el listado cambiaron.
      void queryClient.invalidateQueries({ queryKey: ['my-allocations'] })
      void queryClient.invalidateQueries({ queryKey: ['functions'] })
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const fnID = Number(functionId)
    if (!fnID) {
      setError('Elegí la función.')
      return
    }
    if (buyerName.trim() === '') {
      setError('Falta el nombre de quien compra.')
      return
    }
    if (!isAdmin && !isComp && !allocationFor(fnID)) {
      setError('No tenés cupo asignado para esta función. Pedile a dirección que te asigne entradas.')
      return
    }
    create.mutate({
      function_id: fnID,
      buyer_name: buyerName.trim(),
      buyer_email: buyerEmail.trim() || undefined,
      buyer_phone: buyerPhone.trim() || undefined,
      quantity,
      is_comp: isComp || undefined,
    })
  }

  const selectedFunction = functions.data?.functions.find((f) => f.id === Number(functionId))
  const total = selectedFunction ? selectedFunction.price_cents * quantity : 0

  const allocationFor = (fnId: number) =>
    myAllocations.data?.allocations.find((a) => a.function_id === fnId)
  const selectedAllocation = selectedFunction ? allocationFor(selectedFunction.id) : undefined
  const remainingCapacity = selectedFunction
    ? Math.max(selectedFunction.capacity - selectedFunction.sold, 0)
    : undefined
  // Tope del stepper: cupo personal (corista, salvo cortesia) y capacity.
  const maxQty = selectedFunction
    ? isAdmin || isComp
      ? remainingCapacity
      : Math.min(selectedAllocation?.remaining ?? 0, remainingCapacity ?? 0)
    : undefined
  const quotaLimited =
    !isAdmin && !isComp && selectedAllocation !== undefined &&
    (selectedAllocation.remaining ?? 0) <= (remainingCapacity ?? Infinity)

  if (created) {
    return (
      <div className="form-page">
        <h1 className="page-title">Venta registrada ✓</h1>

        <div className="panel panel--success">
          <p className="panel__label">Entradas de {created.sale.buyer_name}</p>
          <div className="success-actions">
            {created.emailStatus === 'sent' && (
              <p className="muted" style={{ margin: 0, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={14} aria-hidden style={{ flexShrink: 0 }} />
                El email con los QR ya salió para {created.sale.buyer_email}.
              </p>
            )}
            {created.emailStatus === 'failed' && (
              <p className="alert" role="alert">
                El email no salió. Compartile el link, o reintentá desde "Mis ventas".
              </p>
            )}
            {created.emailStatus === 'none' && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Sin email: compartile el link, o en la puerta la buscan por nombre.
              </p>
            )}
            <ShareLinkButton url={created.publicURL} buyerName={created.sale.buyer_name} />
            <span className="link-chip">{created.publicURL}</span>
          </div>
        </div>

        <div className="stack" style={{ marginTop: 12 }}>
          <button
            className="button"
            type="button"
            onClick={() => {
              setCreated(null)
              setBuyerName('')
              setBuyerEmail('')
              setBuyerPhone('')
              setQuantity(1)
              setIsComp(false)
            }}
          >
            Registrar otra venta
          </button>
          <Link className="button button--ghost" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', width: '100%' }} to="/ventas">
            Ir a mis ventas
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="form-page">
      <h1 className="page-title">{isComp ? 'Nueva cortesía' : 'Nueva venta'}</h1>

      <form className="panel" style={{ borderRadius: 18 }} onSubmit={handleSubmit}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field__label">Función</span>
          <select
            className="field__input"
            value={functionId}
            onChange={(e) => setFunctionId(e.target.value)}
          >
            <option value="">Elegí la función…</option>
            {functions.data?.functions.map((fn) => {
              const noQuota = !isAdmin && !allocationFor(fn.id)
              return (
                <option key={fn.id} value={fn.id} disabled={noQuota}>
                  {fn.name ?? fn.venue} · {formatDateTime(fn.starts_at)}
                  {noQuota ? ' · Sin cupo asignado' : ''}
                </option>
              )
            })}
          </select>
        </label>

        {!isAdmin && selectedAllocation && !isComp && (
          <div className="quota-banner">
            Te quedan <b>{selectedAllocation.remaining}</b> de {selectedAllocation.assigned} para{' '}
            {selectedFunction?.name ?? selectedFunction?.venue} · Asignadas por dirección
          </div>
        )}

        <label className="field">
          <span className="field__label">Quién compra</span>
          <input
            className="field__input"
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="María Dutra"
          />
        </label>

        <label className="field">
          <span className="field__label">Email</span>
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
          <span className="field__hint">
            Le llega la entrada con los QR. Si no tiene, después compartís el link.
          </span>
        </label>

        <label className="field">
          <span className="field__label">Teléfono (opcional)</span>
          <input
            className="field__input"
            type="tel"
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            inputMode="tel"
          />
        </label>

        <div className="field">
          <span className="field__label">Cantidad</span>
          <div className="qty">
            <Stepper
              value={quantity}
              onChange={setQuantity}
              min={1}
              max={maxQty}
              maxReason={
                quotaLimited
                  ? 'Llegaste a tu cupo. Si necesitás más, pedile a Eli.'
                  : 'No queda más cupo en la función.'
              }
            />
            <div className="qty__total">
              Total
              <b>{isComp ? 'Cortesía' : formatMoney(total)}</b>
            </div>
          </div>
        </div>

        <button className="button" style={{ marginTop: 16 }} type="submit" disabled={create.isPending}>
          {create.isPending
            ? 'Registrando…'
            : isComp
              ? 'Emitir cortesía'
              : 'Registrar venta y enviar QR'}
        </button>
        {isAdmin && (
          <button
            className="button button--ghost"
            style={{ width: '100%', marginTop: 9 }}
            type="button"
            onClick={() => setIsComp(!isComp)}
          >
            {isComp ? 'Volver a venta común' : 'Marcar como cortesía'}
          </button>
        )}
      </form>
    </div>
  )
}
