/**
 * Reparte el cupo de una función por igual. Cada corista arranca de lo que ya
 * vendió, porque un cupo no baja de eso, y las entradas van de a una a quien
 * tenga menos. En un empate gana la primera de la lista.
 */
export function repartirPorIgual(capacity: number, vendidas: number[]): number[] {
  const cupos = [...vendidas]
  if (cupos.length === 0) return cupos
  let quedan = capacity - cupos.reduce((acc, n) => acc + n, 0)
  while (quedan > 0) {
    cupos[cupos.indexOf(Math.min(...cupos))]++
    quedan--
  }
  return cupos
}
