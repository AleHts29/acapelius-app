import { useState } from 'react'

import { avatarURL } from '../api/client'
import { initials } from '../lib/search'
import { FotoGrande } from './FotoGrande'

/**
 * La foto grande de una persona arriba de su ficha. Tocándola se ve en grande,
 * como en WhatsApp. Sin foto, las iniciales.
 */
export function CaraPersona({ userId, name, avatarAt }: { userId: number; name: string; avatarAt?: string | null }) {
  const [viendo, setViendo] = useState(false)
  const foto = avatarAt ? avatarURL(userId, avatarAt) : null
  return (
    <div className="cara-persona">
      <button
        type="button"
        className={`perfil__foto cara-persona__foto${foto ? ' perfil__foto--ver' : ''}`}
        onClick={() => foto && setViendo(true)}
        disabled={!foto}
        aria-label={foto ? `Ver la foto de ${name}` : undefined}
      >
        {foto ? <img src={foto} alt="" /> : initials(name)}
      </button>
      {viendo && foto && <FotoGrande src={foto} nombre={name} onClose={() => setViendo(false)} />}
    </div>
  )
}
