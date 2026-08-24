-- +goose Up

CREATE TABLE seasons (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE functions (
  id          BIGSERIAL PRIMARY KEY,
  season_id   BIGINT NOT NULL REFERENCES seasons(id),
  name        TEXT,                              -- opcional, ej. "Funcion de gala"
  venue       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX functions_season_id_idx ON functions (season_id);

-- +goose Down

DROP TABLE functions;
DROP TABLE seasons;
