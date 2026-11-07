/**
 * Achica una foto a un cuadrado de `lado` px (recorte centrado) y la pasa a
 * JPEG. Una foto de celular pesa varios MB; la de perfil, pocos KB.
 */
export async function achicarFoto(archivo: File, lado = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  const corte = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - corte) / 2, (bitmap.height - corte) / 2, corte, corte, 0, 0, lado, lado)
  bitmap.close()
  return new Promise((ok, mal) =>
    canvas.toBlob((blob) => (blob ? ok(blob) : mal(new Error('no se pudo convertir la foto'))), 'image/jpeg', 0.86),
  )
}
