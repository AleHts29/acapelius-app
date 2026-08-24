// Package config carga la configuracion del proceso desde variables de entorno.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// EmailDriver identifica el transporte de email en uso.
type EmailDriver string

const (
	EmailDriverLog    EmailDriver = "log"
	EmailDriverResend EmailDriver = "resend"
)

// Config es la configuracion completa del server. Se carga una vez al arrancar.
type Config struct {
	Port         int
	BaseURL      string
	DatabaseURL  string
	ServerSecret []byte
	EmailDriver  EmailDriver
	ResendAPIKey string
	EmailFrom    string
	TZ           string
	AutoMigrate  bool
	Env          string // "development" | "production"
}

// minSecretLen es el minimo aceptable para SERVER_SECRET: firma los QR y las
// cookies de sesion, un secreto corto degrada las dos cosas a la vez.
const minSecretLen = 32

// Load lee el entorno y valida lo que no puede faltar. Devuelve todos los
// problemas juntos para no obligar a arreglarlos de a uno.
func Load() (*Config, error) {
	var problems []string

	cfg := &Config{
		BaseURL:      strings.TrimSuffix(getenv("BASE_URL", "http://localhost:5173"), "/"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		ServerSecret: []byte(os.Getenv("SERVER_SECRET")),
		EmailDriver:  EmailDriver(getenv("EMAIL_DRIVER", string(EmailDriverLog))),
		ResendAPIKey: os.Getenv("RESEND_API_KEY"),
		EmailFrom:    getenv("EMAIL_FROM", "Acapelius <entradas@example.com>"),
		TZ:           getenv("TZ", "America/Argentina/Buenos_Aires"),
		Env:          getenv("APP_ENV", "development"),
	}

	port, err := strconv.Atoi(getenv("PORT", "8080"))
	if err != nil || port <= 0 || port > 65535 {
		problems = append(problems, "PORT debe ser un numero de puerto valido")
	}
	cfg.Port = port

	autoMigrate, err := strconv.ParseBool(getenv("AUTO_MIGRATE", "true"))
	if err != nil {
		problems = append(problems, "AUTO_MIGRATE debe ser true o false")
	}
	cfg.AutoMigrate = autoMigrate

	if cfg.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL es obligatoria")
	}
	if len(cfg.ServerSecret) < minSecretLen {
		problems = append(problems, fmt.Sprintf("SERVER_SECRET es obligatoria y necesita al menos %d bytes (openssl rand -hex 32)", minSecretLen))
	}

	switch cfg.EmailDriver {
	case EmailDriverLog:
	case EmailDriverResend:
		if cfg.ResendAPIKey == "" {
			problems = append(problems, "RESEND_API_KEY es obligatoria cuando EMAIL_DRIVER=resend")
		}
	default:
		problems = append(problems, "EMAIL_DRIVER debe ser 'log' o 'resend'")
	}

	if len(problems) > 0 {
		return nil, fmt.Errorf("configuracion invalida:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return cfg, nil
}

// IsProduction indica si hay que endurecer defaults (cookies Secure, etc).
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

// UsesTLS informa si BASE_URL apunta a https, lo que habilita cookies Secure.
func (c *Config) UsesTLS() bool {
	return strings.HasPrefix(c.BaseURL, "https://")
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
