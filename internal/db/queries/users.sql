-- Todas las consultas de personas llevan organization_id (C17 §A), salvo las
-- dos que por definicion no pueden: la del login —todavia no hay sesion, y el
-- email es unico por organizacion, no global— y la del arranque.

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = sqlc.arg(id)::bigint AND organization_id = sqlc.arg(organization_id)::bigint;

-- name: CreateUser :one
INSERT INTO users (name, email, password_hash, must_change_password, organization_id)
VALUES (
  sqlc.arg(name)::text,
  sqlc.arg(email)::text,
  sqlc.arg(password_hash)::text,
  sqlc.arg(must_change_password)::boolean,
  sqlc.arg(organization_id)::bigint
)
RETURNING *;

-- name: SetUserPassword :exec
UPDATE users
SET password_hash = sqlc.arg(password_hash)::text,
    must_change_password = sqlc.arg(must_change_password)::boolean
WHERE id = sqlc.arg(id)::bigint AND organization_id = sqlc.arg(organization_id)::bigint;

-- name: UpdateUser :one
-- Identidad nada mas: el rol y la participacion viven en season_members.
UPDATE users
SET name  = sqlc.arg(name)::text,
    email = sqlc.arg(email)::text
WHERE id = sqlc.arg(id)::bigint AND organization_id = sqlc.arg(organization_id)::bigint
RETURNING *;

-- name: TouchUserLogin :exec
-- Sella el ingreso: a partir de aca la invitacion deja de estar pendiente.
UPDATE users SET last_login_at = now() WHERE id = sqlc.arg(id)::bigint;

-- name: CountUsers :one
-- CROSS-TENANT a proposito: es el chequeo del arranque ("¿hay alguien
-- cargado?"), antes de que exista organizacion alguna.
SELECT count(*) FROM users;

-- ============================================================================
-- Sesion: el usuario mas su rol en la temporada en curso DE SU organizacion
-- ============================================================================

-- name: GetUserWithMembership :one
-- No lleva organization_id como parametro: es la carga de la sesion, y la
-- organizacion sale de la propia fila del usuario. La temporada en curso es la
-- de ESA organizacion, no cualquiera que este activa.
--
-- `role` viene vacio cuando no participa de esta temporada: ahi solo puede
-- mirar su historial. Sin ninguna temporada cargada se cae a la membresia mas
-- reciente que tenga: es el arranque, quien instala la app entra antes de que
-- exista la primera temporada, y sin esto no podria crearla.
SELECT
  u.*,
  -- Con left_at el rol se apaga: dejo el coro a mitad de temporada, no vende
  -- mas. Sus ventas y su deuda siguen contando, y su historial lo sigue
  -- viendo (RequireHistory).
  COALESCE(CASE WHEN m.left_at IS NULL THEN m.role END, fallback.role, '')::text AS season_role,
  (m.id IS NOT NULL AND m.left_at IS NULL) AS participates,
  m.left_at,
  o.kind AS organization_kind,
  o.name AS organization_name,
  o.is_demo AS organization_is_demo
FROM users u
JOIN organizations o ON o.id = u.organization_id
LEFT JOIN seasons s ON s.is_active AND s.organization_id = u.organization_id
LEFT JOIN season_members m ON m.user_id = u.id AND m.season_id = s.id
LEFT JOIN LATERAL (
  SELECT m2.role FROM season_members m2
  WHERE m2.user_id = u.id
    AND NOT EXISTS (SELECT 1 FROM seasons WHERE is_active AND organization_id = u.organization_id)
  ORDER BY m2.joined_at DESC LIMIT 1
) fallback ON TRUE
WHERE u.id = sqlc.arg(id)::bigint;

-- name: ListUsersWithMembershipByEmail :many
-- CROSS-TENANT a proposito: es el login, y todavia no hay sesion de la que
-- sacar la organizacion. Como el email es unico por organizacion y no
-- global, puede haber mas de una fila: el login prueba la contraseña contra
-- cada una (ver auth.Login).
SELECT
  u.*,
  COALESCE(CASE WHEN m.left_at IS NULL THEN m.role END, fallback.role, '')::text AS season_role,
  (m.id IS NOT NULL AND m.left_at IS NULL) AS participates,
  m.left_at,
  o.kind AS organization_kind,
  o.name AS organization_name,
  o.is_demo AS organization_is_demo
FROM users u
JOIN organizations o ON o.id = u.organization_id
LEFT JOIN seasons s ON s.is_active AND s.organization_id = u.organization_id
LEFT JOIN season_members m ON m.user_id = u.id AND m.season_id = s.id
LEFT JOIN LATERAL (
  SELECT m2.role FROM season_members m2
  WHERE m2.user_id = u.id
    AND NOT EXISTS (SELECT 1 FROM seasons WHERE is_active AND organization_id = u.organization_id)
  ORDER BY m2.joined_at DESC LIMIT 1
) fallback ON TRUE
WHERE lower(u.email) = lower(sqlc.arg(email)::text)
ORDER BY u.last_login_at DESC NULLS LAST, u.id;

-- ============================================================================
-- Participacion por temporada (season_members)
-- ============================================================================
-- season_members no tiene organization_id: cuelga de seasons. Cada consulta
-- exige que la temporada sea de la organizacion; una que no lo es no devuelve
-- filas (y un INSERT sobre ella no inserta nada).

-- name: CountMembershipsOfUser :one
-- Cuantas temporadas lleva.
SELECT count(*)::bigint FROM season_members m
JOIN seasons s ON s.id = m.season_id
WHERE m.user_id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint;

-- name: CountSellerMembershipsOfUser :one
-- Si alguna vez fue corista: es lo que habilita a mirar SUS ventas y SU
-- rendicion aunque este año no este en el coro. Quien solo estuvo en la
-- puerta no tiene ventas propias que mirar.
SELECT count(*)::bigint FROM season_members m
JOIN seasons s ON s.id = m.season_id
WHERE m.user_id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint
  AND m.role IN ('seller', 'admin');

-- name: UpsertMembership :one
-- Solo si la temporada Y la persona son de la organizacion: si no, no inserta
-- nada y el caller recibe ErrNoRows.
INSERT INTO season_members (season_id, user_id, role)
SELECT s.id, u.id, sqlc.arg(role)::text
FROM seasons s, users u
WHERE s.id = sqlc.arg(season_id)::bigint
  AND u.id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint
  AND u.organization_id = sqlc.arg(organization_id)::bigint
ON CONFLICT (season_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, left_at = NULL
RETURNING *;

-- name: LeaveMembership :exec
-- Baja a mitad de temporada: deja de vender, pero sus ventas y su deuda
-- siguen contando.
UPDATE season_members m SET left_at = now()
FROM seasons s
WHERE s.id = m.season_id
  AND m.season_id = sqlc.arg(season_id)::bigint
  AND m.user_id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint;

-- name: DeleteMembership :exec
DELETE FROM season_members m
USING seasons s
WHERE s.id = m.season_id
  AND m.season_id = sqlc.arg(season_id)::bigint
  AND m.user_id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint;

-- name: CountAdminsInSeason :one
-- Nunca una temporada sin direccion.
SELECT count(*)::bigint FROM season_members m
JOIN seasons s ON s.id = m.season_id
WHERE m.season_id = sqlc.arg(season_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint
  AND m.role = 'admin' AND m.left_at IS NULL;

-- name: CopySeasonMembers :exec
-- El equipo de una temporada pasa a la siguiente con su rol. Es el default
-- del asistente: vienen todas tildadas y se destilda a las que se fueron.
-- Las dos temporadas tienen que ser de la organizacion.
INSERT INTO season_members (season_id, user_id, role)
SELECT sqlc.arg(to_season_id)::bigint, m.user_id, m.role
FROM season_members m
JOIN seasons de ON de.id = m.season_id
JOIN seasons a  ON a.id = sqlc.arg(to_season_id)::bigint
WHERE m.season_id = sqlc.arg(from_season_id)::bigint AND m.left_at IS NULL
  AND de.organization_id = sqlc.arg(organization_id)::bigint
  AND a.organization_id  = sqlc.arg(organization_id)::bigint
ON CONFLICT (season_id, user_id) DO NOTHING;

-- name: GetMembership :one
SELECT m.* FROM season_members m
JOIN seasons s ON s.id = m.season_id
WHERE m.season_id = sqlc.arg(season_id)::bigint
  AND m.user_id = sqlc.arg(user_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint;

-- name: TeamForSeason :many
-- El equipo de una temporada con lo que hace falta para decidir: cuanto
-- vendio cada una, cuanto de su cupo uso, cuanto le falta rendir y cuando
-- entro por ultima vez. Todo acotado a la temporada, para que el año pasado
-- no contamine el de ahora.
SELECT
  u.id,
  u.name,
  u.email,
  u.created_at,
  u.last_login_at,
  m.role,
  m.joined_at,
  m.left_at,
  (SELECT count(*) FROM tickets t
     JOIN sales sa ON t.sale_id = sa.id
     JOIN functions f ON sa.function_id = f.id
   WHERE sa.seller_id = u.id AND f.season_id = m.season_id
     AND NOT sa.is_comp AND t.status <> 'void')::bigint AS tickets_sold,
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
     JOIN functions f ON a.function_id = f.id
   WHERE a.user_id = u.id AND f.season_id = m.season_id)::bigint AS assigned,
  -- Lo cobrado menos lo rendido: lo que todavia tiene en la mano.
  (COALESCE((SELECT SUM(sa.paid_cents) FROM sales sa
     JOIN functions f ON sa.function_id = f.id
   WHERE sa.seller_id = u.id AND f.season_id = m.season_id
     AND NOT sa.is_comp AND sa.voided_at IS NULL), 0)
   - COALESCE((SELECT SUM(st.amount_cents) FROM settlements st
   WHERE st.seller_id = u.id AND st.season_id = m.season_id), 0))::bigint AS balance_cents,
  -- Ingresos que registro en la puerta, en esta temporada: es lo unico que
  -- hace quien esta ahi.
  (SELECT count(*) FROM checkins c
     JOIN tickets t ON t.id = c.ticket_id
     JOIN sales sa ON sa.id = t.sale_id
     JOIN functions f ON f.id = sa.function_id
   WHERE c.user_id = u.id AND f.season_id = m.season_id)::bigint AS checkins
FROM season_members m
JOIN seasons s ON s.id = m.season_id
JOIN users u ON u.id = m.user_id
WHERE m.season_id = sqlc.arg(season_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint
ORDER BY m.role, u.name;

-- name: FormerMembers :many
-- Quienes participaron alguna vez pero no de esta temporada. No desaparecen:
-- quedan abajo, con su historia, y se las puede reincorporar.
SELECT
  u.id,
  u.name,
  u.email,
  u.last_login_at,
  ultima.season_name AS last_season_name,
  ultima.role AS last_role,
  (SELECT count(*) FROM tickets t
     JOIN sales sa ON t.sale_id = sa.id
     JOIN functions f ON sa.function_id = f.id
   WHERE sa.seller_id = u.id AND f.season_id = ultima.season_id
     AND NOT sa.is_comp AND t.status <> 'void')::bigint AS last_tickets_sold
FROM users u
JOIN LATERAL (
  SELECT m.season_id, m.role, s.name AS season_name
  FROM season_members m
  JOIN seasons s ON s.id = m.season_id
  WHERE m.user_id = u.id
  ORDER BY m.joined_at DESC
  LIMIT 1
) ultima ON TRUE
WHERE u.organization_id = sqlc.arg(organization_id)::bigint
  AND NOT EXISTS (
    SELECT 1 FROM season_members m2
    WHERE m2.user_id = u.id AND m2.season_id = sqlc.arg(season_id)::bigint
  )
ORDER BY u.name;

-- name: SeasonTeamSummary :one
-- La franja de arriba de Equipo.
SELECT
  count(*) FILTER (WHERE m.left_at IS NULL AND u.last_login_at IS NOT NULL)::bigint AS active,
  count(*) FILTER (WHERE m.left_at IS NULL AND u.last_login_at IS NULL)::bigint AS pending,
  count(*) FILTER (WHERE m.left_at IS NOT NULL)::bigint AS left_choir,
  count(*)::bigint AS total
FROM season_members m
JOIN seasons s ON s.id = m.season_id
JOIN users u ON u.id = m.user_id
WHERE m.season_id = sqlc.arg(season_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint;
