-- +goose Up

CREATE TABLE sales (
  id             BIGSERIAL PRIMARY KEY,
  function_id    BIGINT NOT NULL REFERENCES functions(id),
  seller_id      BIGINT NOT NULL REFERENCES users(id),
  code           TEXT NOT NULL UNIQUE,   -- token no adivinable para /e/{code}
  buyer_name     TEXT NOT NULL,
  buyer_email    TEXT,                   -- nullable: puede no tener email
  buyer_phone    TEXT,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  amount_cents   BIGINT NOT NULL CHECK (amount_cents >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'transfer')),
  is_comp        BOOLEAN NOT NULL DEFAULT FALSE,
  notes          TEXT,
  voided_at      TIMESTAMPTZ,            -- anulacion de la venta completa
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sales_function_id_idx ON sales (function_id);
CREATE INDEX sales_seller_id_idx ON sales (seller_id);

CREATE TABLE tickets (
  id         BIGSERIAL PRIMARY KEY,
  sale_id    BIGINT NOT NULL REFERENCES sales(id),
  code       TEXT NOT NULL UNIQUE,       -- ULID; identidad publica del ticket
  status     TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'checked_in', 'void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tickets_sale_id_idx ON tickets (sale_id);

-- Registro de envios para poder responder "no me llego" con datos.
CREATE TABLE email_sends (
  id         BIGSERIAL PRIMARY KEY,
  sale_id    BIGINT NOT NULL REFERENCES sales(id),
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_sends_sale_id_idx ON email_sends (sale_id);

-- +goose Down

DROP TABLE email_sends;
DROP TABLE tickets;
DROP TABLE sales;
