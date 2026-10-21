import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, publicSaleURL, shareOrCopy } from '../api/client'
import type { EmailStatus, Sale } from '../api/client'
import { useSession } from '../auth/session'
import { formatMoney, functionDay, functionTime } from '../lib/format'
import { Button } from '../ui/Button'
import { Menu } from '../ui/Menu'
import { Stepper } from '../ui/Stepper'

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
      setLabel('Link copiado')
      setTimeout(() => setLabel(null), 2500)
    } else if (result === 'failed') {
      setLabel('No se pudo copiar; copiá el link de abajo a mano')
    }
  }

  return (
    <Button go wide onClick={() => void share()}>
      {label ?? 'Compartir por WhatsApp'}
    </Button>
  )
}

export function NewSalePage({ onDone }: { onDone?: () => void } = {}) {
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
      void queryClient.invalidateQueries({ queryKey: ['home'] })
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        <div>
          <span className="lbl">Venta registrada</span>
          <h1 className="pgt" style={{ marginTop: 6 }}>
            Entradas de {created.sale.buyer_name}
          </h1>
        </div>
        <p className="rs" style={{ margin: 0, whiteSpace: 'normal' }} role="status">
          {created.emailStatus === 'sent' && `El mail con los QR ya salió para ${created.sale.buyer_email}.`}
          {created.emailStatus === 'failed' && 'El mail no salió. Compartile el link, o reintentá desde Ventas.'}
          {created.emailStatus === 'preview' &&
            `En la demo no se mandan mails: la entrada que le llegaría a ${created.sale.buyer_email} es este link.`}
          {created.emailStatus === 'none' && 'Sin mail: compartile el link, o en la puerta la buscan por nombre.'}
        </p>
        <ShareLinkButton url={created.publicURL} buyerName={created.sale.buyer_name} />
        <div className="dl">
          <div className="dl__r">
            <span className="dl__k">Link</span>
            <span className="dl__v" style={{ wordBreak: 'break-all' }}>
              {created.publicURL}
            </span>
          </div>
        </div>
        <Button
          wide
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
        </Button>
        {/* Dentro del popup ya estamos en la lista: cerrar alcanza. */}
        {onDone ? (
          <Button wide onClick={onDone}>
            Volver a la lista
          </Button>
        ) : (
          <Button to="/ventas">Ir a mis ventas</Button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {/* En el popup de escritorio el título ya está en la cabecera. */}
      {!onDone && <h1 className="pgt">{isComp ? 'Nueva cortesía' : 'Nueva venta'}</h1>}
      {onDone && isComp && <span className="lbl">Cortesía</span>}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div>
        <span className="lbl">Función</span>
        <div style={{ marginTop: 7 }}>
          <Menu
            trigger="field"
            ariaLabel="Función"
            label={
              selectedFunction
                ? `${functionDay(selectedFunction.starts_at)} · ${functionTime(selectedFunction.starts_at)}`
                : 'Elegí la función…'
            }
            value={functionId === '' ? undefined : functionId}
            groups={[
              {
                options: (functions.data?.functions ?? []).map((fn) => {
                  const cupo = allocationFor(fn.id)
                  const cuando = `${functionDay(fn.starts_at)} · ${functionTime(fn.starts_at)}`
                  return {
                    id: String(fn.id),
                    label: fn.name ?? fn.venue,
                    // El cupo que le queda a la corista es lo que decide si
                    // puede vender: va como contexto de cada opción, no
                    // escondido detrás de un "disabled" sin explicación.
                    hint: isAdmin ? cuando : `${cuando} · te quedan ${cupo?.remaining ?? 0} de ${cupo?.assigned ?? 0}`,
                    disabled: !isAdmin && !cupo,
                    disabledReason: `${cuando} · dirección todavía no te asignó cupo`,
                    onSelect: () => setFunctionId(String(fn.id)),
                  }
                }),
              },
            ]}
          />
        </div>
        {!isAdmin && selectedAllocation && !isComp && (
          <p className="rs" style={{ margin: '6px 0 0' }}>
            Te quedan {selectedAllocation.remaining} de {selectedAllocation.assigned} para esta función
          </p>
        )}
      </div>

      <div>
        <span className="lbl">Comprador</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)', marginTop: 7 }}>
          <input
            className="field__input"
            style={{ marginTop: 0 }}
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Nombre y apellido"
            aria-label="Nombre y apellido de quien compra"
          />
          <input
            className="field__input"
            style={{ marginTop: 0 }}
            type="email"
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            placeholder="Mail"
            aria-label="Mail de quien compra"
          />
          <input
            className="field__input"
            style={{ marginTop: 0 }}
            type="tel"
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            inputMode="tel"
            placeholder="Teléfono (opcional)"
            aria-label="Teléfono de quien compra (opcional)"
          />
        </div>
        <p className="rs" style={{ margin: '6px 0 0', whiteSpace: 'normal' }}>
          Al mail le llega el QR. Si no tiene, después compartís el link.
        </p>
      </div>

      <div>
        <span className="lbl">Cantidad</span>
        <div className="card" style={{ marginTop: 7, padding: 'var(--s2) var(--s3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)' }}>
          <Stepper
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={maxQty}
            maxReason={quotaLimited ? 'Llegaste a tu cupo. Si necesitás más, pedile a dirección.' : 'No queda más cupo en la función.'}
          />
          <div style={{ textAlign: 'right' }} aria-live="polite">
            <span className="lbl">Total</span>
            <div className="rn" style={{ fontSize: 17 }}>
              {isComp ? 'Cortesía' : formatMoney(total)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
        {isAdmin && (
          <Button wide onClick={() => setIsComp(!isComp)}>
            {isComp ? 'Volver a venta común' : 'Marcar como cortesía'}
          </Button>
        )}
        <Button go wide type="submit" disabled={create.isPending}>
          {create.isPending ? 'Registrando…' : isComp ? 'Emitir cortesía' : 'Registrar venta'}
        </Button>
      </div>
    </form>
  )
}
