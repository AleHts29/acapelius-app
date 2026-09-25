# Acapelius — Enmienda C18.1 · Jerarquía de bordes

> **Reemplaza la sección 3 (Forma) de `AFICHE_APP_SPEC.md`** y agrega los tokens de modo oscuro. Todo lo demás de C18 sigue vigente: tokens de color, tipografía, componentes, lo que no se toca.
>
> Referencias visuales: `design/acapelius-bordes-claro.html` y `design/acapelius-bordes-oscuro.html` (cada una con antes/después).

## El problema

C18 definió **un solo grosor de borde (2px) para todo**. El resultado es que cinco niveles de información pesan igual —barra lateral, panel, fila, ícono, chip, modal, botón— y la pantalla se lee como cajas dentro de cajas. En oscuro es peor, porque un borde claro sobre fondo oscuro brilla en vez de imprimir.

La corrección no es sacar bordes: es darles **jerarquía**, y aprovechar que en cada modo hay un recurso distinto para separar (en claro, el blanco sobre papel; en oscuro, la diferencia de luminosidad entre superficies).

## La escala

| Nivel | Qué separa | Claro | Oscuro |
|---|---|---|---|
| **1 · Firma** | Regla bajo el encabezado de página · bloque del hero | **`2px var(--ink)`** — los únicos de la app | Hero por superficie; regla `1px var(--edge)` |
| **2 · Estructura** | Borde de la barra lateral | `1px var(--edge)` | `1px var(--edge)` |
| **3 · Contenedor** | Paneles, bloques de función, modales | `1px var(--edge)` + fondo blanco sobre papel | **Sin borde**: superficie `--sur` sobre `--bg` |
| **4 · División** | Filas de tabla, separadores internos, troqueles | `1px var(--hair)` | `1px var(--hair)` |
| **5 · Interactivo** | Botones, inputs, segmentados, filtros | `1.5px var(--ink)` | `1px var(--edge)` |
| **6 · Marca** | Chips de estado · acento lateral de bloque | `1.5px` contorno · acento **interno** `3px` | igual, con el acento en `--ticket` del modo |

**Regla de lectura:** en modo claro, el borde grueso significa *"esto se toca"*. Si un elemento no es interactivo y tiene 1.5px o más, está mal (salvo el nivel 1).

## Tokens

```css
/* Modo claro */
:root {
  --bg:#F4F1EA; --sur:#FFFFFF; --sur2:#EDE9E0;
  --ink:#141414; --ink2:#6B6559;
  --edge:#CFC8B8;   /* estructura y contenedores */
  --hair:#E4DFD2;   /* divisiones internas */
  --ticket:#C4401E;
  --ok:#1E6B4A; --warn:#8A5A08; --bad:#A32D2D; --indigo:#3A3FC4;
}

/* Modo oscuro */
[data-theme="dark"] {
  --bg:#1A1815; --sur:#211E1A; --sur2:#272420;
  --ink:#F4F1EA; --ink2:#A39B8B;
  --edge:rgba(244,241,234,.18);
  --hair:rgba(244,241,234,.10);
  --ticket:#E05A2B;                /* el #C4401E queda apagado sobre oscuro */
  --ok:#4BBF8A; --warn:#E0A84A; --bad:#E5706E; --indigo:#8A8DEA;
}
```

El token `--ink` deja de ser "negro" y pasa a ser "el color del texto y de los trazos fuertes del modo actual". Ningún componente debe elegir color según el tema: todos leen tokens.

## Cambios concretos por componente

**Ambos modos**
1. **Ítem activo de la navegación**: el borde izquierdo de 4px se reemplaza por `box-shadow: inset 3px 0 0 var(--ticket)`. Misma lectura, una caja menos.
2. **Íconos de fila**: dejan el contorno y pasan a fondo tenue del color semántico (`#F5EEDF` en claro, `rgba(224,168,74,.14)` en oscuro). Eran la tercera caja dentro de una fila que ya estaba dentro de un panel.
3. **Filas de tabla y de lista**: `1px var(--hair)`, nunca más grueso.
4. **Separadores de sección** (la línea que sigue al título): `1px var(--edge)`.
5. **Badges de la navegación**: fondo tenue en vez de contorno.
6. **Chips de estado**: se mantienen en contorno de 1.5px (§4 de C18, sin cambios).

**Solo modo claro**
7. Paneles, bloques y modales: de `2px var(--ink)` a `1px var(--edge)`.
8. Al modal se le agrega `box-shadow: 0 18px 50px rgba(20,20,20,.22)` — **única sombra permitida en la app**, y solo porque flota sobre contenido.
9. Botones, inputs y segmentados: de `2px` a `1.5px var(--ink)`.

**Solo modo oscuro**
10. Paneles, hero y modales **pierden el borde** y se distinguen por superficie.
11. Todo borde que quede baja a 1px con los tokens `--edge` / `--hair`.
12. Acento naranja `#E05A2B`, con el texto del botón primario en `#17150F`.

## Lo que se conserva (el carácter no está en los bordes)

Anton en cifras, contadores y títulos · JetBrains Mono en mayúsculas para etiquetas · `border-radius: 0` en toda la app · naranja ticket como acción primaria · troqueles punteados en hero y franja de resumen · hero como bloque de tinta · acento lateral de bloque · filas de 44px · contraste AA.

## Criterios de aceptación

1. `grep -rn "2px solid" web/src --exclude-dir=public` devuelve **solo** la regla del encabezado de página (y su equivalente en el hero, si lo lleva).
2. En oscuro, ningún panel, bloque ni modal tiene borde: se distinguen por superficie.
3. En claro, el único elemento con sombra es el modal.
4. Ningún componente decide color por tema con condicionales: todo sale de tokens.
5. El naranja en oscuro es `#E05A2B` y el texto del botón primario cumple AA sobre él.
6. Las dos capturas de referencia (`acapelius-bordes-claro.html` y `acapelius-bordes-oscuro.html`, paneles "Después") se corresponden con lo implementado.
7. Nada más cambió: mismas pantallas, mismos flujos, mismas densidades.
