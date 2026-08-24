// Command seed crea el primer usuario admin. Es idempotente: si ya hay
// usuarios en la base, no hace nada.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("seed fallido", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	queries := sqlcgen.New(pool)
	count, err := queries.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("contar usuarios: %w", err)
	}
	if count > 0 {
		slog.Info("ya hay usuarios cargados, no se hace nada", "usuarios", count)
		return nil
	}

	name := getenv("SEED_ADMIN_NAME", "Eli")
	email := getenv("SEED_ADMIN_EMAIL", "eli@acapelius.local")
	password := os.Getenv("SEED_ADMIN_PASSWORD")

	generated := false
	if password == "" {
		if password, err = auth.GenerateTempPassword(); err != nil {
			return err
		}
		generated = true
	}
	if err := domain.ValidatePassword(password); err != nil {
		return fmt.Errorf("SEED_ADMIN_PASSWORD: %w", err)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}

	user, err := queries.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name:               name,
		Email:              domain.NormalizeEmail(email),
		PasswordHash:       hash,
		Role:               string(domain.RoleAdmin),
		MustChangePassword: true,
	})
	if err != nil {
		return errors.Join(errors.New("crear admin"), err)
	}

	fmt.Printf("\n  Admin creado\n  ------------\n  email:      %s\n  contrasena: %s\n", user.Email, password)
	if generated {
		fmt.Print("  (generada al azar; anotala, no se vuelve a mostrar)\n")
	}
	fmt.Print("  Se pide cambiarla en el primer ingreso.\n\n")
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
