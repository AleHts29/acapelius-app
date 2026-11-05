import type { ReactNode } from 'react'

/**
 * La regla de cifras (C20): una fila de columnas separadas por hairlines,
 * cada una con su etiqueta en mono, su número en Anton y una línea de
 * contexto. Son las cifras de plata de Inicio y Dirección; las funciones van
 * como entradas (C21). En el celular las columnas se apilan de a dos.
 */
export function Rule({ kpis, children }: { kpis?: boolean; children: ReactNode }) {
  const className = ['rule', kpis && 'rule--k'].filter(Boolean).join(' ')
  return <div className={className}>{children}</div>
}

export function RuleCell({
  label,
  value,
  tone,
  sub,
}: {
  label: ReactNode
  value: ReactNode
  tone?: 'ok' | 'warn'
  sub?: ReactNode
}) {
  return (
    <div className="rule__c">
      <span className="rule__d">{label}</span>
      <span className={tone ? `rule__n rule__n--${tone}` : 'rule__n'}>{value}</span>
      {sub && <span className="rule__s">{sub}</span>}
    </div>
  )
}
