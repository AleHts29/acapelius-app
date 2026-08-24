import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// El binario Go embebe web/dist con `//go:embed all:dist`, que no compila si el
// directorio no existe. `vite build` lo vacia entero, asi que hay que reponer
// el archivo que lo mantiene versionado.
function keepDistTracked(): Plugin {
  return {
    name: 'acapelius:keep-dist-tracked',
    closeBundle() {
      writeFileSync(resolve(import.meta.dirname, 'dist/.gitkeep'), '')
    },
  }
}

// Vite sirve el frontend en 5173 y proxea la API y las entradas publicas al
// backend Go, para que las cookies de sesion viajen con el mismo origen.
// El Makefile pasa VITE_API_TARGET tomando PORT de .env.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8081'

export default defineConfig({
  plugins: [react(), keepDistTracked()],
  server: {
    port: 5173,
    // El escaneo de QR necesita getUserMedia, que exige HTTPS salvo en
    // localhost. Para probar desde el celular hace falta un tunel (ver README).
    host: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/e': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
