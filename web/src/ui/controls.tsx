// Controles comunes de la iteracion v2 (C10). Un solo lugar; las pantallas
// los consumen, nunca los duplican.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Search, X } from 'lucide-react'

import { normalizeText } from '../lib/search'

/** Resalta el match de la busqueda dentro de un texto (C3/C6). */
export function Hl({ text, q }: { text: string; q: string }) {
  if (q.trim() === '') return <>{text}</>
  const idx = normalizeText(text).indexOf(normalizeText(q))
  if (idx < 0) return <>{text}</>
  const end = idx + q.trim().length
  return (
    <>
      {text.slice(0, idx)}
      <mark className="hl">{text.slice(idx, end)}</mark>
      {text.slice(end)}
    </>
  )
}

/** FAB: accion principal flotante sobre un listado. */
export function FAB({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button className="fab" type="button" onClick={onClick}>
      <Plus size={16} aria-hidden strokeWidth={2.6} /> {children}
    </button>
  )
}

/** SearchBar con lupa y boton de limpiar. El wrapper sticky lo pone el padre
 * con la clase `.sticky-bar`. */
export function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="searchbar">
      <Search size={15} aria-hidden className="searchbar__icon" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value !== '' && (
        <button className="searchbar__clear" type="button" aria-label="Limpiar búsqueda" onClick={() => onChange('')}>
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}

export interface FilterOption<T extends string> {
  value: T
  label: string
  count?: number
  /** El chip activo usa este tono (default tinta). */
  tone?: 'ink' | 'warn'
}

/** FilterChips single-select con contadores. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="filterchips" role="tablist">
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            className={`fchip${on ? ` fchip--on fchip--${opt.tone ?? 'ink'}` : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
            {opt.count !== undefined && <small> · {opt.count}</small>}
          </button>
        )
      })}
    </div>
  )
}

/** SegmentedToggle de 2-3 opciones (reemplaza los .segmented ad-hoc). */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="tablist" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={opt.value === value ? 'on' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** Stepper compacto con limites y motivo del limite (C8 lo usa con cupos). */
export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  maxReason,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  maxReason?: string
}) {
  const atMax = max !== undefined && value >= max
  return (
    <div>
      <div className="stepper">
        <button type="button" aria-label="Menos" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <b aria-live="polite">{value}</b>
        <button type="button" aria-label="Más" disabled={atMax} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
      {atMax && maxReason && <p className="stepper__reason">{maxReason}</p>}
    </div>
  )
}

/** AlertCard: fila accionable con borde de color por severidad (C9). */
export function AlertCard({
  tone,
  icon,
  title,
  context,
  actionLabel,
  onAction,
}: {
  tone: 'warn' | 'blue' | 'ok'
  icon: ReactNode
  title: string
  context?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const body = (
    <>
      <span className={`alertcard__ic alertcard__ic--${tone}`} aria-hidden>{icon}</span>
      <span className="alertcard__mid">
        <b>{title}</b>
        {context && <span>{context}</span>}
      </span>
      {actionLabel && <span className="alertcard__go">{actionLabel} ›</span>}
    </>
  )
  if (onAction) {
    return (
      <button className={`alertcard alertcard--${tone}`} type="button" onClick={onAction}>
        {body}
      </button>
    )
  }
  return <div className={`alertcard alertcard--${tone}`}>{body}</div>
}

/** ProgressBar simple (venta sobre cupo, rendido sobre cobrado). */
export function ProgressBar({ value, max, tone = 'blue' }: { value: number; max: number; tone?: 'blue' | 'ok' | 'cream' }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  return (
    <div className={`pbar pbar--${tone}`} role="img" aria-label={`${value} de ${max}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

/** StackedBar: segmentos proporcionales (asignadas / vendidas / libres). */
export function StackedBar({
  segments,
  total,
  label,
}: {
  segments: Array<{ value: number; tone: 'blue' | 'ok' | 'warn' | 'line' }>
  total: number
  label: string
}) {
  return (
    <div className="sbar" role="img" aria-label={label}>
      {segments.map((seg, i) => (
        <i
          key={i}
          className={`sbar__seg sbar__seg--${seg.tone}`}
          style={{ width: total > 0 ? `${(seg.value / total) * 100}%` : 0 }}
        />
      ))}
    </div>
  )
}

/** LiveDot: punto "EN VIVO" que pulsa durante el polling. */
export function LiveDot({ label = 'En vivo' }: { label?: string }) {
  return (
    <span className="livedot">
      <i aria-hidden />
      {label}
    </span>
  )
}

/** EmptyState positivo. */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__ic" aria-hidden>{icon}</span>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  )
}

/** Hook utilitario: true mientras el usuario no scrolleo (para sombras sticky). */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}
