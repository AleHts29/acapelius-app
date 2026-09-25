// Vocabulario por tipo de organización (C17 §A.3). Los roles del modelo no
// cambian (admin, seller, door): cambian las etiquetas. Un coro tiene
// coristas; un grupo de teatro, integrantes de un elenco.
//
// Regla: ningún componente nuevo escribe "corista" a mano; lee `useTerms()`.

import { useSession } from './session'
import type { OrganizationKind } from '../api/client'

export interface Terms {
  /** corista / integrante */
  member: string
  /** coristas / integrantes */
  members: string
  /** el coro / el elenco / el equipo */
  cast: string
  /** lugar / sala */
  venue: string
}

const DICCIONARIO: Record<OrganizationKind, Terms> = {
  choir: { member: 'corista', members: 'coristas', cast: 'el coro', venue: 'lugar' },
  theatre: { member: 'integrante', members: 'integrantes', cast: 'el elenco', venue: 'sala' },
  other: { member: 'integrante', members: 'integrantes', cast: 'el equipo', venue: 'lugar' },
}

/** Las palabras para un tipo dado. Para código fuera de React (mails, tests). */
export function termsFor(kind: OrganizationKind | undefined): Terms {
  return DICCIONARIO[kind ?? 'choir']
}

/** Las palabras de la organización de la sesión. Sin sesión, las del coro. */
export function useTerms(): Terms {
  const { user } = useSession()
  return termsFor(user?.organization_kind)
}
