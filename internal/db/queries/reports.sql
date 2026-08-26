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
