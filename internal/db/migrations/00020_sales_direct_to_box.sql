-- Ventas de direccion (C22): lo que vende y cobra un admin ya esta en la caja
-- del coro, no hay a quien rendirselo. direct_to_box se fija al crear la
-- venta segun el rol del vendedor en la temporada EN ESE MOMENTO: si una
-- corista despues pasa a direccion, lo que vendio como corista lo sigue
-- debiendo.

-- +goose Up

ALTER TABLE sales ADD COLUMN direct_to_box BOOLEAN NOT NULL DEFAULT false;

-- Las ventas viejas toman el rol actual del vendedor en esa temporada: es lo
-- unico que hay, y hoy un admin aparece debiendose a si mismo.
UPDATE sales s SET direct_to_box = true
FROM functions f, season_members m
WHERE f.id = s.function_id
  AND m.season_id = f.season_id
  AND m.user_id = s.seller_id
  AND m.role = 'admin';

-- +goose Down

ALTER TABLE sales DROP COLUMN direct_to_box;
