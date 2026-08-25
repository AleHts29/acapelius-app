// Command server es el binario de Acapelius: API, frontend embebido y
// migraciones en un unico proceso.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // zona horaria embebida: el container no necesita tzdata

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db"
	httpapi "github.com/ale-hts/acapelius/internal/http"
	"github.com/ale-hts/acapelius/internal/mail"
	"github.com/ale-hts/acapelius/internal/qr"
	"github.com/ale-hts/acapelius/web"
)

// shutdownTimeout es cuanto se espera a que terminen los requests en curso
// antes de cortar. En la puerta, un check-in a medio guardar es peor que
// esperar unos segundos mas.
const shutdownTimeout = 15 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("el server no pudo arrancar", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	setupLogger(cfg)

	// Todo lo que se muestre en pantallas y emails va en hora de Buenos Aires.
	if loc, err := time.LoadLocation(cfg.TZ); err == nil {
		time.Local = loc
	} else {
		slog.Warn("zona horaria desconocida, se usa la del sistema", "tz", cfg.TZ, "error", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	slog.Info("conectado a Postgres")

	if cfg.AutoMigrate {
		if err := db.Migrate(ctx, pool); err != nil {
			return err
		}
		slog.Info("migraciones al dia")
	}

	sessions := auth.NewSessionManager(pool, cfg)
	authService := auth.NewService(pool, sessions)

	signer := qr.NewSigner(cfg.ServerSecret)
	var mailer mail.Driver
	switch cfg.EmailDriver {
	case config.EmailDriverResend:
		mailer = mail.NewResendDriver(cfg.ResendAPIKey, cfg.EmailFrom)
	case config.EmailDriverSMTP:
		mailer = mail.NewSMTPDriver(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.EmailFrom)
	default:
		mailer = mail.NewLogDriver(os.Stdout)
	}

	api := httpapi.New(cfg, pool, authService, signer, mailer)

	srv := &http.Server{
		Addr:              net.JoinHostPort("", fmt.Sprintf("%d", cfg.Port)),
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("escuchando",
			"addr", srv.Addr,
			"base_url", cfg.BaseURL,
			"email_driver", string(cfg.EmailDriver),
			"frontend_embebido", web.HasBuild(),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("servidor HTTP: %w", err)
	case <-ctx.Done():
		slog.Info("apagando")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("apagado ordenado: %w", err)
	}
	return nil
}

func setupLogger(cfg *config.Config) {
	var handler slog.Handler
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if cfg.IsProduction() {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(handler))
}
