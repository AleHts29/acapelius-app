import type { ReactNode } from 'react'

/** La lista de datos (C19 §4.11): vive dentro del popup, la hoja y el drawer. */
export function DataList({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="dl">
      {rows.map(([k, v], i) => (
        <div className="dl__r" key={i}>
          <dt className="dl__k">{k}</dt>
          <dd className="dl__v">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
