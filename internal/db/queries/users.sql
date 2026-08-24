-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE lower(email) = lower(sqlc.arg(email)::text);

-- name: ListUsers :many
SELECT * FROM users ORDER BY role, name;

-- name: CreateUser :one
INSERT INTO users (name, email, password_hash, role, must_change_password)
VALUES (
  sqlc.arg(name)::text,
  sqlc.arg(email)::text,
  sqlc.arg(password_hash)::text,
  sqlc.arg(role)::text,
  sqlc.arg(must_change_password)::boolean
)
RETURNING *;

-- name: SetUserPassword :exec
UPDATE users
SET password_hash = sqlc.arg(password_hash)::text,
    must_change_password = sqlc.arg(must_change_password)::boolean
WHERE id = sqlc.arg(id)::bigint;

-- name: CountUsers :one
SELECT count(*) FROM users;
