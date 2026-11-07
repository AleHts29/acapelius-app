-- La foto de perfil (C21). Va en su propia tabla y no en users: las consultas
-- de usuario (la sesion se carga en cada request) no tienen que arrastrar la
-- imagen. La app la achica a 256x256 antes de subirla: son pocos KB.

-- +goose Up

CREATE TABLE user_avatars (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  image        BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down

DROP TABLE user_avatars;
