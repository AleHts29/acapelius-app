// Clases muertas de styles.css (C19 §8.1): las que están definidas y no
// aparecen en ningún .ts/.tsx. Uso: `npm run css:dead` (sale con 1 si hay).
//
// A diferencia del grep del spec, reconoce las clases armadas con template
// literal (`chip--${tone}`): todo lo que empiece con ese prefijo cuenta como
// usado. Sin eso, cada modificador de tono aparece como muerto aunque no lo sea.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(import.meta.dirname, '../src')

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'public' ? [] : archivos(p)
    return /\.tsx?$/.test(n) ? [p] : []
  })
}

const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{[^{}]*\}/g, '{}') // fuera las declaraciones: sólo selectores

const definidas = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))]
const codigo = archivos(SRC).map((f) => readFileSync(f, 'utf8')).join('\n')
const prefijos = [...codigo.matchAll(/([a-zA-Z][\w-]*(?:--|__|-))\$\{/g)].map((m) => m[1])

const usada = (c) =>
  new RegExp(`(?<![\\w-])${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(codigo) ||
  prefijos.some((p) => c.startsWith(p))

const muertas = definidas.filter((c) => !usada(c)).sort()
for (const c of muertas) console.log(c)
console.error(`${muertas.length} clases muertas de ${definidas.length} definidas`)
process.exit(muertas.length ? 1 : 0)
