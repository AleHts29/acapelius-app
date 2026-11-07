import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** La foto en grande, como al tocar una foto de perfil en WhatsApp. */
export function FotoGrande({ src, nombre, onClose }: { src: string; nombre: string; onClose: () => void }) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onClose])
  return createPortal(
    <div className="foto-grande" role="dialog" aria-modal="true" aria-label={`Foto de ${nombre}`} onClick={onClose}>
      <span className="foto-grande__n">{nombre}</span>
      <button className="foto-grande__x" type="button" aria-label="Cerrar" onClick={onClose}>
        <X size={24} aria-hidden />
      </button>
      <img src={src} alt={`Foto de ${nombre}`} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  )
}
