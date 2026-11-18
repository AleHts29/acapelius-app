-- Que lista tiene cada celular de la puerta. Cada vez que un dispositivo baja
-- la lista de una funcion se anota cuando. Asi, si direccion mueve una venta
-- el dia de la funcion, sabe si la puerta ya tiene el cambio o si hay que
-- avisarle que busque senal y actualice.

-- +goose Up

CREATE TABLE door_devices (
  function_id      BIGINT NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  device_id        TEXT NOT NULL,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_snapshot_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (function_id, device_id)
);

-- +goose Down

DROP TABLE door_devices;
