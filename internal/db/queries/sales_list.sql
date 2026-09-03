-- Listado escalable de ventas (CAMBIOS_V2 §C3).
--
-- Busqueda insensible a mayusculas y acentos con translate() (sin extension
-- unaccent: portable a cualquier Postgres; ver DECISIONS.md). El mismo
-- normalizado se aplica a ambos lados del LIKE.
--
-- Paginacion por keyset (f.starts_at, s.id): los grupos por funcion quedan
-- contiguos entre paginas.

-- name: ListSalesPage :many
SELECT
  s.id, s.code, s.buyer_name, s.buyer_email, s.quantity, s.amount_cents,
  s.payment_status, s.payment_method, s.paid_cents, s.is_comp, s.voided_at, s.created_at,
  s.function_id,
  f.venue AS function_venue,
  f.starts_at AS function_starts_at,
  f.name AS function_name,
  u.name AS seller_name,
  -- COALESCE al año 1 = "nunca se envio"; el handler lo convierte a null.
  COALESCE((SELECT max(e.created_at) FROM email_sends e
   WHERE e.sale_id = s.id AND e.status = 'sent'), '0001-01-01'::timestamptz)::timestamptz AS last_email_at
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON s.seller_id = u.id
WHERE (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'pending' AND NOT s.is_comp AND s.payment_status = 'pending' AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'paid'    AND NOT s.is_comp AND s.payment_status = 'paid'    AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'comp'    AND s.is_comp AND s.voided_at IS NULL)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  )
  AND (
    sqlc.narg(cursor_starts)::timestamptz IS NULL
    OR (f.starts_at, s.id) > (sqlc.narg(cursor_starts)::timestamptz, sqlc.narg(cursor_id)::bigint)
  )
ORDER BY f.starts_at, s.id
LIMIT sqlc.arg(page_size)::integer;

-- name: SalesSummary :one
-- Resumen del mismo alcance (vendedora/funcion/busqueda) SIN el filtro de
-- estado ni el cursor: alimenta la tira de arriba y los contadores de chips.
SELECT
  COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS tickets_sold,
  -- Cobrado y por cobrar salen de lo efectivamente cobrado: una venta con un
  -- cobro parcial suma su parte de cada lado, no todo de uno.
  COALESCE(SUM(s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS paid_cents,
  COALESCE(SUM(s.amount_cents - s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS pending_cents,
  COUNT(*)::bigint AS total_count,
  COUNT(*) FILTER (WHERE s.payment_status = 'pending' AND NOT s.is_comp AND s.voided_at IS NULL)::bigint AS pending_count
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON s.seller_id = u.id
WHERE (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  );
