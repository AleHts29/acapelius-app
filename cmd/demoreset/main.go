// Command demoreset borra y vuelve a sembrar la organizacion demo
// (`make demo-reset`). Es lo mismo que corre el job nocturno del server.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db"
	"github.com/ale-hts/acapelius/internal/demo"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "demo-reset:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	loc, err := time.LoadLocation(cfg.TZ)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	id, err := demo.Reset(ctx, pool, loc)
	if err != nil {
		return err
	}
	fmt.Printf("Demo reiniciada (organizacion %d).\n", id)
	return nil
}
