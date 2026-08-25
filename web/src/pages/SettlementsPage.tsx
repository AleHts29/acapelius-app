import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { PaymentMethod, SettlementReportRow } from '../api/client'
import { formatDateTime, formatMoney, pesosToCents } from '../lib/format'

function SettlementForm({
  row,
  seasonId,
  onDone,
}: {
  row: SettlementReportRow
  seasonId: number
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (amountCents: number) =>
      api.createSettlement({
        seller_id: row.seller_id,
        season_id: seasonId,
        amount_cents: amountCents,
        method,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlements-report', seasonId] })
      onDone()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la rendicion.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const cents = pesosToCents(amount)
    if (cents === null || cents === 0) {
      setError('El monto no es valido. Ejemplo: 30000 o 30000,50.')
      return
    }
    create.mutate(cents)
  }

  return (
    <form onSubmit={handleSubmit} className="settlement-form">
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Monto ($)</span>
          <input
            className="field__input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(Math.max(row.balance_cents, 0) / 100)}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field__label">Metodo</span>
          <select
            className="field__input"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field__label">Nota (opcional)</span>
        <input
          className="field__input"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Despues del ensayo"
        />
      </label>
      <div className="form-row">
        <button className="button" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Registrando...' : 'Registrar rendicion'}
        </button>
        <button className="button button--ghost form-row__action" type="button" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export function SettlementsPage() {
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [openForm, setOpenForm] = useState<number | null>(null)

  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  // Sin eleccion explicita, la temporada mas nueva.
  const effectiveSeasonId = seasonId ?? seasons.data?.seasons[0]?.id ?? null

  const report = useQuery({
    queryKey: ['settlements-report', effectiveSeasonId],
    queryFn: () => api.settlementsReport(effectiveSeasonId!),
    enabled: effectiveSeasonId !== null,
  })

  return (
    <>
      <h1 className="page-title">Rendiciones</h1>

      {seasons.data && seasons.data.seasons.length > 1 && (
        <label className="field">
          <span className="field__label">Temporada</span>
          <select
            className="field__input"
            value={effectiveSeasonId ?? ''}
            onChange={(e) => setSeasonId(Number(e.target.value))}
          >
            {seasons.data.seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {report.isPending ? (
        <p className="muted">Cargando...</p>
      ) : !report.data || report.data.rows.length === 0 ? (
        <p className="muted">No hay movimientos en esta temporada.</p>
      ) : (
        <>
          <div className="stack">
            {report.data.rows.map((row) => (
              <div key={row.seller_id} className="panel">
                <div className="function-card__head">
                  <h3 className="function-card__title">{row.seller_name}</h3>
                  <span
                    className={`settlement-balance${row.balance_cents > 0 ? ' settlement-balance--owes' : ''}`}
                  >
                    {row.balance_cents > 0
                      ? `Debe ${formatMoney(row.balance_cents)}`
                      : row.balance_cents < 0
                        ? `A favor ${formatMoney(-row.balance_cents)}`
                        : 'Al dia'}
                  </span>
                </div>
                <p className="muted function-card__line">
                  Cobro {formatMoney(row.collected_cents)} · rindio {formatMoney(row.settled_cents)}
                  {row.pending_cents > 0 && <> · por cobrar {formatMoney(row.pending_cents)}</>}
                </p>

                {openForm === row.seller_id ? (
                  <SettlementForm
                    row={row}
                    seasonId={effectiveSeasonId!}
                    onDone={() => setOpenForm(null)}
                  />
                ) : (
                  (row.balance_cents !== 0 || row.collected_cents > 0) && (
                    <button
                      className="button button--ghost"
                      style={{ marginTop: '0.6rem' }}
                      type="button"
                      onClick={() => setOpenForm(row.seller_id)}
                    >
                      Registrar rendicion
                    </button>
                  )
                )}
              </div>
            ))}
          </div>

          {report.data.settlements.length > 0 && (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <p className="panel__label">Historial</p>
              <ul className="list">
                {report.data.settlements.map((settlement) => (
                  <li key={settlement.id} className="list__item list__item--static">
                    <span>
                      {settlement.seller_name} rindio{' '}
                      <strong>{formatMoney(settlement.amount_cents)}</strong>{' '}
                      {settlement.method === 'cash' ? 'en efectivo' : 'por transferencia'}
                      {settlement.notes && (
                        <>
                          <br />
                          <span className="muted" style={{ fontSize: '0.85rem' }}>
                            {settlement.notes}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="muted" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                      {formatDateTime(settlement.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}
