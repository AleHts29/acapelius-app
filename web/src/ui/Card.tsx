import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type CardAction = { label: string; to?: string; onClick?: () => void }

/** Link o botón según lo que traiga la acción. */
export function ActionLink({ action, className }: { action: CardAction; className?: string }) {
  if (action.to) {
    return (
      <Link className={className} to={action.to}>
        {action.label}
      </Link>
    )
  }
  return (
    <button className={className} type="button" onClick={action.onClick}>
      {action.label}
    </button>
  )
}

/**
 * El panel (C19 §4.2). Sin borde ni sombra: se despega del papel por ser
 * blanco. Nada anidado adentro lleva borde propio.
 */
export function Card({
  title,
  action,
  footer,
  children,
}: {
  title?: ReactNode
  action?: CardAction
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card__h">
          {title && <h2 className="card__t">{title}</h2>}
          {action && <ActionLink className="card__a" action={action} />}
        </div>
      )}
      {children}
      {footer && <div className="card__f">{footer}</div>}
    </section>
  )
}
