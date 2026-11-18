-- Donde queda el teatro y el link corto de las entradas.
--
-- address y maps_url son opcionales: el mail y el WhatsApp muestran la
-- direccion y el "Como llegar" a Google Maps solo si la funcion los tiene.
--
-- El link corto (/k/XXXXXXXX) son los ultimos 8 caracteres del codigo de la
-- venta: la parte aleatoria del ULID (40 bits). WhatsApp no deja ponerle
-- nombre a un link, asi que al menos que sea corto. El indice unico garantiza
-- que un link corto lleve a una sola venta.

-- +goose Up

ALTER TABLE functions ADD COLUMN address TEXT;
ALTER TABLE functions ADD COLUMN maps_url TEXT;

CREATE UNIQUE INDEX sales_short_code_idx ON sales (right(code, 8));

-- +goose Down

DROP INDEX sales_short_code_idx;
ALTER TABLE functions DROP COLUMN maps_url;
ALTER TABLE functions DROP COLUMN address;
