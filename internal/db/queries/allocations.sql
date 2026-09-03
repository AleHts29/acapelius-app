-- name: UpsertAllocation :one
INSERT INTO allocations (user_id, function_id, quantity)
VALUES (sqlc.arg(user_id)::bigint, sqlc.arg(function_id)::bigint, sqlc.arg(quantity)::integer)
ON CONFLICT (user_id, function_id)
DO UPDATE SET quantity = EXCLUDED.quantity
RETURNING *;

-- name: DeleteAllocation :exec
DELETE FROM allocations
WHERE user_id = sqlc.arg(user_id)::bigint AND function_id = sqlc.arg(function_id)::bigint;

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
LEFT JOIN allocations a ON a.user_id = u.id AND a.function_id = sqlc.arg(function_id)::bigint
WHERE u.role = 'seller' AND u.is_active
ORDER BY u.name;

-- name: SoldBySellerInFunction :one
-- Base del cupo consumido: tickets vivos de ventas no-cortesia.
SELECT COUNT(*) FROM tickets t
JOIN sales s ON t.sale_id = s.id
WHERE s.seller_id = sqlc.arg(seller_id)::bigint
  AND s.function_id = sqlc.arg(function_id)::bigint
  AND NOT s.is_comp
  AND t.status <> 'void';

-- name: GetAllocationQty :one
SELECT quantity FROM allocations
WHERE user_id = sqlc.arg(user_id)::bigint AND function_id = sqlc.arg(function_id)::bigint;

-- name: SumAllocations :one
-- Cuenta lo mismo que muestra el tablero: solo cupos de coristas activas. Si
-- a alguien le cambian el rol o la desactivan, su fila queda invisible en
-- pantalla; contarla aca hacia que el total validado no coincidiera con el
-- total en pantalla y que asignar el ultimo cupo fallara con numeros que no
-- estaban en ningun lado.
SELECT COALESCE(SUM(a.quantity), 0)::bigint
FROM allocations a
JOIN users u ON u.id = a.user_id
WHERE a.function_id = sqlc.arg(function_id)::bigint
  AND u.role = 'seller' AND u.is_active;

-- name: DeleteAllocationsForUser :exec
-- Al salir del rol de corista (o al desactivarse) se le sueltan los cupos:
-- si no, quedan reservando lugares que nadie puede vender ni ver.
DELETE FROM allocations WHERE user_id = sqlc.arg(user_id)::bigint;

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
WHERE a.user_id = sqlc.arg(user_id)::bigint
ORDER BY f.starts_at;

-- name: GetPublicTicket :one
-- Todo lo que necesita la pagina publica de UNA entrada (/t/{code}).
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
