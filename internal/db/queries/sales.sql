-- name: GetFunctionForUpdate :one
-- Lockea la fila de la funcion para serializar la validacion de cupo entre
-- ventas concurrentes (spec §4).
SELECT * FROM functions WHERE id = $1 FOR UPDATE;

-- name: CountActiveTickets :one
-- Entradas que ocupan cupo: todas las no anuladas de la funcion.
SELECT count(*) FROM tickets t
JOIN sales s ON t.sale_id = s.id
WHERE s.function_id = $1 AND t.status <> 'void';

-- name: CreateSale :one
INSERT INTO sales (function_id, seller_id, code, buyer_name, buyer_email, buyer_phone, quantity, amount_cents, is_comp, notes)
VALUES (
  sqlc.arg(function_id)::bigint,
  sqlc.arg(seller_id)::bigint,
  sqlc.arg(code)::text,
  sqlc.arg(buyer_name)::text,
  sqlc.narg(buyer_email),
  sqlc.narg(buyer_phone),
  sqlc.arg(quantity)::integer,
  sqlc.arg(amount_cents)::bigint,
  sqlc.arg(is_comp)::boolean,
  sqlc.narg(notes)
)
RETURNING *;

-- name: CreateTicket :one
INSERT INTO tickets (sale_id, code)
VALUES (sqlc.arg(sale_id)::bigint, sqlc.arg(code)::text)
RETURNING *;

-- name: GetSale :one
SELECT * FROM sales WHERE id = $1;

-- name: GetSaleByCode :one
SELECT * FROM sales WHERE code = sqlc.arg(code)::text;

-- name: ListTicketsBySale :many
SELECT * FROM tickets WHERE sale_id = $1 ORDER BY id;

-- name: GetTicket :one
SELECT * FROM tickets WHERE id = $1;

-- name: GetTicketByCode :one
SELECT * FROM tickets WHERE code = sqlc.arg(code)::text;

-- name: ListSalesDetailed :many
-- Listado para la UI: la venta con su funcion, vendedora y conteo de tickets
-- vivos. Filtros opcionales por vendedora y por funcion.
SELECT
  s.*,
  f.venue AS function_venue,
  f.starts_at AS function_starts_at,
  f.name AS function_name,
  u.name AS seller_name,
  count(t.id) FILTER (WHERE t.status <> 'void') AS active_tickets
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON s.seller_id = u.id
LEFT JOIN tickets t ON t.sale_id = s.id
WHERE (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
GROUP BY s.id, f.id, u.id
ORDER BY s.created_at DESC;

-- name: UpdateSalePayment :one
UPDATE sales
SET payment_status = sqlc.arg(payment_status)::text,
    payment_method = sqlc.narg(payment_method)
WHERE id = sqlc.arg(id)::bigint
RETURNING *;

-- name: VoidSale :one
UPDATE sales SET voided_at = now() WHERE id = sqlc.arg(id)::bigint RETURNING *;

-- name: VoidTicketsOfSale :exec
UPDATE tickets SET status = 'void' WHERE sale_id = sqlc.arg(sale_id)::bigint AND status = 'issued';

-- name: VoidTicket :one
UPDATE tickets SET status = 'void' WHERE id = sqlc.arg(id)::bigint RETURNING *;

-- name: CountTicketsBySaleAndStatus :one
SELECT count(*) FROM tickets WHERE sale_id = $1 AND status = sqlc.arg(status)::text;

-- name: RecordEmailSend :one
INSERT INTO email_sends (sale_id, recipient, status, error)
VALUES (
  sqlc.arg(sale_id)::bigint,
  sqlc.arg(recipient)::text,
  sqlc.arg(status)::text,
  sqlc.narg(error)
)
RETURNING *;

-- name: ListEmailSendsBySale :many
SELECT * FROM email_sends WHERE sale_id = $1 ORDER BY created_at DESC;

-- ============================================================================
-- Cobros de una venta (parciales o totales)
-- ============================================================================

-- name: CreateSalePayment :one
INSERT INTO sale_payments (sale_id, amount_cents, method, user_id)
VALUES (sqlc.arg(sale_id)::bigint, sqlc.arg(amount_cents)::bigint,
        sqlc.arg(method)::text, sqlc.arg(user_id)::bigint)
RETURNING *;

-- name: ListSalePayments :many
SELECT p.*, u.name AS by_name
FROM sale_payments p
JOIN users u ON u.id = p.user_id
WHERE p.sale_id = sqlc.arg(sale_id)::bigint
ORDER BY p.created_at, p.id;

-- name: DeleteSalePayment :one
DELETE FROM sale_payments
WHERE id = sqlc.arg(id)::bigint AND sale_id = sqlc.arg(sale_id)::bigint
RETURNING *;

-- name: DeleteSalePayments :exec
DELETE FROM sale_payments WHERE sale_id = sqlc.arg(sale_id)::bigint;

-- name: RecalcSalePayment :one
-- Recalcula el cache de la venta desde sus cobros: cuanto lleva cobrado, si
-- termino de pagar, y con que metodo fue el ultimo cobro (lo que muestra el
-- chip). Se llama siempre entera, nunca sumando de a poco, para que el cache
-- no pueda separarse del historial.
UPDATE sales s
SET paid_cents = c.total,
    payment_status = CASE WHEN c.total >= s.amount_cents AND c.total > 0 THEN 'paid' ELSE 'pending' END,
    payment_method = c.last_method
FROM (
  SELECT
    COALESCE(SUM(p.amount_cents), 0)::bigint AS total,
    (SELECT p2.method FROM sale_payments p2
     WHERE p2.sale_id = sqlc.arg(sale_id)::bigint
     ORDER BY p2.created_at DESC, p2.id DESC LIMIT 1) AS last_method
  FROM sale_payments p WHERE p.sale_id = sqlc.arg(sale_id)::bigint
) c
WHERE s.id = sqlc.arg(sale_id)::bigint
RETURNING s.*;

-- name: CountSalesBySellerInSeason :one
SELECT count(*)::bigint FROM sales s
JOIN functions f ON f.id = s.function_id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint AND f.season_id = sqlc.arg(season_id)::bigint;
