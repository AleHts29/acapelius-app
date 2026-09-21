-- name: SettlementsReport :many
-- Por vendedora de una temporada: cobrado (plata que la corista tiene en la
-- mano, cobros parciales incluidos; sin cortesias ni anuladas), pendiente de
-- cobro, y rendido. El saldo a rendir es collected - settled (spec §4). Lista
-- a toda vendedora, mas cualquier otro usuario con movimientos (p. ej. el
-- admin si vendio).
WITH collected AS (
  SELECT s.seller_id,
         COALESCE(SUM(s.paid_cents), 0)::bigint AS paid_cents,
         COALESCE(SUM(s.amount_cents - s.paid_cents), 0)::bigint AS pending_cents
  FROM sales s
  JOIN functions f ON s.function_id = f.id
  WHERE f.season_id = sqlc.arg(season_id)::bigint
    AND NOT s.is_comp
    AND s.voided_at IS NULL
  GROUP BY s.seller_id
), settled AS (
  SELECT seller_id, COALESCE(SUM(amount_cents), 0)::bigint AS cents
  FROM settlements
  WHERE season_id = sqlc.arg(season_id)::bigint
  GROUP BY seller_id
)
SELECT
  u.id AS seller_id,
  u.name AS seller_name,
  COALESCE(c.paid_cents, 0)::bigint AS collected_cents,
  COALESCE(c.pending_cents, 0)::bigint AS pending_cents,
  COALESCE(st.cents, 0)::bigint AS settled_cents
FROM users u
LEFT JOIN collected c ON c.seller_id = u.id
LEFT JOIN settled st ON st.seller_id = u.id
LEFT JOIN season_members m ON m.user_id = u.id AND m.season_id = sqlc.arg(season_id)::bigint
-- Las coristas de la temporada, mas cualquiera que haya movido plata en ella
-- aunque ya no este: su deuda no desaparece porque dejo el coro.
WHERE m.role = 'seller' OR c.seller_id IS NOT NULL OR st.seller_id IS NOT NULL
ORDER BY u.name;

-- name: CreateSettlement :one
INSERT INTO settlements (seller_id, season_id, amount_cents, method, notes)
VALUES (
  sqlc.arg(seller_id)::bigint,
  sqlc.arg(season_id)::bigint,
  sqlc.arg(amount_cents)::bigint,
  sqlc.arg(method)::text,
  sqlc.narg(notes)
)
RETURNING *;

-- name: ListSettlements :many
SELECT st.*, u.name AS seller_name
FROM settlements st
JOIN users u ON st.seller_id = u.id
WHERE st.season_id = sqlc.arg(season_id)::bigint
  AND (sqlc.narg(seller_id)::bigint IS NULL OR st.seller_id = sqlc.narg(seller_id)::bigint)
ORDER BY st.created_at DESC;

-- name: AttendanceBySale :many
-- Asistencia por comprador (C6): una fila por entrada viva de la funcion con
-- su check-in (o NULL si todavia no entro). El handler agrupa por venta.
SELECT
  s.id AS sale_id,
  s.buyer_name,
  seller.name AS seller_name,
  s.is_comp,
  t.id AS ticket_id,
  c.created_at AS checkin_at,
  c.method AS checkin_method,
  checker.name AS checkin_by
FROM sales s
JOIN users seller ON s.seller_id = seller.id
JOIN tickets t ON t.sale_id = s.id
LEFT JOIN checkins c ON c.ticket_id = t.id
LEFT JOIN users checker ON c.user_id = checker.id
WHERE s.function_id = sqlc.arg(function_id)::bigint
  AND s.voided_at IS NULL
  AND t.status <> 'void'
ORDER BY s.id, t.id;

-- name: FunctionsSummary :many
-- El pulso de la temporada funcion por funcion (C9): vendidas sobre cupo,
-- recaudado, asignado y cuantos ingresaron. Todo derivado, sin contadores.
SELECT
  f.id,
  f.name,
  f.venue,
  f.starts_at,
  f.capacity,
  f.price_cents,
  (SELECT count(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id AND t.status <> 'void')::bigint AS sold,
  (SELECT COALESCE(SUM(s.paid_cents), 0) FROM sales s
   WHERE s.function_id = f.id AND NOT s.is_comp AND s.voided_at IS NULL)::bigint AS collected_cents,
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
   JOIN season_members m ON m.user_id = a.user_id AND m.season_id = f.season_id
   WHERE a.function_id = f.id AND m.role = 'seller' AND m.left_at IS NULL)::bigint AS assigned,
  -- Cortesias emitidas: no son plata, pero ocupan butaca.
  (SELECT count(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id AND s.is_comp AND t.status <> 'void')::bigint AS comp_tickets,
  (SELECT count(*) FROM checkins c
   JOIN tickets t ON c.ticket_id = t.id
   JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id)::bigint AS entered
FROM functions f
WHERE f.season_id = sqlc.arg(season_id)::bigint
ORDER BY f.starts_at;

-- name: SalesTimeline :many
-- Entradas vendidas por dia (C9). El dia se corta en la zona horaria de la
-- app (la misma que usa el handler para la ventana), no en UTC: si no, las
-- ventas de la noche caerian en el dia siguiente.
SELECT
  to_char(s.created_at AT TIME ZONE sqlc.arg(tz)::text, 'YYYY-MM-DD') AS day,
  count(t.id)::bigint AS tickets
FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN functions f ON s.function_id = f.id
WHERE f.season_id = sqlc.arg(season_id)::bigint
  AND t.status <> 'void'
  AND s.voided_at IS NULL
  AND s.created_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: AttentionSettlements :many
-- Coristas con saldo a rendir (C9). `last_paid_at` es la fecha del cobro mas
-- reciente, que desde que existen los cobros parciales se guarda de verdad.
-- Centinela año 1 = todavia no cobro nada.
WITH collected AS (
  SELECT s.seller_id,
         COALESCE(SUM(s.paid_cents), 0)::bigint AS paid_cents,
         COALESCE(
           MAX((SELECT MAX(p.created_at) FROM sale_payments p WHERE p.sale_id = s.id)),
           '0001-01-01'::timestamptz) AS last_paid_at
  FROM sales s
  JOIN functions f ON s.function_id = f.id
  WHERE f.season_id = sqlc.arg(season_id)::bigint
    AND NOT s.is_comp
    AND s.voided_at IS NULL
  GROUP BY s.seller_id
), settled AS (
  SELECT seller_id, COALESCE(SUM(amount_cents), 0)::bigint AS cents
  FROM settlements
  WHERE season_id = sqlc.arg(season_id)::bigint
  GROUP BY seller_id
)
SELECT
  u.id AS seller_id,
  u.name AS seller_name,
  (c.paid_cents - COALESCE(st.cents, 0))::bigint AS balance_cents,
  -- Cobrado y rendido viajan con la alerta para que el pop-up de la home
  -- pueda armar su encabezado sin pedir el reporte entero (C14).
  c.paid_cents::bigint AS collected_cents,
  COALESCE(st.cents, 0)::bigint AS settled_cents,
  c.last_paid_at::timestamptz AS last_paid_at
FROM collected c
JOIN users u ON u.id = c.seller_id
LEFT JOIN settled st ON st.seller_id = c.seller_id
WHERE c.paid_cents - COALESCE(st.cents, 0) > 0
ORDER BY (c.paid_cents - COALESCE(st.cents, 0)) DESC;

-- name: AttentionUnassigned :many
-- Funciones que todavia no pasaron con entradas sin repartir entre coristas.
SELECT
  f.id AS function_id,
  f.name,
  f.venue,
  f.starts_at,
  f.capacity,
  COALESCE(SUM(a.quantity) FILTER (WHERE m.id IS NOT NULL), 0)::bigint AS assigned
FROM functions f
LEFT JOIN allocations a ON a.function_id = f.id
LEFT JOIN season_members m ON m.user_id = a.user_id AND m.season_id = f.season_id
  AND m.role = 'seller' AND m.left_at IS NULL
WHERE f.season_id = sqlc.arg(season_id)::bigint
  AND f.starts_at > now()
GROUP BY f.id
HAVING f.capacity > COALESCE(SUM(a.quantity) FILTER (WHERE m.id IS NOT NULL), 0)
ORDER BY f.starts_at;

-- name: AttentionPendingInvites :many
-- Gente de la temporada que nunca entro a la app (C7 + C9).
SELECT u.id AS user_id, u.name, m.role, u.created_at
FROM users u
JOIN season_members m ON m.user_id = u.id AND m.season_id = sqlc.arg(season_id)::bigint
WHERE m.left_at IS NULL AND u.last_login_at IS NULL
ORDER BY u.created_at;

-- ============================================================================
-- Home por rol (C12)
-- ============================================================================

-- name: RecentSales :many
-- Las ultimas ventas para la home. Sin cursor ni filtros: son tres filas.
SELECT
  s.id, s.buyer_name, s.quantity, s.amount_cents, s.paid_cents,
  s.payment_status, s.payment_method, s.is_comp, s.voided_at, s.created_at,
  f.name AS function_name, f.venue AS function_venue,
  u.name AS seller_name
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON s.seller_id = u.id
WHERE s.voided_at IS NULL
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
ORDER BY s.created_at DESC
LIMIT sqlc.arg(max)::integer;

-- name: MyPendingSales :many
-- Lo que a la corista le falta resolver: cobrar lo que le deben, y compartir
-- el link de las ventas sin email. Lo segundo solo si la funcion todavia no
-- paso: una entrada de una funcion que ya fue no hay que compartirla. Primero
-- lo que tiene plata de por medio, y dentro de cada grupo lo mas viejo.
SELECT
  s.id, s.code, s.buyer_name, s.quantity, s.created_at,
  (s.amount_cents - s.paid_cents)::bigint AS balance_cents,
  (s.buyer_email IS NOT NULL)::boolean AS has_email
FROM sales s
JOIN functions f ON s.function_id = f.id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND s.voided_at IS NULL
  AND NOT s.is_comp
  AND (
    s.amount_cents > s.paid_cents
    OR (s.buyer_email IS NULL AND f.starts_at > now())
  )
ORDER BY (s.amount_cents > s.paid_cents) DESC, s.created_at
LIMIT sqlc.arg(max)::integer;

-- name: MyCollectedInFunction :one
-- Lo que la corista ya tiene cobrado de esa funcion.
SELECT COALESCE(SUM(s.paid_cents), 0)::bigint
FROM sales s
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND s.function_id = sqlc.arg(function_id)::bigint
  AND NOT s.is_comp
  AND s.voided_at IS NULL;

-- name: CountPendingSales :one
-- Badge de "Vender": ventas con saldo. Global para direccion, propias para la
-- corista.
SELECT count(*) FROM sales s
WHERE s.voided_at IS NULL
  AND NOT s.is_comp
  AND s.amount_cents > s.paid_cents
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint);

-- ============================================================================
-- Direccion minimalista: la plata de la temporada y la comparacion
-- ============================================================================

-- name: SeasonMoney :one
-- Los tres pedazos en que se parte lo vendido: lo que la corista ya entrego,
-- lo que tiene en la mano sin rendir, y lo que el comprador todavia no pago.
-- Las cortesias no suman plata y las anuladas no existen.
SELECT
  COALESCE(SUM(s.amount_cents), 0)::bigint AS sold_cents,
  COALESCE(SUM(s.paid_cents), 0)::bigint AS collected_cents,
  COALESCE(SUM(s.amount_cents - s.paid_cents), 0)::bigint AS uncollected_cents,
  COUNT(*) FILTER (WHERE s.amount_cents > s.paid_cents)::bigint AS sales_uncollected
FROM sales s
JOIN functions f ON s.function_id = f.id
WHERE f.season_id = sqlc.arg(season_id)::bigint
  AND NOT s.is_comp
  AND s.voided_at IS NULL;

-- name: SeasonSettled :one
SELECT COALESCE(SUM(amount_cents), 0)::bigint
FROM settlements
WHERE season_id = sqlc.arg(season_id)::bigint;

-- ============================================================================
-- Detalle de rendicion de una corista
-- ============================================================================

-- name: SellerDebtSources :many
-- De donde sale la deuda: las ventas que la corista ya cobro, con cuanto
-- cobro de cada una y cuando fue el ultimo cobro. Ordenadas por fecha de
-- cobro descendente: lo mas fresco arriba, que es de lo que se acuerda.
SELECT
  s.id, s.buyer_name, s.quantity, s.paid_cents,
  f.name AS function_name,
  f.venue AS function_venue,
  (SELECT MAX(p.created_at) FROM sale_payments p WHERE p.sale_id = s.id)::timestamptz AS paid_at
FROM sales s
JOIN functions f ON s.function_id = f.id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND f.season_id = sqlc.arg(season_id)::bigint
  AND s.voided_at IS NULL
  AND NOT s.is_comp
  AND s.paid_cents > 0
ORDER BY paid_at DESC NULLS LAST, s.id DESC;

-- name: SellerSeasonStats :one
-- Los numeros del encabezado: cuantas ventas cobro, desde cuando, y cuanto le
-- deben los compradores (que no es exigible todavia).
SELECT
  COUNT(*) FILTER (WHERE s.paid_cents > 0)::bigint AS paid_sales,
  COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.is_comp), 0)::bigint AS tickets_sold,
  COALESCE(SUM(s.amount_cents - s.paid_cents), 0)::bigint AS uncollected_cents,
  COALESCE(MIN((SELECT MIN(p.created_at) FROM sale_payments p WHERE p.sale_id = s.id)),
           '0001-01-01'::timestamptz)::timestamptz AS first_paid_at,
  COALESCE(MAX((SELECT MAX(p.created_at) FROM sale_payments p WHERE p.sale_id = s.id)),
           '0001-01-01'::timestamptz)::timestamptz AS last_paid_at
FROM sales s
JOIN functions f ON s.function_id = f.id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND f.season_id = sqlc.arg(season_id)::bigint
  AND s.voided_at IS NULL
  AND NOT s.is_comp;

-- name: CreateReminder :one
INSERT INTO settlement_reminders (seller_id, season_id, sent_by, amount_cents, status)
VALUES (sqlc.arg(seller_id)::bigint, sqlc.arg(season_id)::bigint,
        sqlc.arg(sent_by)::bigint, sqlc.arg(amount_cents)::bigint, sqlc.arg(status)::text)
RETURNING *;

-- name: ListReminders :many
SELECT * FROM settlement_reminders
WHERE seller_id = sqlc.arg(seller_id)::bigint AND season_id = sqlc.arg(season_id)::bigint
ORDER BY created_at DESC;

-- name: LastReminders :many
-- El ultimo recordatorio de cada corista de la temporada, para el ranking.
SELECT DISTINCT ON (seller_id) seller_id, created_at, status
FROM settlement_reminders
WHERE season_id = sqlc.arg(season_id)::bigint
ORDER BY seller_id, created_at DESC;

-- name: SeasonsOverview :many
-- El indice de temporadas: cada una con su resultado. Es admin-only porque
-- lleva plata; ListSeasons (que leen todos los roles) sigue sin exponerla.
-- Las fechas vacias vuelven con el centinela 0001-01-01, como en
-- SellerSeasonStats: sqlc no sabe que un MIN() sin filas es NULL.
SELECT
  s.id,
  s.name,
  s.is_active,
  s.created_at,
  (SELECT count(*) FROM functions f WHERE f.season_id = s.id)::bigint AS functions,
  (SELECT COALESCE(SUM(f.capacity), 0) FROM functions f WHERE f.season_id = s.id)::bigint AS capacity,
  (SELECT count(*) FROM tickets t
     JOIN sales sa ON t.sale_id = sa.id
     JOIN functions f ON sa.function_id = f.id
   WHERE f.season_id = s.id AND t.status <> 'void')::bigint AS sold,
  (SELECT COALESCE(SUM(sa.paid_cents), 0) FROM sales sa
     JOIN functions f ON sa.function_id = f.id
   WHERE f.season_id = s.id AND NOT sa.is_comp AND sa.voided_at IS NULL)::bigint AS collected_cents,
  -- Cupo repartido entre coristas activas: lo mismo que cuenta el tablero.
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
     JOIN functions f ON a.function_id = f.id
     JOIN season_members m ON m.user_id = a.user_id AND m.season_id = s.id
   WHERE f.season_id = s.id AND m.role = 'seller' AND m.left_at IS NULL)::bigint AS assigned,
  -- Coristas que efectivamente vendieron algo en la temporada.
  (SELECT count(DISTINCT sa.seller_id) FROM sales sa
     JOIN functions f ON sa.function_id = f.id
   WHERE f.season_id = s.id AND sa.voided_at IS NULL)::bigint AS sellers,
  COALESCE((SELECT MIN(f.starts_at) FROM functions f WHERE f.season_id = s.id),
           '0001-01-01'::timestamptz)::timestamptz AS first_at,
  COALESCE((SELECT MAX(f.starts_at) FROM functions f WHERE f.season_id = s.id),
           '0001-01-01'::timestamptz)::timestamptz AS last_at,
  -- La proxima funcion, con las mismas 3 horas de gracia que usa Inicio.
  COALESCE((SELECT MIN(f.starts_at) FROM functions f
            WHERE f.season_id = s.id AND f.starts_at > now() - interval '3 hours'),
           '0001-01-01'::timestamptz)::timestamptz AS next_at
FROM seasons s
ORDER BY s.created_at DESC, s.id DESC;
