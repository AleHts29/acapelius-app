# Pendientes

Lo que falta hacer, ordenado por lo que más duele. Cada ítem dice qué pasa, dónde
está y cuándo se considera terminado.

Lo que ya se hizo y por qué se decidió así vive en [DECISIONS.md](DECISIONS.md);
el paquete de cambios v2 (C1–C10), en [docs/CAMBIOS_V2.md](docs/CAMBIOS_V2.md).

---

## P1 · Config as Code de Railway, deprecado

**Qué pasa.** Cada deploy avisa que `railway.json` deja de funcionar el
**2026-12-01** y hay que migrar a `.railway/railway.ts`.

**Por qué no se hizo todavía.** Se corrió `railway config migrate` en seco y el
archivo que genera **pierde cosas**: deja el builder y el `dockerfilePath` como
comentarios, y descarta `restartPolicyType` y `restartPolicyMaxRetries`. Además
`--apply` toca el proyecto vivo (borra la opción "Railway Config File") y el
archivo declara el proyecto entero con `resources: [web]` — sin el servicio de
Postgres. Aplicar eso sin entender qué hace `railway config apply` con un
recurso que no está declarado es la clase de cosa que puede llevarse la base.

**Terminado cuando.** El archivo nuevo reproduce lo que hoy dice `railway.json`
—builder Dockerfile, healthcheck, política de reinicio— y **declara también el
Postgres**; `railway config plan` muestra que no borra nada; y hay un deploy
verde con él. Hay tiempo hasta diciembre: no conviene apurarlo.

---

## P2 · Confirmar los backups de producción

**Qué pasa.** `docs/operations.md` explica que Railway hace backups automáticos
**en el plan pago** y recomienda además un dump lógico propio. Falta confirmar
que estén efectivamente activos en este proyecto y hacer un restore de prueba:
el backup que no se probó restaurar no existe.

**Terminado cuando.** Backups confirmados en el panel de Railway y un restore de
prueba hecho al menos una vez.
