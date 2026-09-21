import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, SeasonOverview } from '../api/client'
import { formatMoney } from '../lib/format'
import { initials } from '../lib/search'
import { ActionPanel } from '../ui/ActionPanel'
import { Menu } from '../ui/Menu'

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

  return (
    <form className="sheet-form" onSubmit={handleSubmit}>
      <div className="sheet-head">
        <span>
          <b>{paso === 1 ? 'Nueva temporada' : '¿Quiénes siguen en el coro?'}</b>
          <span>
            {paso === 1
              ? 'Después vas a poder agregarle funciones'
              : `${name || 'La temporada nueva'} · vienen tildadas las de ${copiarDe?.name ?? 'la anterior'}`}
          </span>
        </span>
      </div>

      {hayPaso2 && (
        <div className="pasos">
          <span className={paso === 1 ? 'on' : 'done'}>
            {paso === 1 ? '1' : <Check size={11} strokeWidth={3.2} aria-hidden />} Nombre
          </span>
          <span className={paso === 2 ? 'on' : ''}>2 Equipo</span>
        </div>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div hidden={paso !== 1}>
      <label className="field">
        <span className="field__label">Nombre</span>
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
        <Casilla
          on={copiar}
          onToggle={() => setCopiar(!copiar)}
          title={`Copiar la estructura de ${copiarDe.name}`}
        >
          Crea las mismas {copiarDe.functions}{' '}
          {copiarDe.functions === 1 ? 'función' : 'funciones'} con su lugar, cupo y precio, sin
          ventas y con las fechas corridas un año —el mismo día de la semana—. Después ajustás lo
          que haga falta.
        </Casilla>
      )}

      {enCurso && (
        <Casilla on={cerrar} onToggle={() => setCerrar(!cerrar)} title={`Cerrar ${enCurso.name}`}>
          La nueva pasa a ser la temporada en curso y {enCurso.name} queda como histórico. Sin
          esto, la temporada nueva se carga aparte y el resto de la app sigue mostrando{' '}
          {enCurso.name}.
        </Casilla>
      )}

      </div>

      {paso === 2 && (
        <div className="quienes">
          {candidatas.map((m) => {
            const sigue = elegidas.has(m.id)
            return (
              <div key={m.id} className={`quienes__r${sigue ? '' : ' quienes__r--off'}`}>
                <button
                  type="button"
                  className={`check__bx${sigue ? ' check__bx--on' : ''}`}
                  aria-label={`${sigue ? 'Sacar a' : 'Sumar a'} ${m.name}`}
                  aria-pressed={sigue}
                  onClick={() => cambiar(m.id, sigue ? null : m.role)}
                >
                  {sigue && <Check size={12} strokeWidth={3.2} aria-hidden />}
                </button>
                <span className="ini">{initials(m.name)}</span>
                <span className="quienes__who">
                  <b>{m.name}</b>
                  <span>
                    {m.last_login_at === null
                      ? `Nunca activó su cuenta en ${copiarDe?.name ?? 'la temporada anterior'}`
                      : m.role === 'seller'
                        ? `Corista · vendió ${m.tickets_sold} entradas`
                        : roleLabel(m.role)}
                    {m.balance_cents > 0 && (
                      <>
                        {' · '}
                        <b className="y">debe rendir {formatMoney(m.balance_cents)}</b>
                      </>
                    )}
                  </span>
                </span>
                <span className="quienes__rol">
                  <Menu
                    trigger="pill"
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
                </span>
              </div>
            )
          })}

        </div>
      )}

      {paso === 2 && (
        <>
          <p className="quienes__pie">
            Seguirán <b>{elegidas.size}</b> de {candidatas.length}
            {conDeuda.length > 0 && (
              <>
                {' · '}
                <b className="y">
                  {conDeuda.map((m) => m.name.split(' ')[0]).join(', ')}{' '}
                  {conDeuda.length === 1 ? 'queda fuera' : 'quedan fuera'} con deuda pendiente
                </b>
              </>
            )}
          </p>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
            Quien queda fuera no se borra: sigue apareciendo en los números de las temporadas en
            las que estuvo, y se la reincorpora desde Equipo cuando haga falta.
          </p>
        </>
      )}

      <div className="form-row" style={{ marginTop: 14 }}>
        {hayPaso2 && paso === 1 ? (
          <button
            className="button"
            type="button"
            onClick={() => {
              if (name.trim() === '') {
                setError('Poné un nombre, por ejemplo "Temporada 2027".')
                return
              }
              setError(null)
              setPaso(2)
            }}
          >
            Continuar
          </button>
        ) : (
          <button className="button" type="submit" disabled={crear.isPending}>
            {crear.isPending ? 'Creando…' : 'Crear temporada'}
          </button>
        )}
        <button
          className="button button--ghost form-row__action"
          type="button"
          onClick={() => (paso === 2 ? setPaso(1) : onClose())}
        >
          {paso === 2 ? 'Volver' : 'Cancelar'}
        </button>
      </div>
    </form>
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

  return (
    <ActionPanel label="Nueva temporada" size="form" onClose={onClose}>
      <NuevaTemporada copiarDe={enCurso} enCurso={enCurso} onClose={onClose} />
    </ActionPanel>
  )
}
