import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { useIsDesktop } from '../lib/viewport'
import { NewSalePage } from '../pages/NewSalePage'
import { ActionPanel } from './ActionPanel'

/**
 * "Nueva venta", en un solo lugar. En escritorio se resuelve encima de lo que
 * estabas mirando y al cerrar seguís ahí; en celular es su propia pantalla,
 * que ahí es lo cómodo. Lo usan Inicio y Ventas: si cada una decidiera por su
 * cuenta, el mismo botón se comportaría distinto según de dónde salió.
 */
export function useNuevaVenta(): { abrir: () => void; panel: ReactNode } {
  const navigate = useNavigate()
  const escritorio = useIsDesktop()
  const [abierta, setAbierta] = useState(false)

  const abrir = () => {
    if (escritorio) setAbierta(true)
    else navigate('/ventas/nueva')
  }

  const panel = abierta ? (
    <ActionPanel label="Nueva venta" size="form" onClose={() => setAbierta(false)}>
      <NewSalePage onDone={() => setAbierta(false)} />
    </ActionPanel>
  ) : null

  return { abrir, panel }
}
