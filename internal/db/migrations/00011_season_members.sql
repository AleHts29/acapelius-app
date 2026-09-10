-- Quien es una persona y quien participa de una temporada son dos cosas
-- distintas. Hasta aca vivian juntas en users.role + users.is_active, y eso
-- no permitia decir "Norma canto en 2025 pero no en 2026": desactivarla la
-- borraba tambien del año en que si vendio.
--
-- users pasa a guardar identidad y credenciales, para siempre.
-- season_members dice quien esta en cada temporada y con que rol.
--
-- Las ventas y las asignaciones ya cuelgan de funciones, que cuelgan de
-- temporadas, asi que el historico queda intacto sin tocar nada mas.

-- +goose Up

CREATE TABLE season_members (
  id        BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'door')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = sigue. Con fecha = dejo el coro a mitad de temporada: no vende
  -- mas, pero sus ventas y su deuda de rendicion siguen contando.
  left_at   TIMESTAMPTZ,
  UNIQUE (season_id, user_id)
);

CREATE INDEX season_members_season_idx ON season_members (season_id);
CREATE INDEX season_members_user_idx ON season_members (user_id);

-- 1. Quien tuvo actividad en una temporada, participo de esa temporada. Es la
--    parte que arregla el historico: una corista desactivada hoy vuelve a
--    aparecer en los años en los que vendio.
INSERT INTO season_members (season_id, user_id, role, joined_at)
SELECT DISTINCT f.season_id, s.seller_id, u.role, u.created_at
FROM sales s
JOIN functions f ON s.function_id = f.id
JOIN users u ON u.id = s.seller_id
ON CONFLICT (season_id, user_id) DO NOTHING;

INSERT INTO season_members (season_id, user_id, role, joined_at)
SELECT DISTINCT f.season_id, a.user_id, u.role, u.created_at
FROM allocations a
JOIN functions f ON a.function_id = f.id
JOIN users u ON u.id = a.user_id
ON CONFLICT (season_id, user_id) DO NOTHING;

INSERT INTO season_members (season_id, user_id, role, joined_at)
SELECT DISTINCT st.season_id, st.seller_id, u.role, u.created_at
FROM settlements st
JOIN users u ON u.id = st.seller_id
ON CONFLICT (season_id, user_id) DO NOTHING;

-- 2. La temporada en curso se lleva a todo el que hoy esta activo, tenga o no
--    actividad todavia: es exactamente el equipo de ahora.
INSERT INTO season_members (season_id, user_id, role, joined_at)
SELECT se.id, u.id, u.role, u.created_at
FROM seasons se, users u
WHERE se.is_active AND u.is_active
ON CONFLICT (season_id, user_id) DO NOTHING;

-- Quien estaba desactivado no entra en la temporada en curso: queda como "no
-- participa de esta temporada", que es lo que era, pero conservando su
-- historial en las temporadas donde si estuvo.

ALTER TABLE users DROP COLUMN role;
ALTER TABLE users DROP COLUMN is_active;

-- +goose Down

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'seller'
  CHECK (role IN ('admin', 'seller', 'door'));
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Se reconstruye desde la temporada en curso, que es de donde salio.
UPDATE users u SET
  role = COALESCE((SELECT m.role FROM season_members m
                   JOIN seasons s ON s.id = m.season_id
                   WHERE m.user_id = u.id AND s.is_active), 'seller'),
  is_active = EXISTS (SELECT 1 FROM season_members m
                      JOIN seasons s ON s.id = m.season_id
                      WHERE m.user_id = u.id AND s.is_active AND m.left_at IS NULL);

DROP TABLE season_members;
