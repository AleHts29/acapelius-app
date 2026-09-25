# Acapelius — tareas de desarrollo.
# `make help` lista todo.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# --- Toolchain --------------------------------------------------------------
# GOTOOLCHAIN=auto hace que cualquier Go >= 1.21 del PATH baje y use la version
# que pide go.mod. Asi el proyecto no depende de que gvm/asdf apunten al Go
# correcto. GOROOT queda fuera del entorno por el mismo motivo.
export GOTOOLCHAIN := auto
unexport GOROOT

GO       := go
BIN      := $(CURDIR)/bin
SQLC     := $(BIN)/sqlc
GOOSE    := $(BIN)/goose
SQLC_VERSION  := v1.30.0
GOOSE_VERSION := v3.26.0

# Node: si el del PATH es viejo, se usa uno mas nuevo de nvm/homebrew.
NODE_BIN  := $(shell ./scripts/node-path.sh)
WEB_PATH  := $(if $(NODE_BIN),$(NODE_BIN):$(PATH),$(PATH))
NPM       := PATH="$(WEB_PATH)" npm --prefix web

# --- Config -----------------------------------------------------------------
ENV_FILE := .env
# Carga .env en el entorno de las recetas que lo necesitan.
LOAD_ENV := set -a && [ -f $(ENV_FILE) ] && source $(ENV_FILE); set +a

TEST_DB_URL := postgres://acapelius:acapelius@localhost:5433/acapelius_test?sslmode=disable

MIGRATIONS := internal/db/migrations

.PHONY: help
help: ## Muestra esta ayuda
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- Setup ------------------------------------------------------------------

$(ENV_FILE):
	@cp .env.example $(ENV_FILE)
	@echo "Creado $(ENV_FILE) a partir de .env.example."

.PHONY: setup
setup: $(ENV_FILE) tools web-install ## Deja el repo listo para trabajar
	@echo "Listo. Corre 'make dev'."

.PHONY: tools
tools: $(SQLC) $(GOOSE) ## Instala sqlc y goose en ./bin

$(SQLC):
	GOBIN=$(BIN) $(GO) install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)

$(GOOSE):
	GOBIN=$(BIN) $(GO) install github.com/pressly/goose/v3/cmd/goose@$(GOOSE_VERSION)

.PHONY: web-install
web-install: ## Instala las dependencias del frontend
	@$(NPM) install

# --- Base de datos ----------------------------------------------------------

.PHONY: db-up
db-up: ## Levanta Postgres 16 y espera a que responda
	@docker compose up -d postgres
	@printf "Esperando a Postgres"
	@until docker compose exec -T postgres pg_isready -U acapelius -d acapelius >/dev/null 2>&1; do \
		printf "."; sleep 1; \
	done
	@echo " listo."

.PHONY: db-down
db-down: ## Apaga Postgres (conserva los datos)
	@docker compose down

.PHONY: db-reset
db-reset: ## Borra la base y la vuelve a crear vacia
	@docker compose down -v
	@$(MAKE) db-up migrate seed

.PHONY: db-shell
db-shell: ## Abre psql contra la base de desarrollo
	@docker compose exec postgres psql -U acapelius -d acapelius

BACKUP_DIR := backups

.PHONY: db-backup
db-backup: ## Dump comprimido de la base local a backups/
	@mkdir -p $(BACKUP_DIR)
	@docker compose exec -T postgres pg_dump -U acapelius -Fc acapelius \
		> $(BACKUP_DIR)/acapelius-$$(date +%Y%m%d-%H%M%S).dump
	@ls -lh $(BACKUP_DIR)/*.dump | tail -1

.PHONY: db-restore-check
db-restore-check: ## Restaura el ultimo backup en una base descartable y lo verifica
	@latest=$$(ls -t $(BACKUP_DIR)/*.dump 2>/dev/null | head -1); \
	test -n "$$latest" || { echo "No hay backups en $(BACKUP_DIR)/. Corre 'make db-backup'."; exit 1; }; \
	echo "Restaurando $$latest en acapelius_restore_check..."; \
	docker compose exec -T postgres psql -U acapelius -d postgres \
		-c "DROP DATABASE IF EXISTS acapelius_restore_check" >/dev/null; \
	docker compose exec -T postgres psql -U acapelius -d postgres \
		-c "CREATE DATABASE acapelius_restore_check" >/dev/null; \
	docker compose exec -T postgres pg_restore -U acapelius -d acapelius_restore_check --no-owner < "$$latest"; \
	docker compose exec -T postgres psql -U acapelius -d acapelius_restore_check -At -c \
		"SELECT 'usuarios: ' || count(*) FROM users UNION ALL \
		 SELECT 'ventas: '   || count(*) FROM sales UNION ALL \
		 SELECT 'tickets: '  || count(*) FROM tickets UNION ALL \
		 SELECT 'ingresos: ' || count(*) FROM checkins"; \
	docker compose exec -T postgres psql -U acapelius -d postgres \
		-c "DROP DATABASE acapelius_restore_check" >/dev/null; \
	echo "Restore verificado OK."

.PHONY: migrate
migrate: $(GOOSE) ## Aplica las migraciones pendientes
	@$(LOAD_ENV); $(GOOSE) -dir $(MIGRATIONS) postgres "$$DATABASE_URL" up

.PHONY: migrate-down
migrate-down: $(GOOSE) ## Revierte la ultima migracion
	@$(LOAD_ENV); $(GOOSE) -dir $(MIGRATIONS) postgres "$$DATABASE_URL" down

.PHONY: migrate-status
migrate-status: $(GOOSE) ## Muestra el estado de las migraciones
	@$(LOAD_ENV); $(GOOSE) -dir $(MIGRATIONS) postgres "$$DATABASE_URL" status

.PHONY: migrate-new
migrate-new: $(GOOSE) ## Crea una migracion vacia: make migrate-new name=add_sales
	@test -n "$(name)" || (echo "Falta el nombre: make migrate-new name=add_sales" && exit 1)
	@$(GOOSE) -dir $(MIGRATIONS) -s create $(name) sql

.PHONY: sqlc
sqlc: $(SQLC) ## Regenera el codigo de las queries
	@$(SQLC) generate

.PHONY: seed
seed: ## Crea el primer admin si la base esta vacia
	@$(LOAD_ENV); $(GO) run ./cmd/seed

.PHONY: demo-reset
demo-reset: ## Borra y vuelve a sembrar la organizacion demo (lo mismo que el job nocturno)
	@$(GO) run ./cmd/demoreset

# --- Desarrollo -------------------------------------------------------------

.PHONY: dev
dev: $(ENV_FILE) db-up ## Levanta todo: Postgres, API y frontend
	@$(MAKE) --no-print-directory seed
	@$(LOAD_ENV); \
		echo ""; \
		echo "  API      http://localhost:$$PORT/api/health"; \
		echo "  Frontend http://localhost:5173/app/"; \
		echo ""; \
		trap 'kill 0' EXIT INT TERM; \
		$(GO) run ./cmd/server & \
		VITE_API_TARGET="http://localhost:$$PORT" $(NPM) run dev & \
		wait

.PHONY: dev-api
dev-api: ## Corre solo la API
	@$(LOAD_ENV); $(GO) run ./cmd/server

.PHONY: dev-web
dev-web: ## Corre solo el frontend (Vite)
	@$(LOAD_ENV); VITE_API_TARGET="http://localhost:$$PORT" $(NPM) run dev

# --- Calidad ----------------------------------------------------------------

.PHONY: test
test: ## Tests unitarios (no necesitan Postgres)
	@$(GO) test ./...

.PHONY: test-integration
test-integration: db-up ## Tests contra un Postgres real
	@docker compose exec -T postgres psql -U acapelius -d postgres \
		-c "DROP DATABASE IF EXISTS acapelius_test" >/dev/null
	@docker compose exec -T postgres psql -U acapelius -d postgres \
		-c "CREATE DATABASE acapelius_test" >/dev/null
	@TEST_DATABASE_URL="$(TEST_DB_URL)" $(GO) test -count=1 ./...

.PHONY: test-web
test-web: ## Tests del frontend
	@$(NPM) test

.PHONY: fmt
fmt: ## Formatea el codigo Go
	@$(GO) fmt ./...

.PHONY: vet
vet: ## Analisis estatico de Go
	@$(GO) vet ./...

.PHONY: typecheck
typecheck: ## Chequea los tipos del frontend
	@$(NPM) run typecheck

.PHONY: check
check: fmt vet test typecheck ## Todo lo rapido, antes de commitear

# --- Build ------------------------------------------------------------------

.PHONY: web-build
web-build: ## Compila el frontend a web/dist
	@$(NPM) run build

.PHONY: build
build: web-build ## Compila el binario con el frontend adentro
	@mkdir -p $(BIN)
	@CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o $(BIN)/acapelius ./cmd/server
	@echo "Binario en $(BIN)/acapelius"

.PHONY: clean
clean: ## Borra artefactos de build
	@rm -rf $(BIN)/acapelius web/dist/* web/node_modules/.vite
	@touch web/dist/.gitkeep
