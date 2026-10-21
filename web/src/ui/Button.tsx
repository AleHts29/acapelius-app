import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

/**
 * Botón (C19 §4.7). `go` es LA acción de la pantalla: uno solo por pantalla.
 * `wide` es el de ancho completo del celular.
 */
export function Button({
  go,
  wide,
  to,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { go?: boolean; wide?: boolean; to?: string }) {
  const cls = ['btn', go && 'btn--go', wide && 'btn--w', className].filter(Boolean).join(' ')
  if (to) {
    return (
      <Link className={cls} to={to}>
        {rest.children}
      </Link>
    )
  }
  return <button className={cls} type={type} {...rest} />
}

/** El buscador. `aria-label` es obligatorio: el placeholder no es etiqueta. */
export function Search(props: InputHTMLAttributes<HTMLInputElement> & { 'aria-label': string }) {
  return <input className="search" type="search" {...props} />
}

/**
 * El segmented control: reemplaza a los chips de filtro sueltos. Es un grupo
 * de opciones exclusivas, así que se anuncia como radiogroup.
 */
export function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : undefined}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
