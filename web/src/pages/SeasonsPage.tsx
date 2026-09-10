import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, CopyPlus, Play } from 'lucide-react'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, SeasonOverview } from '../api/client'
import { calendarDaysUntil, dayAndMonthShort, formatMoney } from '../lib/format'
import { initials } from '../lib/search'
import { ActionPanel } from '../ui/ActionPanel'
import { Menu } from '../ui/Menu'
import { EmptyState, PageHead, ProgressBar } from '../ui/controls'

/** Las claves que hay que refrescar cuando cambia cuál es la temporada en curso. */
const DEPENDEN_DE_LA_TEMPORADA = [
  ['seasons'],
  ['seasons-overview'],
  ['settlements-report'],
  ['settlements-history'],
  ['attention'],
  ['functions-summary'],
  ['sales-timeline'],
  ['direccion'],
  ['home'],
]

function rango(s: SeasonOverview): string {
  if (!s.first_at || !s.last_at) return 'Sin funciones'
  if (s.first_at === s.last_at) return dayAndMonthShort(s.first_at)
  return `${dayAndMonthShort(s.first_at)} – ${dayAndMonthShort(s.last_at)}`
}

function anio(s: SeasonOverview): string {
  return new Date(s.first_at ?? s.created_at).getFullYear().toString()
}

/**
 * Estado de una temporada. "Cerrada" es sólo la que ya pasó: una temporada que
 * se carga para el año que viene todavía no está en curso, pero llamarla
 * cerrada sería exactamente al revés de lo que es.
 */
function estado(s: SeasonOverview): 'en curso' | 'preparándose' | 'cerrada' {
  if (s.is_active) return 'en curso'
  return s.functions > 0 && !s.next_at ? 'cerrada' : 'preparándose'
}

/** El renglón bajo el nombre: qué falta si está en curso, qué pasó si ya no. */
function contexto(s: SeasonOverview): string {
  const funciones = `${s.functions} ${s.functions === 1 ? 'función' : 'funciones'}`
  if (s.functions === 0) return 'Todavía sin funciones'
  if (estado(s) === 'cerrada') {
    if (s.sellers === 0) return `${funciones} · sin ventas`
    return `${funciones} · ${s.sellers} ${s.sellers === 1 ? 'corista' : 'coristas'}`
  }
  if (!s.next_at) return `${funciones} · ya pasaron todas`
  const dias = calendarDaysUntil(s.next_at)
  if (dias <= 0) return `${funciones} · la próxima es hoy`
  if (dias === 1) return `${funciones} · la próxima es mañana`
  if (!s.is_active) return `${funciones} · arranca el ${dayAndMonthShort(s.next_at)}`
  return `${funciones} · próxima en ${dias} días`
}

function Fila({
  s,
  onVer,
  onUsar,
  onCopiar,
}: {
  s: SeasonOverview
  onVer: () => void
  onUsar: () => void
  onCopiar: () => void
}) {
  const ocupacion = s.capacity > 0 ? Math.round((s.sold / s.capacity) * 100) : 0
  const libres = Math.max(s.capacity - s.assigned, 0)
  const cerrada = estado(s) === 'cerrada'

  return (
    <article className={`seasonrow${s.is_active ? ' seasonrow--live' : ''}`}>
      <div className="seasonrow__nm">
        <div className="seasonrow__t">
          <b>{s.name}</b>
          <span className={`fntag${s.is_active ? ' fntag--live' : ''}`}>{estado(s)}</span>
        </div>
        <div className="seasonrow__v">{contexto(s)}</div>
      </div>

      <div className="seasonrow__dt">
        <b>{rango(s)}</b>
        <span>{anio(s)}</span>
      </div>

      <div className="seasonrow__prog">
        <ProgressBar value={s.sold} max={s.capacity} tone={cerrada ? 'ok' : 'blue'} />
        <div className="seasonrow__lg">
          <span>
            <b>{s.sold}</b>/{s.capacity} vendidas
          </span>
          {/* Mientras se puede vender, lo que importa es lo que falta
              repartir; en una cerrada eso ya no se cambia, y lo que queda para
              mirar es cómo terminó. */}
          <span>{cerrada ? `${ocupacion}% de ocupación` : `${libres} sin asignar`}</span>
        </div>
      </div>

      <div className="seasonrow__money">
        <b>{formatMoney(s.collected_cents)}</b>
        <span>Recaudado</span>
      </div>

      <div className="seasonrow__acts">
        <button className="button button--ghost button--sm" type="button" onClick={onVer}>
          Ver funciones
        </button>
        <Menu
          trigger="kebab"
          label={`Más opciones de ${s.name}`}
          align="right"
          groups={[
            {
              options: [
                { id: 'ver', label: 'Ver funciones', icon: <CalendarDays size={15} />, onSelect: onVer },
                {
                  id: 'copiar',
                  label: 'Crear una temporada a partir de esta',
                  hint: 'Copia las funciones con su lugar, cupo y precio',
                  icon: <CopyPlus size={15} />,
                  onSelect: onCopiar,
                },
              ],
            },
            {
              separated: true,
              options: [
                {
                  id: 'usar',
                  label: 'Usar esta temporada',
                  hint: 'Pasa a ser la que muestran Inicio, Rendiciones y Dirección',
                  icon: <Play size={15} />,
                  tone: 'action',
                  disabled: s.is_active,
                  disabledReason: 'Ya es la temporada en curso',
                  onSelect: onUsar,
                },
              ],
            },
          ]}
        />
      </div>
    </article>
  )
}

/** El pop-up de alta, con los dos atajos: copiar la grilla y no mover la actual. */
function NuevaTemporada({
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

export function SeasonsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // ?nueva=1 llega del selector de temporada del detalle: abre el alta sola.
  const [searchParams, setSearchParams] = useSearchParams()
  const pedidaNueva = searchParams.get('nueva') === '1'
  const [creando, setCreando] = useState<{ copiarDe?: SeasonOverview } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['seasons-overview'],
    queryFn: () => api.seasonsOverview(),
  })

  const activar = useMutation({
    mutationFn: (id: number) => api.activateSeason(id),
    onSuccess: () => {
      setError(null)
      for (const key of DEPENDEN_DE_LA_TEMPORADA) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la temporada en curso.'),
  })

  const temporadas = data?.seasons ?? []
  const enCurso = temporadas.find((s) => s.is_active)

  // El parámetro se consume una vez: se limpia de la URL al abrir, así volver
  // atrás no reabre el formulario.
  useEffect(() => {
    if (!pedidaNueva || !data) return
    setCreando({ copiarDe: data.seasons.find((s) => s.is_active) })
    setSearchParams({}, { replace: true })
  }, [pedidaNueva, data, setSearchParams])
  const desde = temporadas.length > 0 ? anio(temporadas[temporadas.length - 1]) : ''

  return (
    <>
      <PageHead
        title="Temporadas"
        sub={
          temporadas.length > 0
            ? `${temporadas.length} ${temporadas.length === 1 ? 'temporada' : 'temporadas'} · desde ${desde}`
            : undefined
        }
        action={{ label: 'Nueva temporada', onClick: () => setCreando({ copiarDe: enCurso }) }}
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {isPending ? (
        <p className="muted">Cargando…</p>
      ) : temporadas.length === 0 ? (
        <EmptyState icon={<CalendarDays size={20} />} title="Todavía no hay ninguna temporada">
          Una temporada agrupa las funciones del año y todo lo que se calcula sobre ellas: lo
          vendido, lo cobrado y lo que cada corista tiene que rendir.
        </EmptyState>
      ) : (
        <>
          <div className="slist">
            {temporadas.map((s) => (
              <Fila
                key={s.id}
                s={s}
                onVer={() => navigate(`/temporadas/${s.id}`)}
                onUsar={() => activar.mutate(s.id)}
                onCopiar={() => setCreando({ copiarDe: s })}
              />
            ))}
          </div>
          <p className="slist__tip">
            Las temporadas cerradas se conservan para consultar su historial de ventas, asistencia
            y rendiciones.
          </p>
        </>
      )}

      {creando && (
        <ActionPanel label="Nueva temporada" size="form" onClose={() => setCreando(null)}>
          <NuevaTemporada
            copiarDe={creando.copiarDe}
            enCurso={enCurso}
            onClose={() => setCreando(null)}
          />
        </ActionPanel>
      )}
    </>
  )
}
