-- Sobre cupo (C21): con la funcion agotada, direccion puede vender igual. La
-- venta queda marcada para que se vea que es por encima de la capacidad.

-- +goose Up

ALTER TABLE sales ADD COLUMN over_capacity BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down

ALTER TABLE sales DROP COLUMN over_capacity;
