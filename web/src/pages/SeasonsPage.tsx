import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CopyPlus, Play } from 'lucide-react'

import { ApiError, api } from '../api/client'
import type { SeasonOverview } from '../api/client'
import { calendarDaysUntil, dayAndMonthShort, formatMoney } from '../lib/format'
import { ActionPanel } from '../ui/ActionPanel'
import { DEPENDEN_DE_LA_TEMPORADA, NuevaTemporada } from '../season/NuevaTemporada'
import { Menu } from '../ui/Menu'
import { EmptyState, PageHead, ProgressBar } from '../ui/controls'

/** Las claves que hay que refrescar cuando cambia cuál es la temporada en curso. */

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
