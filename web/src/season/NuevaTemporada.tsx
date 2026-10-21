import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, SeasonOverview } from '../api/client'
import { formatMoney } from '../lib/format'
import { Button } from '../ui/Button'
import { Menu } from '../ui/Menu'
import { Modal } from '../ui/Modal'
import { Row } from '../ui/Row'

/**
 * Las claves que hay que refrescar cuando cambia cuál es la temporada en curso:
 * mueve todo lo que se calcula por temporada.
 */
export const DEPENDEN_DE_LA_TEMPORADA = [
  ['seasons'],
  ['seasons-overview'],
  ['settlements-report'],
  ['settlements-history'],
  ['attention'],
  ['functions-summary'],
  ['sales-timeline'],
  ['direccion'],
  ['sales'],
  ['team'],
  ['home'],
]

export function NuevaTemporada({
  copiarDe,
  enCurso,
  onClose,
}: {
  /** Temporada cuya grilla se ofrece copiar (la que está en curso, o la elegida). */
  copiarDe?: SeasonOverview
  enCurso?: SeasonOverview
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [paso, setPaso] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [copiar, setCopiar] = useState(copiarDe !== undefined && copiarDe.functions > 0)
  const [cerrar, setCerrar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El equipo de la temporada de la que se parte: vienen todas tildadas con su
  // rol, se destilda a las que se fueron. Es el momento natural para
  // resolverlo, y con el dato que hace falta para decidir: cuánto vendió cada
  // una el año pasado.
  const equipo = useQuery({
    queryKey: ['team', copiarDe?.id],
    queryFn: () => api.team(copiarDe!.id),
    enabled: copiarDe !== undefined,
  })
  const candidatas = equipo.data?.members ?? []
  const [siguen, setSiguen] = useState<Map<number, Role> | null>(null)
  // Se inicializa una sola vez, cuando llega el equipo: si se recalculara en
  // cada render se perderían los destildados.
  const elegidas = siguen ?? new Map(candidatas.filter((m) => m.left_at === null).map((m) => [m.id, m.role]))

  const crear = useMutation({
    mutationFn: (input: Parameters<typeof api.createSeason>[0]) => api.createSeason(input),
    onSuccess: (res) => {
      for (const key of DEPENDEN_DE_LA_TEMPORADA) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      onClose()
      navigate(`/temporadas/${res.season.id}`)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la temporada.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setError('Poné un nombre, por ejemplo "Temporada 2027".')
      return
    }
    crear.mutate({
      name: name.trim(),
      activate: cerrar,
      copy_from_season_id: copiar && copiarDe ? copiarDe.id : undefined,
      members:
        candidatas.length > 0
          ? [...elegidas].map(([user_id, role]) => ({ user_id, role }))
          : undefined,
    })
  }

  function cambiar(id: number, role: Role | null) {
    const next = new Map(elegidas)
    if (role === null) next.delete(id)
    else next.set(id, role)
    setSiguen(next)
  }

  const conDeuda = candidatas.filter((m) => !elegidas.has(m.id) && m.balance_cents > 0)

  const hayPaso2 = candidatas.length > 0

  const continuar = () => {
    if (name.trim() === '') {
      setError('Poné un nombre, por ejemplo "Temporada 2027".')
      return
    }
    setError(null)
    setPaso(2)
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={hayPaso2 ? `Nueva temporada · paso ${paso} de 2` : 'Temporadas'}
      title={paso === 1 ? 'Nueva temporada' : '¿Quiénes siguen en el coro?'}
      sub={
        paso === 1
          ? 'Después vas a poder agregarle funciones'
          : `${name || 'La temporada nueva'} · vienen tildadas las de ${copiarDe?.name ?? 'la anterior'}`
      }
      footer={
        <>
          <Button onClick={() => (paso === 2 ? setPaso(1) : onClose())}>{paso === 2 ? 'Volver' : 'Cancelar'}</Button>
          {hayPaso2 && paso === 1 ? (
            <Button go onClick={continuar}>
              Continuar
            </Button>
          ) : (
            <Button go type="submit" form="nueva-temporada" disabled={crear.isPending}>
              {crear.isPending ? 'Creando…' : 'Crear temporada'}
            </Button>
          )}
        </>
      }
    >
      <form id="nueva-temporada" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {paso === 1 && (
          <>
            <label className="field">
              <span className="lbl">Nombre</span>
              <input
                className="field__input"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Temporada 2027"
              />
            </label>
            {copiarDe && copiarDe.functions > 0 && (
              <Casilla on={copiar} onToggle={() => setCopiar(!copiar)} title={`Copiar la estructura de ${copiarDe.name}`}>
                Crea las mismas {copiarDe.functions} {copiarDe.functions === 1 ? 'función' : 'funciones'} con su
                lugar, cupo y precio, sin ventas y con las fechas corridas un año —el mismo día de la semana—.
                Después ajustás lo que haga falta.
              </Casilla>
            )}
            {enCurso && (
              <Casilla on={cerrar} onToggle={() => setCerrar(!cerrar)} title={`Cerrar ${enCurso.name}`}>
                La nueva pasa a ser la temporada en curso y {enCurso.name} queda como histórico. Sin esto, la
                temporada nueva se carga aparte y el resto de la app sigue mostrando {enCurso.name}.
              </Casilla>
            )}
          </>
        )}

        {paso === 2 && (
          <>
            <div className="mini">
              {candidatas.map((m) => {
                const sigue = elegidas.has(m.id)
                return (
                  <Row
                    key={m.id}
                    title={m.name}
                    sub={[
                      m.last_login_at === null
                        ? `nunca activó su cuenta en ${copiarDe?.name ?? 'la temporada anterior'}`
                        : m.role === 'seller'
                          ? `corista · vendió ${m.tickets_sold}`
                          : roleLabel(m.role),
                      m.balance_cents > 0 ? `debe rendir ${formatMoney(m.balance_cents)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    dim={!sigue}
                    status={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                        <Menu
                          trigger="btn"
                          label={roleLabel(elegidas.get(m.id) ?? m.role)}
                          ariaLabel={`Rol de ${m.name}`}
                          value={elegidas.get(m.id) ?? m.role}
                          align="right"
                          groups={[
                            {
                              options: (['seller', 'door', 'admin'] as Role[]).map((rol) => ({
                                id: rol,
                                label: roleLabel(rol),
                                onSelect: () => cambiar(m.id, rol),
                              })),
                            },
                          ]}
                        />
                        <button
                          type="button"
                          className={`check__bx${sigue ? ' check__bx--on' : ''}`}
                          aria-label={`${sigue ? 'Sacar a' : 'Sumar a'} ${m.name}`}
                          aria-pressed={sigue}
                          onClick={() => cambiar(m.id, sigue ? null : m.role)}
                        >
                          {sigue && <Check size={12} strokeWidth={3.2} aria-hidden />}
                        </button>
                      </span>
                    }
                  />
                )
              })}
            </div>
            <p className="note">
              Siguen {elegidas.size} de {candidatas.length}
              {conDeuda.length > 0 &&
                ` · ${conDeuda.map((m) => m.name.split(' ')[0]).join(', ')} ${conDeuda.length === 1 ? 'queda fuera' : 'quedan fuera'} con deuda pendiente`}
              . Quien queda fuera no se borra: sigue en los números de las temporadas en las que estuvo, y se
              la reincorpora desde Equipo.
            </p>
          </>
        )}
      </form>
    </Modal>
  )
}

function Casilla({
  on,
  onToggle,
  title,
  children,
}: {
  on: boolean
  onToggle: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button type="button" className="check" aria-pressed={on} onClick={onToggle}>
      <span className={`check__bx${on ? ' check__bx--on' : ''}`} aria-hidden>
        {on && <Check size={12} strokeWidth={3.2} />}
      </span>
      <span className="check__tx">
        <b>{title}</b>
        <span>{children}</span>
      </span>
    </button>
  )
}

/**
 * El alta de temporada como pop-up, disparable desde cualquier lado (C16): el
 * selector global la abre sin pasar por el índice. Trae por su cuenta la
 * temporada de la que se parte, que es siempre la que está en curso.
 */
export function NuevaTemporadaPanel({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['seasons-overview'], queryFn: () => api.seasonsOverview() })
  const enCurso = data?.seasons.find((s) => s.is_active)
  return <NuevaTemporada copiarDe={enCurso} enCurso={enCurso} onClose={onClose} />
}
