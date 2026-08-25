# Acapelius — Design System v1

> Complemento de `acapelius-spec.md`. Este documento define **cómo se ve y se comporta** la interfaz. La referencia visual canónica es `design/acapelius-brand-final.html` (abrirlo en un browser: 5 pantallas mockeadas). Ante cualquier duda visual, ese HTML gana sobre interpretaciones; ante dudas funcionales, gana el spec.

---

## 1. Identidad y principios

Marca: **"Sofisticación, serenidad y confianza. Profesionalismo con un toque artístico clásico."**

Principios de diseño derivados:
1. **Crema como aire, azul como acción.** El fondo global es crema de marca; el azul se reserva para lo importante (hero de función, CTAs, tab activa, links). Nunca pintar superficies grandes de azul salvo el hero.
2. **Categorías con código de color sobrio.** Las áreas funcionales se distinguen por un borde lateral fino de color, nunca por headers pintados completos.
3. **Números primero.** Recaudado, por cobrar, ingresados: tipografía display grande, color semántico, visibles sin scroll.
4. **La puerta es un modo, no una pantalla.** Pantalla completa, botones gigantes, feedback a todo color, cero cromo innecesario.
5. **Un solo acento decorativo:** el isologo (nota + círculo) como marca de agua y sello. Nada más de ornamento.

## 2. Tokens

### 2.1 Color (CSS custom properties)

```css
:root {
  /* Marca (NO inventar variantes; usar exactamente estos) */
  --brand-blue:   #415DA7;  /* primario, acciones, tab activa, hero */
  --brand-cream:  #F8ECDE;  /* fondo global de la app */
  --brand-ink:    #1D1D1B;  /* texto principal, categoría Admin, modo nocturno bg */
  --brand-white:  #FFFFFF;  /* cards */

  /* Derivados de UI */
  --surface:      #FFFFFF;  /* cards sobre crema */
  --surface-alt:  #FDFAF5;  /* inputs en reposo */
  --line:         #EADFCB;  /* bordes de cards e inputs */
  --text-muted:   #8B8578;  /* secundario; nunca para texto esencial */
  --blue-soft:    #E8EDF8;  /* fondo de chips/badges azules */

  /* Semánticos (estados; independientes de la marca) */
  --ok:           #2F7D5B;  --ok-soft:   #E4F0EA;   /* pagó, al día, ingreso válido */
  --warn:         #B7791F;  --warn-soft: #F7ECD7;   /* debe, pendiente, sin conexión */
  --danger:       #C24A4A;  --danger-soft:#F7E3E3;  /* inválido, ya usado, anular */

  /* Modo puerta nocturno */
  --night-bg:     #1D1D1B;
  --night-card:   #28271F;
  --night-line:   #3A382E;
  --night-text:   #F8ECDE;
  --night-muted:  #A39B8B;
}
```

Reglas:
- Texto sobre azul y sobre verde: siempre crema/blanco. Texto sobre crema: tinta. Verificar contraste AA (≥ 4.5:1 en texto normal); `--text-muted` solo para metadatos.
- Colores de categoría: Ventas = `--brand-blue`, Operación/Puerta = `--ok`, Administración = `--brand-ink`.

### 2.2 Tipografía

- **Display / títulos / números grandes:** `Archivo` (Google Fonts), pesos 700–800. Eyebrows y labels en uppercase con `letter-spacing: 0.12–0.16em` (hereda el carácter del wordmark ACAPELIUS).
- **Cuerpo / UI:** `Inter`, pesos 400–700.
- Escala (mobile-first): eyebrow 10px/800 · caption 11px · body 13.5–14px · título de card 17–18px/800 · título de página 22px/800 · KPI 19–20px/800 · contador de puerta 30px (52px en nocturno si entra) /800.
- Cargar con `font-display: swap` y preconnect; fallbacks: `system-ui, sans-serif`.

### 2.3 Espaciado, radios, sombras

- Grilla de espaciado: múltiplos de 4; padding lateral de pantalla: 20px; gap entre cards: 12px.
- Radios: cards 15–18px · inputs y botones 12–13px · paneles full (puerta) 20px · pills 999px.
- Sombras: prácticamente ninguna; la jerarquía la dan bordes (`--line`) y color. Excepción: focus ring `0 0 0 3px rgba(65,93,167,.12)` + borde azul.
- Touch targets: mínimo 44×44px. En modo puerta, botones principales ≥ 52px de alto.

## 3. Componentes

### 3.1 Navegación
- **Tab bar inferior fija**, 4 pestañas: Inicio (♪) · Vender (🎟) · Puerta (📷) · Dirección (📊). Iconos: usar `lucide-react` (music, ticket, scan-line, bar-chart-3) en vez de emojis en la implementación real.
- Visibilidad por rol: `seller` ve Inicio/Vender/Puerta*; `door` ve solo Puerta; `admin` ve todo. (*Puerta visible para seller solo si dirección la habilita; por defecto sí.)
- Tab activa: color de su categoría (Vender/Inicio azul, Puerta verde, Dirección tinta) + label bold.
- Header: isologo (SVG) + wordmark "ACAPELIUS" en Archivo 800 tracking 0.22em, tinta sobre crema. Avatar circular azul con inicial a la derecha.

### 3.2 Hero de función (Inicio)
Card azul `--brand-blue`, radio 18px, texto crema. Contenido: eyebrow "PRÓXIMA FUNCIÓN · EN N DÍAS" (o "HOY · 20:00"), nombre en Archivo 800, meta (fecha/venue), barra de progreso de ventas (track crema 25% alpha, fill crema) y label "X de Y vendidas · Z%". Marca de agua: isologo en crema al 16% de opacidad, desbordado en la esquina inferior derecha, `overflow: hidden`.

### 3.3 Card de categoría (Inicio)
Card blanca con **borde lateral izquierdo de 5px** del color de la categoría. Header: nombre de categoría en Archivo 800 uppercase 11px del color de la categoría + badge contextual opcional a la derecha (ej: "2 pendientes", "Debe $90.000"). Ítems: título 13.5px/700 + subtítulo 11px muted + chevron. Toda la fila es tappable.

### 3.4 Chips de estado (sistema único en TODA la app)
- `Debe $X` → `--warn` sobre `--warn-soft`
- `Pagó` / `Pagó (transf.)` / `Al día` → `--ok` sobre `--ok-soft`
- `Cortesía` → `--brand-blue` sobre `--blue-soft`
- `Anulada` → `--danger` sobre `--danger-soft`
Forma: pill 999px, 10.5px/800. Mismo texto y color en Ventas, Rendiciones, Panel y Asistencia. Prohibido expresar estado de otra forma.

### 3.5 Formularios (Nueva venta y demás)
- Label: Archivo 800 uppercase 10px muted. Input: 12px radio, fondo `--surface-alt`, borde `--line` 1.5px; focus: borde azul + ring. Hint 10.5px muted debajo.
- **Stepper de cantidad**: [−] [n] [+], botones 42px, símbolos azules, número Archivo 800; al lado, "Total \n $X" calculado en vivo.
- CTA primario: azul, texto crema, 14px padding, 800. CTA secundario "ghost": borde `--line`, texto tinta. Cortesía: checkbox o CTA ghost "Marcar como cortesía".
- Errores: borde `--danger` + mensaje 11px danger debajo; nunca solo color (agregar texto).

### 3.6 Modo puerta (claro)
- Layout: header mínimo → fila función + estado de conexión → card contador (número Archivo 800 verde "38 / 80" + label INGRESARON) → panel de resultado flexible → dos botones fijos abajo: "Buscar nombre" (ghost) y "Siguiente escaneo" (tinta, texto crema).
- Estado conexión: "● En línea" verde / "⬤ Sin conexión · N por sincronizar" warn. Siempre visible.
- Resultados a panel completo (flex:1):
  - **Válido:** fondo `--ok`, anillo con ✓, nombre en Archivo 800 21px, "N entradas · le vendió X", sello "SELLO ACAPELIUS · HH:MM". Vibración corta si el dispositivo lo permite.
  - **Ya usada:** fondo `--danger`, ✕, nombre + "Ya ingresó a las HH:MM · escaneado por X".
  - **Inválida / otra función / anulada:** fondo `--danger`, mensaje específico.
  - **Escaneando:** viewfinder de cámara con marco.
- Búsqueda manual: sheet/overlay con input grande, resultados como filas (nombre, vendedora, N entradas, estado) y botón "Marcar ingreso" por fila.

### 3.7 Modo puerta nocturno (toggle en pantalla de puerta)
Mismo layout con tokens night: fondo `--night-bg`, cards `--night-card`, texto crema, marco de escaneo crema. Botón primario invertido: crema con texto tinta. Los paneles verde/rojo de resultado se mantienen igual (son semánticos). Persistir la preferencia por dispositivo (localStorage). Respetar `prefers-reduced-motion`.

### 3.8 Dirección
- KPIs: grid 2×2 de cards blancas; número Archivo 800 con color semántico (recaudado verde, por cobrar warn, vendidas azul, neutras tinta), label 10.5px muted.
- Filas de rendición: card blanca, nombre 700 + "Cobró $A · rindió $B" muted, chip de estado a la derecha. Tap → detalle con historial y CTA "Registrar rendición" (azul).
- Asistencia: contador grande "N / M ingresaron", lista "quién entró" con hora, autorefresh con indicador sutil.

### 3.9 Página pública de entrada (`/e/{sale_code}`)
Misma identidad: fondo crema, card blanca con QR(s) grandes, isologo arriba, datos de función, y nota "Entrada general, sin numerar". Sin navegación de app. Es lo único que ven los compradores: debe verse impecable en cualquier celular y al imprimirse.

## 4. Assets de marca

En `assets/brand/originals/` están los PNG exportados (17 variantes: isologo + wordmark en horizontal y vertical, en tinta, crema, azul y combinaciones sobre crema/azul/negro/blanco) más el PDF de marca. El archivo fuente `.ai` lo tiene Alejandro.

Para la app:
1. **Ideal:** exportar del `.ai` tres SVGs: `logo-mark.svg` (solo isologo, monocromo `currentColor`), `logo-horizontal.svg`, `logo-vertical.svg`. Con `currentColor` un solo archivo sirve para tinta/crema/azul.
2. **Mientras tanto:** usar los PNG (elegir la variante correcta por fondo: sobre crema → versión azul o tinta; sobre azul/tinta → versión crema) y dejar un TODO para reemplazar por SVG.
3. Favicon y PWA icons: isologo sobre crema (maskable) y sobre azul.
4. Email: usar PNG horizontal (los clientes de mail manejan mal SVG).

## 5. Accesibilidad y calidad

- Contraste AA en todo texto esencial; los chips soft cumplen sobre sus fondos soft.
- Foco visible con ring azul en todo elemento interactivo; navegable con teclado.
- `aria-live="polite"` en el contador de puerta y el resultado de escaneo.
- Viewport de diseño: 380px; probar hasta 320px. La app es mobile-first; en desktop, contenedor centrado max-width 480px (excepto Dirección, que puede expandir a 2 columnas ≥ 900px).
- Textos de UI en español rioplatense, voseo ("Elegí la función", "Registrá la venta"), sentence case, sin tecnicismos.
