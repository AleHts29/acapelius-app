-- A quien se le reparten entradas (C22): cada funcion elige los roles que
-- reciben cupo. Hasta aca era fijo "coristas"; ahora direccion puede sumarse
-- (o sumar un rol propio) o dejar el reparto solo para algunos.
--
-- allocation_roles guarda claves: 'seller', 'admin', o 'custom:<id>' para un
-- rol propio. NULL = lo de siempre: todo el que vende con rol de corista
-- (incluidos sus roles propios). Puerta no vende, asi que nunca entra.

-- +goose Up

ALTER TABLE functions ADD COLUMN allocation_roles TEXT[];

-- cupo_habilitado: la regla en un solo lugar, para que el tablero, la suma
-- que se valida y el chequeo de la venta cuenten exactamente lo mismo.
-- Quien tiene un rol propio entra por ese rol, no por el de base.
-- +goose StatementBegin
CREATE FUNCTION cupo_habilitado(roles TEXT[], rol TEXT, custom_role BIGINT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN rol = 'door' THEN FALSE
    WHEN roles IS NULL THEN rol = 'seller'
    WHEN custom_role IS NOT NULL THEN ('custom:' || custom_role::text) = ANY(roles)
    ELSE rol = ANY(roles)
  END
$$;
-- +goose StatementEnd

-- +goose Down

DROP FUNCTION cupo_habilitado(TEXT[], TEXT, BIGINT);
ALTER TABLE functions DROP COLUMN allocation_roles;
