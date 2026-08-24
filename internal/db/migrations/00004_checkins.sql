-- +goose Up

CREATE TABLE checkins (
  id         BIGSERIAL PRIMARY KEY,
  -- UNIQUE es el ancla de idempotencia: un ticket entra una sola vez, y el
  -- sync offline de la fase 4 se apoya en el mismo conflicto.
  ticket_id  BIGINT NOT NULL UNIQUE REFERENCES tickets(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),  -- quien registro el ingreso
  method     TEXT NOT NULL CHECK (method IN ('scan', 'manual')),
  device_id  TEXT,                                  -- dedupe del sync offline
  created_at TIMESTAMPTZ NOT NULL                   -- momento real del ingreso
);

-- +goose Down

DROP TABLE checkins;
