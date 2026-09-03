import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, activeSeason, api } from '../api/client'
import { Chip } from '../ui/StatusChip'

export function SeasonsPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['seasons'],
    queryFn: () => api.listSeasons(),
  })
  const enCurso = activeSeason(data?.seasons)

  // Cambiar de temporada en curso mueve TODO lo que se calcula por temporada:
  // Inicio, Rendiciones y Dirección. Por eso se invalida cada una.
  function refrescarTemporada() {
    setName('')
    setError(null)
    void queryClient.invalidateQueries({ queryKey: ['seasons'] })
    void queryClient.invalidateQueries({ queryKey: ['settlements-report'] })
    void queryClient.invalidateQueries({ queryKey: ['settlements-history'] })
    void queryClient.invalidateQueries({ queryKey: ['attention'] })
    void queryClient.invalidateQueries({ queryKey: ['functions-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['sales-timeline'] })
  }

  const createSeason = useMutation({
    mutationFn: (seasonName: string) => api.createSeason(seasonName),
    onSuccess: refrescarTemporada,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la temporada.'),
  })

  const activar = useMutation({
    mutationFn: (id: number) => api.activateSeason(id),
    onSuccess: refrescarTemporada,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la temporada en curso.'),
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
        <p className="muted" style={{ fontSize: 10.5, margin: '8px 0 0' }}>
          La temporada nueva pasa a ser la que ves en Inicio, Rendiciones y Dirección. La anterior
          queda guardada y volvés cuando quieras.
        </p>
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
                  <span style={{ fontWeight: 700 }}>
                    {season.name}
                    {season.id === enCurso?.id && (
                      <>
                        {' '}
                        <Chip tone="ok">En curso</Chip>
                      </>
                    )}
                  </span>
                  <span className="muted" aria-hidden>›</span>
                </Link>
                {season.id !== enCurso?.id && (
                  <button
                    className="button button--ghost"
                    style={{ margin: '2px 0 8px' }}
                    type="button"
                    disabled={activar.isPending}
                    onClick={() => activar.mutate(season.id)}
                  >
                    Usar esta temporada
                  </button>
                )}
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
