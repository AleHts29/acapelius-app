-- sales y tickets cuelgan de functions → seasons (C17 §A.1). Toda consulta
-- con sesion exige que la venta sea de la organizacion; una ajena no existe
-- (ErrNoRows → 404). Las dos publicas (GetSaleByCode, GetPublicTicket) no
-- llevan organizacion: el codigo secreto ya identifica la venta.

-- name: GetFunctionForUpdate :one
-- Lockea la fila de la funcion para serializar la validacion de cupo entre
-- ventas concurrentes (spec §4).
SELECT f.* FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE f.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
FOR UPDATE OF f;

-- name: CountActiveTickets :one
-- Entradas que ocupan cupo: todas las no anuladas de la funcion.
SELECT count(*) FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
  AND t.status <> 'void';

-- name: CreateSale :one
-- Solo si la funcion es de la organizacion; si no, no inserta (ErrNoRows).
INSERT INTO sales (function_id, seller_id, code, buyer_name, buyer_email, buyer_phone, quantity, amount_cents, is_comp, notes)
SELECT
  f.id,
  sqlc.arg(seller_id)::bigint,
  sqlc.arg(code)::text,
  sqlc.arg(buyer_name)::text,
  sqlc.narg(buyer_email),
  sqlc.narg(buyer_phone),
  sqlc.arg(quantity)::integer,
  sqlc.arg(amount_cents)::bigint,
  sqlc.arg(is_comp)::boolean,
  sqlc.narg(notes)
FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE f.id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
RETURNING *;

-- name: CreateTicket :one
-- Se llama justo despues de CreateSale, con un sale_id recien creado por la
-- misma transaccion: la venta ya fue verificada.
INSERT INTO tickets (sale_id, code)
VALUES (sqlc.arg(sale_id)::bigint, sqlc.arg(code)::text)
RETURNING *;

-- name: GetSale :one
SELECT s.* FROM sales s
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: ListTicketsBySale :many
-- Sin organizacion: el caller ya resolvio la venta (GetSale acotado, o
-- GetSaleByCode en la pagina publica). Las entradas no tienen dueño propio.
SELECT * FROM tickets WHERE sale_id = $1 ORDER BY id;

-- name: GetTicket :one
SELECT t.* FROM tickets t
JOIN sales s ON s.id = t.sale_id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE t.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: GetTicketByCode :one
-- Es la de la puerta: un codigo de otra organizacion no existe, aunque sea
-- valido. (La pagina publica usa GetPublicTicket.)
SELECT t.* FROM tickets t
JOIN sales s ON s.id = t.sale_id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE t.code = sqlc.arg(code)::text
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

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
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
LEFT JOIN tickets t ON t.sale_id = s.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
GROUP BY s.id, f.id, u.id
ORDER BY s.created_at DESC;

-- name: UpdateSalePayment :one
UPDATE sales s
SET payment_status = sqlc.arg(payment_status)::text,
    payment_method = sqlc.narg(payment_method)
FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE f.id = s.function_id
  AND s.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
RETURNING s.*;

-- name: VoidSale :one
UPDATE sales s SET voided_at = now()
FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE f.id = s.function_id
  AND s.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
RETURNING s.*;

-- name: VoidTicketsOfSale :exec
-- El caller ya resolvio la venta con GetSale (acotado).
UPDATE tickets SET status = 'void' WHERE sale_id = sqlc.arg(sale_id)::bigint AND status = 'issued';

-- name: VoidTicket :one
UPDATE tickets t SET status = 'void'
FROM sales s
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.id = t.sale_id
  AND t.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
RETURNING t.*;

-- name: CountTicketsBySaleAndStatus :one
-- El caller ya resolvio la venta con GetSale (acotado).
SELECT count(*) FROM tickets WHERE sale_id = $1 AND status = sqlc.arg(status)::text;

-- name: RecordEmailSend :one
-- El caller ya resolvio la venta con GetSale (acotado).
INSERT INTO email_sends (sale_id, recipient, status, error)
VALUES (
  sqlc.arg(sale_id)::bigint,
  sqlc.arg(recipient)::text,
  sqlc.arg(status)::text,
  sqlc.narg(error)
)
RETURNING *;

-- name: ListEmailSendsBySale :many
-- El caller ya resolvio la venta con GetSale (acotado).
SELECT * FROM email_sends WHERE sale_id = $1 ORDER BY created_at DESC;

-- ============================================================================
-- Cobros de una venta (parciales o totales)
-- ============================================================================
-- Todas reciben un sale_id que el handler ya resolvio con GetSale (acotado),
-- salvo las de a lote, que usan SalesByIDs (acotado).

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
JOIN seasons se ON se.id = f.season_id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND f.season_id = sqlc.arg(season_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- ============================================================================
-- Paginas publicas (/e/{code}, /t/{code}.png): sin organizacion a proposito.
-- No hay sesion; el codigo secreto ya identifica la venta (C17 §A.2).
-- ============================================================================

-- name: GetPublicSale :one
SELECT s.*,
  f.name AS function_name,
  f.venue AS function_venue,
  f.starts_at AS function_starts_at,
  u.name AS seller_name
FROM sales s
JOIN functions f ON f.id = s.function_id
JOIN users u ON u.id = s.seller_id
WHERE s.code = sqlc.arg(code)::text;

-- name: GetPublicTicketByCode :one
SELECT * FROM tickets WHERE code = sqlc.arg(code)::text;
