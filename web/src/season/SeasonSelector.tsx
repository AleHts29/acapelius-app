import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutList, Plus } from 'lucide-react'

import { api } from '../api/client'
import { Menu } from '../ui/Menu'
import { NuevaTemporadaPanel } from './NuevaTemporada'
import { useSeason } from './SeasonProvider'

/**
 * El selector de temporada de toda la app (C16 §Fase 2). Vive arriba de la
 * navegación —no adentro de una pantalla— porque es contexto: cambia lo que
 * muestran Ventas, Temporada, Plata y Equipo a la vez.
 *
 * Sólo lo ve dirección. La corista y la puerta operan siempre sobre la
 * temporada en curso: elegir otra no les cambiaría nada que puedan hacer.
 */
export function SeasonSelector() {
  const navigate = useNavigate()
  const { seasons, season, current, elegir } = useSeason()
  const [creando, setCreando] = useState(false)

  // El contexto de cada opción: cuántas funciones tiene y si está en curso.
  const overview = useQuery({
    queryKey: ['seasons-overview'],
    queryFn: () => api.seasonsOverview(),
    enabled: seasons.length > 0,
  })

  if (seasons.length === 0 || season === undefined) return null

  const detalle = (id: number) => {
    const s = overview.data?.seasons.find((x) => x.id === id)
    if (!s) return id === current?.id ? 'En curso' : undefined
    const funciones = `${s.functions} ${s.functions === 1 ? 'función' : 'funciones'}`
    return s.is_active ? `En curso · ${funciones}` : `Cerrada · ${funciones}`
  }

  return (
    <>
      <div className="seasonsel">
        <Menu
          trigger="pill"
          ariaLabel="Temporada"
          label={season.name}
          value={String(season.id)}
          groups={[
            {
              label: 'Temporadas',
              options: seasons.map((s) => ({
                id: String(s.id),
                label: s.name,
                hint: detalle(s.id),
                onSelect: () => elegir(s.id),
              })),
            },
            {
              separated: true,
              options: [
                {
                  id: 'nueva',
                  label: 'Crear temporada…',
                  icon: <Plus size={15} />,
                  tone: 'action',
                  onSelect: () => setCreando(true),
                },
                {
                  id: 'todas',
                  label: 'Ver todas las temporadas',
                  icon: <LayoutList size={15} />,
                  onSelect: () => navigate('/temporadas'),
                },
              ],
            },
          ]}
        />
        {/* Que la elegida no sea la en curso tiene que verse siempre, no sólo
            al abrir el menú: es la diferencia entre mirar el año pasado y
            creer que estás mirando el de ahora. */}
        {season.id === current?.id ? (
          <span className="seasonsel__dot seasonsel__dot--on" title="Temporada en curso" />
        ) : (
          <span className="seasonsel__tag">Cerrada</span>
        )}
      </div>

      {creando && <NuevaTemporadaPanel onClose={() => setCreando(false)} />}
    </>
  )
}
