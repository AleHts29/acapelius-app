# Pendientes

Lo que falta hacer, ordenado por lo que más duele. Cada ítem dice qué pasa, dónde
está y cuándo se considera terminado.

Lo que ya se hizo y por qué se decidió así vive en [DECISIONS.md](DECISIONS.md);
el paquete de cambios v2 (C1–C10), en [docs/CAMBIOS_V2.md](docs/CAMBIOS_V2.md).

---

## P1 · Config as Code de Railway, deprecado

**Qué pasa.** Cada deploy avisa que `railway.json` deja de funcionar el
**2026-12-01** y hay que migrar a `.railway/railway.ts`.

**Terminado cuando.** `railway config migrate` corrido, el archivo nuevo
commiteado y un deploy verde con él.

---

## P2 · Confirmar los backups de producción

**Qué pasa.** `docs/operations.md` explica que Railway hace backups automáticos
**en el plan pago** y recomienda además un dump lógico propio. Falta confirmar
que estén efectivamente activos en este proyecto y hacer un restore de prueba:
el backup que no se probó restaurar no existe.

**Terminado cuando.** Backups confirmados en el panel de Railway y un restore de
prueba hecho al menos una vez.
