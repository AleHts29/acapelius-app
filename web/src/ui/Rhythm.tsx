// El ritmo de entrada (C19 §4.12): una barra por tramo. Va DENTRO del talón,
// por eso usa los colores `--*-on-black`. El tramo en curso va en naranja y
// los que faltan, apagados. No se anima: con el teatro llenándose, una barra
// que se mueve distrae, y prefers-reduced-motion no tiene nada que apagar.

export function Rhythm({ tramos, ahora, ejes, label }: { tramos: number[]; ahora: number; ejes: string[]; label: string }) {
  const max = Math.max(1, ...tramos)
  return (
    <div>
      <div className="rhythm" role="img" aria-label={label}>
        {tramos.map((n, i) => (
          <b
            key={i}
            className={i === ahora ? 'now' : i > ahora ? 'soft' : undefined}
            style={{ height: i > ahora ? '8%' : `${(n / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="rhythm-x" aria-hidden>
        {ejes.map((e) => (
          <span key={e}>{e}</span>
        ))}
      </div>
    </div>
  )
}
