-- +goose Up

-- Rendiciones: plata que una vendedora le entrega a Eli. Son montos libres
-- (parciales), no se atan venta por venta (spec §4). El saldo a rendir se
-- calcula: ventas pagas no-cortesia no-anuladas de la temporada − rendido.
CREATE TABLE settlements (
  id           BIGSERIAL PRIMARY KEY,
  seller_id    BIGINT NOT NULL REFERENCES users(id),
  season_id    BIGINT NOT NULL REFERENCES seasons(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'transfer')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX settlements_seller_season_idx ON settlements (seller_id, season_id);

-- +goose Down

DROP TABLE settlements;
