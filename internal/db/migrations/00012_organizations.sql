-- Acapelius deja de ser la app de un coro: cada grupo es una organizacion y
-- todo lo que tiene dueño cuelga de ella (C17 §A).
--
-- Llevan organization_id solo users y seasons. El resto —functions, sales,
-- tickets, checkins, allocations, season_members, settlements, sale_payments,
-- settlement_reminders, email_sends— cuelga por FK de una de esas dos y se
-- filtra por join. Un join a seasons es barato y no duplica la verdad.

-- +goose Up

CREATE TABLE organizations (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'choir' CHECK (kind IN ('choir', 'theatre', 'other')),
  slug       TEXT NOT NULL UNIQUE,
  is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los datos de hoy son de un solo coro: el UPDATE no tiene ambiguedad. En
-- una base vacia (instalacion nueva, tests) no se crea nada: la organizacion
-- la crea el seed o el alta de cuenta.
INSERT INTO organizations (name, kind, slug)
SELECT 'Coro Acapelius', 'choir', 'acapelius'
WHERE EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM seasons);

ALTER TABLE users   ADD COLUMN organization_id BIGINT REFERENCES organizations(id);
ALTER TABLE seasons ADD COLUMN organization_id BIGINT REFERENCES organizations(id);

UPDATE users   SET organization_id = (SELECT id FROM organizations WHERE slug = 'acapelius');
UPDATE seasons SET organization_id = (SELECT id FROM organizations WHERE slug = 'acapelius');

ALTER TABLE users   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE seasons ALTER COLUMN organization_id SET NOT NULL;

-- El email es unico POR organizacion, no global: la misma persona puede
-- cantar en dos grupos.
DROP INDEX users_email_lower_key;
CREATE UNIQUE INDEX users_org_email_lower_key ON users (organization_id, lower(email));

CREATE INDEX users_organization_idx   ON users (organization_id);
CREATE INDEX seasons_organization_idx ON seasons (organization_id);

-- Una sola temporada en curso por organizacion, garantizado por la base y no
-- solo por el handler.
CREATE UNIQUE INDEX seasons_one_active_per_org ON seasons (organization_id) WHERE is_active;

-- +goose Down

DROP INDEX seasons_one_active_per_org;
DROP INDEX seasons_organization_idx;
DROP INDEX users_organization_idx;
DROP INDEX users_org_email_lower_key;
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
ALTER TABLE seasons DROP COLUMN organization_id;
ALTER TABLE users   DROP COLUMN organization_id;
DROP TABLE organizations;
