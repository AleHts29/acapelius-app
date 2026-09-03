import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { User } from '../api/client'

interface Session {
  user: User | null
  loading: boolean
  /** El usuario entro pero todavia usa la contrasena provisoria. */
  mustChangePassword: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

const meQueryKey = ['me'] as const

/**
 * Las páginas de entrada son públicas: alguien abre el link que le llegó por
 * email y no tiene ni tiene por qué tener sesión. Preguntar quién es ahí sólo
 * suma una request que termina en 401. Se mira `location` directo y no el
 * router porque el provider está por encima de él; y una entrada pública se
 * abre siempre como carga nueva, nunca navegando dentro de la app.
 */
function enPaginaPublica(): boolean {
  return /^\/(e|t)\//.test(window.location.pathname)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const publica = enPaginaPublica()

  const { data, isPending } = useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return (await api.me()).user
      } catch (error) {
        // No estar logueado es un estado normal al abrir la app, no un fallo.
        if (error instanceof ApiError && error.isUnauthenticated) return null
        throw error
      }
    },
    // La sesion vive en una cookie; no tiene sentido reintentar un 401.
    retry: false,
    staleTime: 60_000,
    enabled: !publica,
  })

  const setUser = useCallback(
    (user: User | null) => queryClient.setQueryData(meQueryKey, user),
    [queryClient],
  )

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: ({ user }) => setUser(user),
  })

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      setUser(null)
      // Se tira todo lo cacheado: puede tener datos del usuario anterior.
      queryClient.clear()
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      api.changePassword(current, next),
    onSuccess: ({ user }) => setUser(user),
  })

  const value = useMemo<Session>(
    () => ({
      user: data ?? null,
      // Sin consulta no hay carga: en una página pública la sesión ya está
      // resuelta (no hay), y dejar `loading` en true colgaría a quien la lea.
      loading: publica ? false : isPending,
      mustChangePassword: data?.must_change_password ?? false,
      login: async (email, password) => {
        await loginMutation.mutateAsync({ email, password })
      },
      logout: async () => {
        await logoutMutation.mutateAsync()
      },
      changePassword: async (current, next) => {
        await changePasswordMutation.mutateAsync({ current, next })
      },
    }),
    [data, isPending, publica, loginMutation, logoutMutation, changePasswordMutation],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession tiene que usarse adentro de <SessionProvider>')
  }
  return session
}
