# Pendientes

Lo que falta hacer, ordenado por lo que más duele. Cada ítem dice qué pasa, dónde
está y cuándo se considera terminado.

Lo que ya se hizo y por qué se decidió así vive en [DECISIONS.md](DECISIONS.md);
el paquete de cambios v2 (C1–C10), en [docs/CAMBIOS_V2.md](docs/CAMBIOS_V2.md).

---

## P2 · Dirección no muestra los ingresos el día de la función

**Qué pasa.** La mini-card de función muestra "N ingresaron" sólo si la función
ya pasó, y "N sin asignar" sólo si es futura. Justo el día de la función —cuando
la puerta está trabajando y es lo que más se mira— no muestra ninguna de las dos.
Asistencia sí ve los ingresos en vivo.

**Dónde.** `web/src/pages/DireccionPage.tsx:88-95`.

**Terminado cuando.** Una función de hoy muestra el ingreso en vivo, con el mismo
tratamiento que usa Asistencia.

---

## P3 · "Editar" aparece en funciones que no se pueden editar

**Qué pasa.** Una función con ingresos registrados no se puede editar (409 del
backend, correcto: cambiar fecha o cupo a esa altura sólo genera lío en la
puerta). Pero el botón "Editar" está igual, y el error aparece recién al guardar,
con el formulario ya completado.

**Dónde.** `internal/http/handlers_functions.go:126-133` (la regla) y
`web/src/pages/SeasonDetailPage.tsx` (la tarjeta).

**Terminado cuando.** Una función con ingresos no ofrece editar, y dice por qué
en una línea.

---

## P4 · Las páginas públicas de entradas piden sesión

**Qué pasa.** `/e/{code}` y `/t/{code}` son públicas, pero el `SessionProvider`
envuelve todo y dispara `GET /api/me`, que responde 401. Al comprador le suma una
request inútil y un error en la consola.

**Dónde.** `web/src/App.tsx` (las rutas públicas van antes del gate, pero el
provider está por encima) y `web/src/auth/session.tsx`.

**Terminado cuando.** Abrir una entrada pública no dispara ninguna llamada
autenticada.

---

## P5 · `/dev/ui` llega a producción

**Qué pasa.** La galería interna de componentes (C10) es una ruta real en el
build de producción. Sólo la ve dirección y no toca datos, pero no tiene por qué
estar.

**Dónde.** `web/src/pages/DevUIPage.tsx`, ruta en `web/src/App.tsx`.

**Terminado cuando.** La ruta existe en desarrollo y no en el build de
producción.

---

## P6 · Emojis sueltos contra la decisión de iconos

**Qué pasa.** La regla es lucide en todos lados; los emojis de los mockups eran
placeholders. Quedaron 📧 en `NewSalePage.tsx:132` y 🔍 🎭 en
`AttendancePage.tsx:243,247`.

**Terminado cuando.** No queda ningún emoji decorativo en `web/src` (los ✓/✕ del
modo puerta y el ♪ del hero son tipografía, no emoji: esos se quedan).

---

## P7 · Config as Code de Railway, deprecado

**Qué pasa.** Cada deploy avisa que `railway.json` deja de funcionar el
**2026-12-01** y hay que migrar a `.railway/railway.ts`.

**Terminado cuando.** `railway config migrate` corrido, el archivo nuevo
commiteado y un deploy verde con él.

---

## P8 · Confirmar los backups de producción

**Qué pasa.** `docs/operations.md` explica que Railway hace backups automáticos
**en el plan pago** y recomienda además un dump lógico propio. Falta confirmar
que estén efectivamente activos en este proyecto y hacer un restore de prueba:
el backup que no se probó restaurar no existe.

**Terminado cuando.** Backups confirmados en el panel de Railway y un restore de
prueba hecho al menos una vez.
