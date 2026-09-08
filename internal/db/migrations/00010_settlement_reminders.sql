-- Recordatorios de rendicion. Hasta ahora no habia forma de reclamar desde la
-- app: dirección veia la deuda y tenia que salir a escribir por otro lado. Se
-- guarda cada envio para poder decir "ya se le recordo hace 3 dias" y no
-- mandar tres recordatorios el mismo dia sin darse cuenta.

-- +goose Up
CREATE TABLE settlement_reminders (
  id         BIGSERIAL PRIMARY KEY,
  seller_id  BIGINT NOT NULL REFERENCES users(id),
  season_id  BIGINT NOT NULL REFERENCES seasons(id),
  -- Quien lo mando: siempre direccion, pero queda el rastro de quien fue.
  sent_by    BIGINT NOT NULL REFERENCES users(id),
  -- Cuanto debia en ese momento: el recordatorio dice un numero y despues la
  -- deuda cambia; sin esto el historial no se puede leer.
  amount_cents BIGINT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX settlement_reminders_seller_idx ON settlement_reminders (seller_id, season_id);

-- +goose Down
DROP TABLE settlement_reminders;
