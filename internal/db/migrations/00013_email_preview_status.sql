-- En la demo no sale ningun mail (C17 §C): el envio queda registrado como
-- 'preview', que la app muestra como "sin envio" y no como fallo.

-- +goose Up
ALTER TABLE email_sends DROP CONSTRAINT email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check CHECK (status IN ('sent', 'failed', 'preview'));
ALTER TABLE settlement_reminders DROP CONSTRAINT settlement_reminders_status_check;
ALTER TABLE settlement_reminders ADD CONSTRAINT settlement_reminders_status_check CHECK (status IN ('sent', 'failed', 'preview'));

-- +goose Down
DELETE FROM email_sends WHERE status = 'preview';
DELETE FROM settlement_reminders WHERE status = 'preview';
ALTER TABLE email_sends DROP CONSTRAINT email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check CHECK (status IN ('sent', 'failed'));
ALTER TABLE settlement_reminders DROP CONSTRAINT settlement_reminders_status_check;
ALTER TABLE settlement_reminders ADD CONSTRAINT settlement_reminders_status_check CHECK (status IN ('sent', 'failed'));
