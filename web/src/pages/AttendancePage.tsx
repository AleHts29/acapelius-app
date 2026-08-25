import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import { Chip } from '../ui/StatusChip'

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function AttendancePage() {
  const [functionId, setFunctionId] = useState<number | null>(null)

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })
  // Sin eleccion, la funcion mas cercana a ahora (pasada o no): la de "anoche"
  // o la de hoy es lo que Eli quiere mirar.
  const effectiveFunctionId =
    functionId ??
    (functions.data && functions.data.functions.length > 0
      ? [...functions.data.functions].sort(
          (a, b) =>
            Math.abs(new Date(a.starts_at).getTime() - Date.now()) -
            Math.abs(new Date(b.starts_at).getTime() - Date.now()),
        )[0].id
      : null)

  const report = useQuery({
    queryKey: ['attendance', effectiveFunctionId],
    queryFn: () => api.attendanceReport(effectiveFunctionId!),
    enabled: effectiveFunctionId !== null,
    // "En tiempo real" con polling alcanza (spec §11: sin websockets).
    refetchInterval: 15_000,
  })

  return (
    <>
      <h1 className="page-title">Asistencia</h1>

      {functions.data && functions.data.functions.length > 1 && (
        <label className="field">
          <span className="field__label">Función</span>
          <select
            className="field__input"
            value={effectiveFunctionId ?? ''}
            onChange={(e) => setFunctionId(Number(e.target.value))}
          >
            {functions.data.functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {formatDateTime(fn.starts_at)} — {fn.name ?? fn.venue}
              </option>
            ))}
          </select>
        </label>
      )}

      {report.isPending ? (
        <p className="muted">Cargando…</p>
      ) : report.data ? (
        <>
          <div className="kpis" aria-live="polite">
            <div className="kpi">
              <b className="g">{report.data.entered} / {report.data.issued}</b>
              <span>Ingresaron</span>
            </div>
            <div className="kpi">
              <b>{report.data.issued - report.data.entered}</b>
              <span>Faltan entrar · se actualiza solo</span>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel__label">Quién entró</p>
            {report.data.entries.length === 0 ? (
              <p className="muted">Todavía no entró nadie.</p>
            ) : (
              <ul className="list">
                {report.data.entries.map((entry, i) => (
                  <li key={i} className="list__item list__item--static">
                    <span>
                      {entry.buyer_name}
                      {entry.is_comp && (
                        <span style={{ marginLeft: 8 }}>
                          <Chip tone="blue">Cortesía</Chip>
                        </span>
                      )}
                      <br />
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        le vendió {entry.seller_name} ·{' '}
                        {entry.method === 'scan' ? 'escaneado' : 'manual'} por {entry.by_name}
                      </span>
                    </span>
                    <span className="attendance-time">{timeOf(entry.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="muted">No hay funciones cargadas.</p>
      )}
    </>
  )
}
