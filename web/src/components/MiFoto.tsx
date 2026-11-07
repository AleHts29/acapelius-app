import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import { achicarFoto } from '../lib/foto'

/**
 * Cambiar o sacar la foto de perfil propia (C21). La foto se achica en el
 * teléfono antes de subirla.
 */
export function MiFoto({
  tieneFoto,
  className = 'btn btn--w',
  trigger,
}: {
  tieneFoto: boolean
  className?: string
  /** Si viene, es lo que se toca para cambiarla (la lateral usa la cara misma). */
  trigger?: ReactNode
}) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['me'] })
    void queryClient.invalidateQueries({ queryKey: ['team'] })
  }
  const subir = useMutation({
    meta: { exito: 'Foto actualizada' },
    mutationFn: async (archivo: File) => api.uploadAvatar(await achicarFoto(archivo)),
    onSuccess: () => {
      setError(null)
      refrescar()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo usar esa foto.'),
  })
  const sacar = useMutation({
    meta: { exito: 'Foto sacada' },
    mutationFn: () => api.deleteAvatar(),
    onSuccess: refrescar,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo sacar la foto.'),
  })

  return (
    <div className={trigger ? 'mifoto mifoto--cara' : 'mifoto'}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) subir.mutate(archivo)
        }}
      />
      <button
        className={className}
        type="button"
        disabled={subir.isPending}
        onClick={() => input.current?.click()}
        title={trigger ? (tieneFoto ? 'Cambiar foto' : 'Poner foto') : undefined}
        aria-label={trigger ? (tieneFoto ? 'Cambiar foto' : 'Poner foto') : undefined}
      >
        {trigger ?? (subir.isPending ? 'Subiendo…' : tieneFoto ? 'Cambiar foto' : 'Poner foto')}
      </button>
      {tieneFoto && !trigger && (
        <button className="mifoto__sacar" type="button" disabled={sacar.isPending} onClick={() => sacar.mutate()}>
          Sacar foto
        </button>
      )}
      {error && !trigger && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
