-- +goose Up

-- Baja logica de usuarios: una corista que deja el coro no se borra (sus
-- ventas la referencian), se desactiva y no puede entrar mas.
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Asignaciones: cuantas entradas le toca vender a cada corista por funcion.
-- Es un objetivo de venta, no un limite duro: el cupo de la funcion sigue
-- siendo el unico tope real.
CREATE TABLE allocations (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  function_id BIGINT NOT NULL REFERENCES functions(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, function_id)
);

CREATE INDEX allocations_function_idx ON allocations (function_id);

-- +goose Down

DROP TABLE allocations;
ALTER TABLE users DROP COLUMN is_active;
