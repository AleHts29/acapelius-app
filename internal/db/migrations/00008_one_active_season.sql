-- La temporada "en curso" era, en los hechos, la ultima creada: is_active
-- existia pero no lo leia ni lo escribia nadie, y crear una temporada nueva
-- dejaba dos activas. Inicio y Rendiciones tomaban la mas nueva y mostraban
-- $0 con plata sin rendir en la base. Esto normaliza lo que ya haya cargado:
-- queda activa una sola, la mas nueva.

-- +goose Up
UPDATE seasons SET is_active = FALSE
WHERE is_active
  AND id <> (SELECT id FROM seasons ORDER BY created_at DESC, id DESC LIMIT 1);

-- +goose Down
-- No hay vuelta atras util: el estado anterior era justamente el inconsistente.
SELECT 1;
