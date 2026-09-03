-- name: SalesReport :many
-- Una fila por funcion x vendedora, con totales y pagas vs. pendientes.
-- Las ventas anuladas no cuentan; las cortesias se informan aparte y nunca
-- suman plata.
SELECT
  s.function_id,
  f.venue AS function_venue,
  f.starts_at AS function_starts_at,
  f.name AS function_name,
  s.seller_id,
  u.name AS seller_name,
  COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.is_comp), 0)::bigint AS tickets_sold,
  COALESCE(SUM(s.quantity) FILTER (WHERE s.is_comp), 0)::bigint AS comp_tickets,
  COALESCE(SUM(s.amount_cents) FILTER (WHERE s.payment_status = 'paid' AND NOT s.is_comp), 0)::bigint AS paid_cents,
  COALESCE(SUM(s.amount_cents) FILTER (WHERE s.payment_status = 'pending' AND NOT s.is_comp), 0)::bigint AS pending_cents
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON s.seller_id = u.id
WHERE s.voided_at IS NULL
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
GROUP BY s.function_id, f.id, s.seller_id, u.id
ORDER BY f.starts_at, u.name;

-- name: SettlementsReport :many
-- Por vendedora de una temporada: cobrado (ventas pagas, sin cortesias ni
-- anuladas), pendiente de cobro, y rendido. El saldo a rendir es
-- collected - settled (spec §4). Lista a toda vendedora, mas cualquier otro
-- usuario con movimientos (p. ej. el admin si vendio).
WITH collected AS (
  SELECT s.seller_id,
         COALESCE(SUM(s.amount_cents) FILTER (WHERE s.payment_status = 'paid'), 0)::bigint AS paid_cents,
         COALESCE(SUM(s.amount_cents) FILTER (WHERE s.payment_status = 'pending'), 0)::bigint AS pending_cents
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
WHERE u.role = 'seller' OR c.seller_id IS NOT NULL OR st.seller_id IS NOT NULL
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
  (SELECT COALESCE(SUM(s.amount_cents), 0) FROM sales s
   WHERE s.function_id = f.id AND s.payment_status = 'paid'
     AND NOT s.is_comp AND s.voided_at IS NULL)::bigint AS collected_cents,
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
   JOIN users au ON au.id = a.user_id
   WHERE a.function_id = f.id AND au.role = 'seller' AND au.is_active)::bigint AS assigned,
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
-- Coristas con saldo a rendir (C9). `last_paid_at` es la venta paga mas
-- reciente: no guardamos fecha de cobro, asi que es la mejor referencia
-- temporal disponible. Centinela año 1 = todavia no cobro nada.
WITH collected AS (
  SELECT s.seller_id,
         COALESCE(SUM(s.amount_cents) FILTER (WHERE s.payment_status = 'paid'), 0)::bigint AS paid_cents,
         COALESCE(MAX(s.created_at) FILTER (WHERE s.payment_status = 'paid'), '0001-01-01'::timestamptz) AS last_paid_at
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
  COALESCE(SUM(a.quantity) FILTER (WHERE au.id IS NOT NULL), 0)::bigint AS assigned
FROM functions f
LEFT JOIN allocations a ON a.function_id = f.id
LEFT JOIN users au ON au.id = a.user_id AND au.role = 'seller' AND au.is_active
WHERE f.season_id = sqlc.arg(season_id)::bigint
  AND f.starts_at > now()
GROUP BY f.id
HAVING f.capacity > COALESCE(SUM(a.quantity) FILTER (WHERE au.id IS NOT NULL), 0)
ORDER BY f.starts_at;

-- name: AttentionPendingInvites :many
-- Gente del equipo que nunca entro a la app (C7 + C9).
SELECT id AS user_id, name, role, created_at
FROM users
WHERE is_active AND last_login_at IS NULL
ORDER BY created_at;
