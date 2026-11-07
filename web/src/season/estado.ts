import type { SeasonOverview } from '../api/client'

export type EstadoTemporada = 'en curso' | 'preparándose' | 'terminada'

/**
 * El estado de una temporada sale de las fechas, no de la marca de activa.
 * La activa es "la que muestra la app" y la elige dirección; que esté en curso
 * depende de que le quede alguna función por delante. Una activa con todas sus
 * funciones pasadas está terminada, aunque siga siendo la que se muestra; una
 * sin funciones todavía se está preparando, sea o no la activa.
 */
export function estadoTemporada(s: Pick<SeasonOverview, 'is_active' | 'functions' | 'next_at'>): EstadoTemporada {
  if (s.functions === 0) return 'preparándose'
  if (!s.next_at) return 'terminada'
  return s.is_active ? 'en curso' : 'preparándose'
}

export const ESTADO_TEXTO: Record<EstadoTemporada, string> = {
  'en curso': 'En curso',
  preparándose: 'Preparándose',
  terminada: 'Terminada',
}
