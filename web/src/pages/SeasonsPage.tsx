import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'

export function SeasonsPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['seasons'],
    queryFn: () => api.listSeasons(),
  })

  const createSeason = useMutation({
    mutationFn: (seasonName: string) => api.createSeason(seasonName),
    onSuccess: () => {
      setName('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['seasons'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la temporada.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setError('Poné un nombre, por ejemplo "Temporada 2026".')
      return
    }
    createSeason.mutate(name.trim())
  }

  return (
    <>
      <h1 className="page-title">Temporadas</h1>

      <form className="panel" onSubmit={handleSubmit}>
        <p className="panel__label">Nueva temporada</p>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="form-row">
          <input
            className="field__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Temporada 2026"
            aria-label="Nombre de la temporada"
          />
          <button className="button form-row__action" type="submit" disabled={createSeason.isPending}>
            Crear
          </button>
        </div>
      </form>

      <div className="panel">
        <p className="panel__label">Existentes</p>
        {isPending ? (
          <p className="muted">Cargando…</p>
        ) : data && data.seasons.length > 0 ? (
          <ul className="list">
            {data.seasons.map((season) => (
              <li key={season.id}>
                <Link className="list__item" to={`/temporadas/${season.id}`}>
                  <span style={{ fontWeight: 700 }}>{season.name}</span>
                  <span className="muted" aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Todavía no hay temporadas.</p>
        )}
      </div>
    </>
  )
}
