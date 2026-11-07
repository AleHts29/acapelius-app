import { useState } from 'react'

import { avatarURL } from '../api/client'
import { initials } from '../lib/search'

/**
 * La cara de una persona: su foto si subió una, si no sus iniciales. Si la
 * foto no carga, también vuelven las iniciales.
 */
export function Avatar({
  userId,
  name,
  avatarAt,
  className = 'avatar',
}: {
  userId: number
  name: string
  avatarAt?: string | null
  className?: string
}) {
  const [fallo, setFallo] = useState<string | null>(null)
  const conFoto = avatarAt && fallo !== avatarAt
  return (
    <span className={`${className}${conFoto ? ' con-foto' : ''}`} aria-hidden>
      {conFoto ? <img src={avatarURL(userId, avatarAt)} alt="" onError={() => setFallo(avatarAt)} /> : initials(name)}
    </span>
  )
}
