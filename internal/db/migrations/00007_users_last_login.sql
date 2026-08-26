-- +goose Up

-- Ultimo ingreso: distingue a quien todavia no entro nunca ("invitacion
-- pendiente", C7) de quien ya usa la app. `must_change_password` no alcanza:
-- tambien queda en true despues de un reseteo de contrasena.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;

-- +goose Down

ALTER TABLE users DROP COLUMN last_login_at;
