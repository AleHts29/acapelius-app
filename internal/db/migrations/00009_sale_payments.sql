-- Cobros parciales. Antes una venta estaba paga o no: si el comprador dejaba
-- una seña, la corista no tenia donde anotarla y la venta figuraba debiendo
-- todo. Ahora cada cobro es un registro con monto, metodo y fecha —el mismo
-- modelo que las rendiciones—, y la venta guarda cuanto lleva cobrado.
--
-- sales.paid_cents es cache de SUM(sale_payments.amount_cents), igual que
-- payment_status: se recalcula entero (nunca se incrementa) en la misma
-- transaccion que el cobro. Tenerlo en la fila deja todos los reportes de
-- plata en una suma simple, sin un join extra en cada consulta.

-- +goose Up
CREATE TABLE sale_payments (
  id           BIGSERIAL PRIMARY KEY,
  sale_id      BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'transfer')),
  user_id      BIGINT NOT NULL REFERENCES users(id), -- quien lo registro
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sale_payments_sale_id_idx ON sale_payments (sale_id);

ALTER TABLE sales ADD COLUMN paid_cents BIGINT NOT NULL DEFAULT 0;

-- Lo ya cobrado se convierte en un cobro por el total, con la fecha de la
-- venta: es lo mas cercano a la verdad que hay, no se guardaba fecha de cobro.
INSERT INTO sale_payments (sale_id, amount_cents, method, user_id, created_at)
SELECT s.id, s.amount_cents, COALESCE(s.payment_method, 'cash'), s.seller_id, s.created_at
FROM sales s
WHERE s.payment_status = 'paid' AND NOT s.is_comp AND s.amount_cents > 0;

UPDATE sales s
SET paid_cents = COALESCE((SELECT SUM(p.amount_cents) FROM sale_payments p WHERE p.sale_id = s.id), 0);

-- +goose Down
ALTER TABLE sales DROP COLUMN paid_cents;
DROP TABLE sale_payments;
