-- allocations cuelga de users y functions (C17 §A.1): la organizacion sale de
-- la funcion (via su temporada) y, donde importa, de la persona.

-- name: UpsertAllocation :one
-- Solo si la funcion y la persona son de la organizacion; si no, no inserta y
-- devuelve ErrNoRows.
INSERT INTO allocations (user_id, function_id, quantity)
SELECT u.id, f.id, sqlc.arg(quantity)::integer
FROM users u, functions f
JOIN seasons se ON se.id = f.season_id
WHERE u.id = sqlc.arg(user_id)::bigint
  AND f.id = sqlc.arg(function_id)::bigint
  AND u.organization_id = sqlc.arg(organization_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ON CONFLICT (user_id, function_id)
DO UPDATE SET quantity = EXCLUDED.quantity
RETURNING *;

-- name: DeleteAllocation :exec
DELETE FROM allocations a
USING functions f, seasons se
WHERE f.id = a.function_id AND se.id = f.season_id
  AND a.user_id = sqlc.arg(user_id)::bigint
  AND a.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: FunctionAllocationBoard :many
-- Tablero de asignacion (C8): todas las coristas activas con su cupo y lo
-- vendido. "Vendido" = tickets vivos de sus ventas no-cortesia: anular
-- devuelve el cupo automaticamente, sin contador desnormalizado.
SELECT
  u.id AS user_id,
  u.name AS seller_name,
  COALESCE(a.quantity, 0)::integer AS assigned,
  (SELECT COUNT(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.seller_id = u.id AND s.function_id = sqlc.arg(function_id)::bigint
     AND NOT s.is_comp AND t.status <> 'void')::bigint AS sold
FROM users u
JOIN functions f ON f.id = sqlc.arg(function_id)::bigint
JOIN seasons se ON se.id = f.season_id
JOIN season_members m ON m.user_id = u.id AND m.season_id = f.season_id
LEFT JOIN allocations a ON a.user_id = u.id AND a.function_id = sqlc.arg(function_id)::bigint
WHERE m.role = 'seller' AND m.left_at IS NULL
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ORDER BY u.name;

-- name: SoldBySellerInFunction :one
-- Base del cupo consumido: tickets vivos de ventas no-cortesia.
SELECT COUNT(*) FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND s.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
  AND NOT s.is_comp
  AND t.status <> 'void';

-- name: GetAllocationQty :one
SELECT a.quantity FROM allocations a
JOIN functions f ON f.id = a.function_id
JOIN seasons se ON se.id = f.season_id
WHERE a.user_id = sqlc.arg(user_id)::bigint
  AND a.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: SumAllocations :one
-- Cuenta lo mismo que muestra el tablero: solo cupos de coristas activas. Si
-- a alguien le cambian el rol o la desactivan, su fila queda invisible en
-- pantalla; contarla aca hacia que el total validado no coincidiera con el
-- total en pantalla y que asignar el ultimo cupo fallara con numeros que no
-- estaban en ningun lado.
SELECT COALESCE(SUM(a.quantity), 0)::bigint
FROM allocations a
JOIN functions f ON f.id = a.function_id
JOIN seasons se ON se.id = f.season_id
JOIN season_members m ON m.user_id = a.user_id AND m.season_id = f.season_id
WHERE a.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
  AND m.role = 'seller' AND m.left_at IS NULL;

-- name: DeleteAllocationsForUser :exec
-- Al salir del rol de corista (o al desactivarse) se le sueltan los cupos:
-- si no, quedan reservando lugares que nadie puede vender ni ver.
DELETE FROM allocations a
USING users u
WHERE u.id = a.user_id
  AND a.user_id = sqlc.arg(user_id)::bigint
  AND u.organization_id = sqlc.arg(organization_id)::bigint;

-- name: MyAllocations :many
-- Cupo y avance de la corista logueada, por funcion (C8: /api/me/allocations).
SELECT
  a.function_id,
  f.name AS function_name,
  f.venue,
  f.starts_at,
  a.quantity AS assigned,
  (SELECT COUNT(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.seller_id = a.user_id AND s.function_id = a.function_id
     AND NOT s.is_comp AND t.status <> 'void')::bigint AS sold
FROM allocations a
JOIN functions f ON a.function_id = f.id
JOIN seasons se ON se.id = f.season_id
WHERE a.user_id = sqlc.arg(user_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ORDER BY f.starts_at;

-- name: GetPublicTicket :one
-- Todo lo que necesita la pagina publica de UNA entrada (/t/{code}).
-- SIN organization_id a proposito: es publica, no hay sesion, y el codigo
-- firmado ya identifica la venta (C17 §A.2).
SELECT
  t.code,
  t.status,
  s.buyer_name,
  s.quantity AS sale_quantity,
  s.is_comp,
  s.voided_at,
  seller.name AS seller_name,
  f.name AS function_name,
  f.venue,
  f.starts_at,
  (SELECT count(*) FROM tickets t2 WHERE t2.sale_id = t.sale_id AND t2.id <= t.id)::bigint AS ticket_index
FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN users seller ON s.seller_id = seller.id
JOIN functions f ON s.function_id = f.id
WHERE t.code = sqlc.arg(code)::text;
