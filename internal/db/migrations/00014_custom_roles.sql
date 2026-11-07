-- Roles propios de cada organizacion (C21): un nombre que elige direccion
-- ("Acomodador", "Tesoreria") con los permisos de uno de los tres de base.
-- Los permisos siguen saliendo de season_members.role: el rol propio solo
-- le pone nombre. Borrar un rol no le saca el acceso a nadie: vuelve a
-- mostrarse el nombre del rol de base.

-- +goose Up

CREATE TABLE custom_roles (
  id              BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  base_role       TEXT NOT NULL CHECK (base_role IN ('admin', 'seller', 'door')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_roles_org_name_key ON custom_roles (organization_id, lower(name));

ALTER TABLE season_members
  ADD COLUMN custom_role_id BIGINT REFERENCES custom_roles(id) ON DELETE SET NULL;

-- +goose Down

ALTER TABLE season_members DROP COLUMN custom_role_id;
DROP TABLE custom_roles;
