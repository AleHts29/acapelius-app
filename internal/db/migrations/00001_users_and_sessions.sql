-- +goose Up

CREATE TABLE users (
  id                   BIGSERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'door')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El login es case-insensitive, asi que la unicidad tambien tiene que serlo.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Store de sesiones para alexedwards/scs (pgxstore).
CREATE TABLE sessions (
  token  TEXT PRIMARY KEY,
  data   BYTEA NOT NULL,
  expiry TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_expiry_idx ON sessions (expiry);

-- +goose Down

DROP TABLE sessions;
DROP TABLE users;
