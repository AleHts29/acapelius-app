-- Listado escalable de ventas (CAMBIOS_V2 §C3, spec C15, C16 §Fase 2).
--
-- Todo acotado a la organizacion de la sesion (C17 §A): el join a seasons
-- es lo que impide que un listado sin filtro de temporada cruce de grupo.
--
-- Todo el listado esta acotado a una temporada: sin eso, cambiar de temporada
-- en el selector global dejaba Ventas mostrando las cinco temporadas juntas.
--
-- Busqueda insensible a mayusculas y acentos con translate() (sin extension
-- unaccent: portable a cualquier Postgres; ver DECISIONS.md). El mismo
-- normalizado se aplica a ambos lados del LIKE.
--
-- Orden: primero las funciones que todavia se venden (la mas cercana
-- primero), despues las que ya pasaron (la mas reciente primero). Se expresa
-- como dos claves numericas —past_rank y fn_rank— para que el keyset siga
-- siendo monotono: si el orden de los bloques lo decidiera el cliente, cada
-- pagina nueva insertaria bloques arriba de lo que estas leyendo.

-- name: ListSalesPage :many
SELECT
  s.id, s.code, s.buyer_name, s.buyer_email, s.quantity, s.amount_cents,
  s.payment_status, s.payment_method, s.paid_cents, s.is_comp, s.voided_at, s.created_at,
  s.function_id, s.seller_id,
  f.venue AS function_venue,
  f.starts_at AS function_starts_at,
  f.name AS function_name,
  u.name AS seller_name,
  -- COALESCE al año 1 = "nunca se envio"; el handler lo convierte a null.
  COALESCE((SELECT max(e.created_at) FROM email_sends e
   WHERE e.sale_id = s.id AND e.status = 'sent'), '0001-01-01'::timestamptz)::timestamptz AS last_email_at,
  -- Como termino el ultimo intento de envio: 'sent', 'failed' o '' si nunca
  -- se intento. Es lo que la columna Entrada muestra como estado.
  COALESCE((SELECT e.status FROM email_sends e
   WHERE e.sale_id = s.id ORDER BY e.created_at DESC LIMIT 1), '')::text AS last_email_status,
  -- Cuantas de las entradas de esta venta ya entraron: el menu de la fila lo
  -- muestra ("2 de 3 entraron") y el drawer tambien.
  (SELECT count(*) FROM checkins c
     JOIN tickets t ON c.ticket_id = t.id
   WHERE t.sale_id = s.id)::bigint AS entered,
  (f.starts_at < now() - interval '3 hours')::integer AS past_rank,
  (CASE WHEN f.starts_at < now() - interval '3 hours'
        THEN -extract(epoch FROM f.starts_at)
        ELSE  extract(epoch FROM f.starts_at) END)::double precision AS fn_rank
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'pending' AND NOT s.is_comp AND s.payment_status = 'pending' AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'paid'    AND NOT s.is_comp AND s.payment_status = 'paid'    AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'comp'    AND s.is_comp AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'void'    AND s.voided_at IS NOT NULL)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  )
  AND (
    sqlc.narg(cursor_past)::integer IS NULL
    OR (
      (f.starts_at < now() - interval '3 hours')::integer,
      (CASE WHEN f.starts_at < now() - interval '3 hours'
            THEN -extract(epoch FROM f.starts_at)
            ELSE  extract(epoch FROM f.starts_at) END)::double precision,
      s.id
    ) > (
      sqlc.narg(cursor_past)::integer,
      sqlc.narg(cursor_rank)::double precision,
      sqlc.narg(cursor_id)::bigint
    )
  )
ORDER BY past_rank, fn_rank, s.id
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
  COALESCE(SUM(s.quantity) FILTER (WHERE s.is_comp AND s.voided_at IS NULL), 0)::bigint AS comp_tickets,
  COUNT(*)::bigint AS total_count,
  COUNT(*) FILTER (WHERE s.payment_status = 'pending' AND NOT s.is_comp AND s.voided_at IS NULL)::bigint AS pending_count,
  COUNT(*) FILTER (WHERE s.payment_status = 'paid' AND NOT s.is_comp AND s.voided_at IS NULL)::bigint AS paid_count,
  COUNT(*) FILTER (WHERE s.is_comp AND s.voided_at IS NULL)::bigint AS comp_count
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  );

-- name: SalesFilteredSummary :one
-- El mismo resumen pero CON el filtro de estado aplicado: la franja de arriba
-- tiene que responder al filtro activo (spec C15 §2.2), y sumarlo en el
-- cliente sobre la pagina cargada daria un numero distinto en cada scroll.
SELECT
  COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS tickets_sold,
  COALESCE(SUM(s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS paid_cents,
  COALESCE(SUM(s.amount_cents - s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS pending_cents,
  COALESCE(SUM(s.quantity) FILTER (WHERE s.is_comp AND s.voided_at IS NULL), 0)::bigint AS comp_tickets,
  COUNT(*)::bigint AS total_count
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'pending' AND NOT s.is_comp AND s.payment_status = 'pending' AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'paid'    AND NOT s.is_comp AND s.payment_status = 'paid'    AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'comp'    AND s.is_comp AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'void'    AND s.voided_at IS NOT NULL)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  );

-- name: SalesFunctionTotals :many
-- Subtotales por funcion con el filtro activo (spec C15 §6): el encabezado de
-- cada bloque tiene que decir la verdad de TODA la funcion, no de las filas
-- que se alcanzaron a cargar.
SELECT
  f.id AS function_id,
  COUNT(*)::bigint AS sales,
  COALESCE(SUM(s.quantity) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS tickets,
  COALESCE(SUM(s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS paid_cents,
  COALESCE(SUM(s.amount_cents - s.paid_cents) FILTER (WHERE NOT s.is_comp AND s.voided_at IS NULL), 0)::bigint AS pending_cents
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
  AND (sqlc.narg(seller_id)::bigint IS NULL OR s.seller_id = sqlc.narg(seller_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
  AND (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'pending' AND NOT s.is_comp AND s.payment_status = 'pending' AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'paid'    AND NOT s.is_comp AND s.payment_status = 'paid'    AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'comp'    AND s.is_comp AND s.voided_at IS NULL)
    OR (sqlc.narg(status)::text = 'void'    AND s.voided_at IS NOT NULL)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR translate(lower(s.buyer_name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
    OR translate(lower(u.name), 'áéíóúäëïöüñç', 'aeiouaeiounc')
       LIKE '%' || translate(lower(sqlc.narg(q)::text), 'áéíóúäëïöüñç', 'aeiouaeiounc') || '%'
  )
GROUP BY f.id;

-- name: SellersWithSales :many
-- Las coristas que aparecen en el alcance actual, con cuantas ventas tienen:
-- alimenta el menu "Todas las vendedoras" con su conteo.
SELECT u.id, u.name, COUNT(*)::bigint AS sales
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
  AND (sqlc.narg(function_id)::bigint IS NULL OR s.function_id = sqlc.narg(function_id)::bigint)
GROUP BY u.id, u.name
ORDER BY u.name;

-- name: SalesByIDs :many
-- Las ventas de una seleccion, con lo que hace falta para operarlas en lote.
-- Los ids de otra organizacion no vuelven: el handler compara cuantas pidio
-- con cuantas recibio y responde 404 si falta alguna.
SELECT s.*, u.name AS seller_name
FROM sales s
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
JOIN users u ON s.seller_id = u.id
WHERE s.id = ANY(sqlc.arg(ids)::bigint[])
  AND se.organization_id = sqlc.arg(organization_id)::bigint;
