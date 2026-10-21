import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { SeasonOverview } from '../api/client'
import { calendarDaysUntil, dayAndMonthShort, formatMoney } from '../lib/format'
import { DEPENDEN_DE_LA_TEMPORADA, NuevaTemporada } from '../season/NuevaTemporada'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Figure } from '../ui/Figure'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { FnTile } from '../ui/Tile'

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

function SeasonTile({ s, onClick }: { s: SeasonOverview; onClick: () => void }) {
  const cerrada = estado(s) === 'cerrada'
  const ocupacion = s.capacity > 0 ? Math.round((s.sold / s.capacity) * 100) : 0
  const libres = Math.max(s.capacity - s.assigned, 0)
  return (
    <FnTile
      label={`${anio(s)} · ${estado(s)}`}
      date={s.name}
      venue={rango(s)}
      bar={{ value: s.sold, max: s.capacity, tone: cerrada ? 'ok' : undefined }}
      quantity={
        <>
          {s.sold} <em>de {s.capacity} vendidas</em>
        </>
      }
      aside={<span className="rs">{formatMoney(s.collected_cents)}</span>}
      footer={
        <>
          <span className="rs">{contexto(s)}</span>
          {/* Mientras se puede vender, lo que importa es lo que falta repartir;
              en una cerrada, cómo terminó. */}
          <span className="rs">{cerrada ? `${ocupacion}%` : libres > 0 ? `${libres} sin repartir` : ''}</span>
        </>
      }
      on={s.is_active}
      off={cerrada}
      onClick={onClick}
    />
  )
}

function SeasonModal({
  s,
  onClose,
  onVer,
  onUsar,
  onCopiar,
}: {
  s: SeasonOverview
  onClose: () => void
  onVer: () => void
  onUsar: () => void
  onCopiar: () => void
}) {
  return (
    <Modal
      open
      onClose={onClose}
      label={`Temporada · ${estado(s)}`}
      title={s.name}
      sub={`${rango(s)} · ${contexto(s)}`}
      footer={
        <>
          <Button onClick={onCopiar}>Crear otra a partir de esta</Button>
          {!s.is_active && <Button onClick={onUsar}>Usar esta temporada</Button>}
          <Button go onClick={onVer}>
            Ver funciones
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap' }}>
        <Figure label="Vendidas" unit={`/ ${s.capacity}`}>
          {s.sold}
        </Figure>
        <Figure label="Recaudado" tone="ok">
          {formatMoney(s.collected_cents)}
        </Figure>
      </div>
      <DataList
        rows={[
          ['Funciones', String(s.functions)],
          ['Coristas que vendieron', String(s.sellers)],
          ['Cupo repartido', `${s.assigned} de ${s.capacity}`],
        ]}
      />
      {!s.is_active && (
        <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
          Usarla la vuelve la temporada que muestran Inicio, Rendiciones y Dirección.
        </p>
      )}
    </Modal>
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
  const [abierta, setAbierta] = useState<SeasonOverview | null>(null)
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
      <PageHeader
        title="Temporadas"
        label={
          temporadas.length > 0
            ? `${temporadas.length} ${temporadas.length === 1 ? 'temporada' : 'temporadas'} · desde ${desde}`
            : undefined
        }
        actions={
          <Button go onClick={() => setCreando({ copiarDe: enCurso })}>
            Nueva temporada
          </Button>
        }
      />

      {error && (
        <p className="st st--bad" role="alert">
          {error}
        </p>
      )}

      {isPending ? (
        <p className="rs">Cargando…</p>
      ) : temporadas.length === 0 ? (
        <Card title="Todavía no hay ninguna temporada">
          <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            Una temporada agrupa las funciones del año y todo lo que se calcula sobre ellas: lo
            vendido, lo cobrado y lo que cada corista tiene que rendir.
          </p>
        </Card>
      ) : (
        <section className="grp">
          <div className="grp__h">
            <h2 className="lbl">Todas</h2>
            <span className="grp__n">{temporadas.length}</span>
          </div>
          <div className="tiles tiles--3">
            {temporadas.map((s) => (
              <SeasonTile key={s.id} s={s} onClick={() => setAbierta(s)} />
            ))}
          </div>
          <p className="rs" style={{ whiteSpace: 'normal', marginTop: 'var(--s2)' }}>
            Las temporadas cerradas se conservan para consultar su historial de ventas, asistencia
            y rendiciones.
          </p>
        </section>
      )}

      {abierta && (
        <SeasonModal
          s={abierta}
          onClose={() => setAbierta(null)}
          onVer={() => navigate(`/temporadas/${abierta.id}`)}
          onUsar={() => {
            activar.mutate(abierta.id)
            setAbierta(null)
          }}
          onCopiar={() => {
            setAbierta(null)
            setCreando({ copiarDe: abierta })
          }}
        />
      )}

      {creando && <NuevaTemporada copiarDe={creando.copiarDe} enCurso={enCurso} onClose={() => setCreando(null)} />}
    </>
  )
}
