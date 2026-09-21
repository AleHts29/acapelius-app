import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { activeSeason, api } from '../api/client'
import type { Season } from '../api/client'
import { useSession } from '../auth/session'

/** Dónde queda la última temporada elegida. Es preferencia de UI, no dato. */
const RECUERDO = 'acapelius-temporada'

interface SeasonContextValue {
  /** Todas las temporadas. Vacío mientras carga o para quien no es dirección. */
  seasons: Season[]
  /** La que gobierna toda la app ahora mismo. */
  season: Season | undefined
  seasonId: number | undefined
  /** La temporada en curso, que puede no ser la que se está mirando. */
  current: Season | undefined
  /** true mientras no se sabe cuál es: las pantallas esperan antes de pedir. */
  loading: boolean
  elegir: (id: number) => void
}

const SeasonContext = createContext<SeasonContextValue | null>(null)

/**
 * La temporada que mira toda la app, en un solo lugar (C16 §Fase 2).
 *
 * Antes cada pantalla llamaba a `listSeasons` y guardaba su propia elección:
 * cambiar de temporada en Rendiciones no cambiaba Temporadas, y las cuatro
 * podían estar mirando años distintos a la vez sin que nada lo dijera.
 *
 * La fuente de verdad es `?t=<id>` en la URL —así un link comparte lo que la
 * persona está viendo— con `localStorage` como memoria entre sesiones y la
 * temporada en curso como default.
 *
 * Sólo dirección elige: la corista y la puerta operan siempre sobre la
 * temporada en curso, y para ellas ni se pide la lista.
 */
export function SeasonProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const esAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()

  const { data, isPending } = useQuery({
    queryKey: ['seasons'],
    queryFn: () => api.listSeasons(),
    enabled: user !== null,
  })
  const seasons = useMemo(() => data?.seasons ?? [], [data])
  const current = activeSeason(seasons)

  // El recuerdo sólo se usa hasta que la URL diga otra cosa.
  const [recordada, setRecordada] = useState<number | undefined>(() => {
    const guardada = Number(localStorage.getItem(RECUERDO))
    return Number.isInteger(guardada) && guardada > 0 ? guardada : undefined
  })

  const enURL = Number(searchParams.get('t')) || undefined
  const elegida = esAdmin ? (enURL ?? recordada) : undefined
  // Una temporada que ya no existe (o que no está en la lista) no puede
  // gobernar nada: se cae a la que está en curso.
  const season = seasons.find((s) => s.id === elegida) ?? current

  const elegir = useCallback(
    (id: number) => {
      setRecordada(id)
      try {
        localStorage.setItem(RECUERDO, String(id))
      } catch {
        // Modo privado o storage lleno: la elección vale para esta sesión.
      }
      const next = new URLSearchParams(searchParams)
      // La temporada en curso no ensucia la URL: es el default.
      if (id === current?.id) next.delete('t')
      else next.set('t', String(id))
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams, current?.id],
  )

  // Si se está mirando una temporada distinta de la en curso, la URL lo dice:
  // recargar o compartir el link cae en la misma temporada.
  useEffect(() => {
    if (!esAdmin || season === undefined) return
    if (season.id !== current?.id && enURL !== season.id) {
      const next = new URLSearchParams(searchParams)
      next.set('t', String(season.id))
      setSearchParams(next, { replace: true })
    }
  }, [esAdmin, season, current?.id, enURL, searchParams, setSearchParams])

  const value = useMemo<SeasonContextValue>(
    () => ({
      seasons: esAdmin ? seasons : [],
      season,
      seasonId: season?.id,
      current,
      loading: isPending,
      elegir,
    }),
    [esAdmin, seasons, season, current, isPending, elegir],
  )

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

export function useSeason(): SeasonContextValue {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason tiene que usarse adentro de <SeasonProvider>')
  return ctx
}
