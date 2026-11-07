-- Vacía los datos de prueba de las organizaciones reales (la demo no se toca).
--
-- Queda: la organización, los usuarios de dirección y UNA temporada nueva,
-- vacía y activa, con dirección adentro. Hace falta: el rol vive en la
-- temporada (season_members); sin ninguna, dirección entra sin rol y no puede
-- crear la primera.
-- Se borra: todas las temporadas viejas con sus funciones, ventas, entradas,
-- ingresos, rendiciones, cupos, recordatorios y mails, y el resto de los
-- usuarios (coristas y puerta). Se cierran todas las sesiones.
--
-- Uso: psql ... -v temporada='Temporada 2027' -f vaciar-datos-de-prueba.sql
-- Todo va en una transacción: si algo falla, no se borra nada.
\set ON_ERROR_STOP on
\if :{?temporada}
\else
  \set temporada 'Temporada 2027'
\endif

BEGIN;

CREATE TEMP TABLE t_orgs ON COMMIT DROP AS
  SELECT id FROM organizations WHERE NOT is_demo;
CREATE TEMP TABLE t_seasons ON COMMIT DROP AS
  SELECT id FROM seasons WHERE organization_id IN (SELECT id FROM t_orgs);
CREATE TEMP TABLE t_functions ON COMMIT DROP AS
  SELECT id FROM functions WHERE season_id IN (SELECT id FROM t_seasons);
CREATE TEMP TABLE t_sales ON COMMIT DROP AS
  SELECT id FROM sales WHERE function_id IN (SELECT id FROM t_functions);
-- Dirección: quien tiene rol admin en su membresía más reciente.
CREATE TEMP TABLE t_admins ON COMMIT DROP AS
  SELECT DISTINCT ON (m.user_id) m.user_id AS id, u.organization_id
  FROM season_members m JOIN users u ON u.id = m.user_id
  WHERE u.organization_id IN (SELECT id FROM t_orgs)
  ORDER BY m.user_id, m.joined_at DESC;
DELETE FROM t_admins a WHERE NOT EXISTS (
  SELECT 1 FROM season_members m WHERE m.user_id = a.id AND m.role = 'admin'
    AND m.joined_at = (SELECT max(joined_at) FROM season_members WHERE user_id = a.id));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM t_orgs o WHERE NOT EXISTS (SELECT 1 FROM t_admins a WHERE a.organization_id = o.id)) THEN
    RAISE EXCEPTION 'Hay una organización sin nadie de dirección: no se borra nada.';
  END IF;
END $$;

SELECT o.name AS organizacion, u.name AS queda_en_direccion, u.email
FROM t_admins a JOIN users u ON u.id = a.id JOIN organizations o ON o.id = a.organization_id
ORDER BY o.name, u.name;

DELETE FROM checkins WHERE ticket_id IN (SELECT id FROM tickets WHERE sale_id IN (SELECT id FROM t_sales));
DELETE FROM tickets WHERE sale_id IN (SELECT id FROM t_sales);
DELETE FROM email_sends WHERE sale_id IN (SELECT id FROM t_sales);
DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM t_sales);
DELETE FROM sales WHERE id IN (SELECT id FROM t_sales);
DELETE FROM allocations WHERE function_id IN (SELECT id FROM t_functions);
DELETE FROM functions WHERE id IN (SELECT id FROM t_functions);
DELETE FROM settlement_reminders WHERE season_id IN (SELECT id FROM t_seasons);
DELETE FROM settlements WHERE season_id IN (SELECT id FROM t_seasons);
DELETE FROM seasons WHERE id IN (SELECT id FROM t_seasons); -- season_members se va en cascada
DELETE FROM users
  WHERE organization_id IN (SELECT id FROM t_orgs) AND id NOT IN (SELECT id FROM t_admins);
DELETE FROM sessions;

-- La temporada nueva, activa y vacía, con dirección adentro.
WITH nuevas AS (
  INSERT INTO seasons (name, is_active, organization_id)
  SELECT :'temporada', TRUE, id FROM t_orgs
  RETURNING id, organization_id
)
INSERT INTO season_members (season_id, user_id, role)
SELECT n.id, a.id, 'admin' FROM nuevas n JOIN t_admins a ON a.organization_id = n.organization_id;

SELECT o.name AS organizacion,
       (SELECT count(*) FROM users u WHERE u.organization_id = o.id) AS usuarios,
       (SELECT string_agg(s.name, ', ') FROM seasons s WHERE s.organization_id = o.id) AS temporadas,
       (SELECT count(*) FROM functions f JOIN seasons s ON s.id = f.season_id WHERE s.organization_id = o.id) AS funciones
FROM organizations o WHERE NOT o.is_demo;

COMMIT;
