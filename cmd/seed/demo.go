package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
)

// demoPassword es la contrasena de todas las cuentas de demo (ya "cambiada":
// no pide renovarla, para poder entrar directo a mirar).
const demoPassword = "acapelius-demo"

// seedDemo carga una temporada realista para recorrer el panel: funciones con
// distinto grado de venta, vendedoras con pagos parciales, cortesias, una
// funcion "de anoche" con ingresos, y una rendicion parcial. Idempotente: si
// ya hay temporadas no hace nada.
func seedDemo(ctx context.Context, queries *sqlcgen.Queries) error {
	seasons, err := queries.ListSeasons(ctx)
	if err != nil {
		return fmt.Errorf("listar temporadas: %w", err)
	}
	if len(seasons) > 0 {
		slog.Info("ya hay temporadas, no se carga la demo")
		return nil
	}

	season, err := queries.CreateSeason(ctx, "Temporada 2026")
	if err != nil {
		return err
	}

	// Funciones: una "anoche" (con ingresos), una hoy y dos por venir.
	now := time.Now()
	at := func(days int) time.Time {
		d := now.AddDate(0, 0, days)
		return time.Date(d.Year(), d.Month(), d.Day(), 21, 0, 0, 0, time.Local)
	}
	functionSpecs := []struct {
		name string
		when time.Time
	}{
		{"Funcion de apertura", at(-1)}, // anoche: tiene asistencia
		{"", at(0)},
		{"Funcion de gala", at(7)},
		{"Cierre de temporada", at(8)},
	}
	functions := make([]sqlcgen.Function, 0, len(functionSpecs))
	for _, spec := range functionSpecs {
		fn, err := queries.CreateFunction(ctx, sqlcgen.CreateFunctionParams{
			SeasonID:   season.ID,
			Name:       domain.NormalizeFunctionName(spec.name),
			Venue:      "Teatro Municipal",
			StartsAt:   spec.when,
			Capacity:   120,
			PriceCents: 800000, // $8.000
		})
		if err != nil {
			return err
		}
		functions = append(functions, fn)
	}

	// Vendedoras, todas con password lista para entrar.
	hash, err := auth.HashPassword(demoPassword)
	if err != nil {
		return err
	}
	sellerNames := []string{"Carolina", "Valeria", "Silvia", "Marta", "Norma"}
	sellers := make([]sqlcgen.User, 0, len(sellerNames))
	for i, name := range sellerNames {
		u, err := queries.CreateUser(ctx, sqlcgen.CreateUserParams{
			Name:               name,
			Email:              fmt.Sprintf("%s@demo.acapelius.local", domain.NormalizeEmail(name)),
			PasswordHash:       hash,
			Role:               string(domain.RoleSeller),
			MustChangePassword: false,
		})
		if err != nil {
			return fmt.Errorf("crear vendedora %d: %w", i, err)
		}
		sellers = append(sellers, u)
	}
	door, err := queries.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name:               "Recepcion",
		Email:              "puerta@demo.acapelius.local",
		PasswordHash:       hash,
		Role:               string(domain.RoleDoor),
		MustChangePassword: false,
	})
	if err != nil {
		return err
	}

	buyers := []string{
		"Maria Dutra", "Pedro Gomez", "Lucia Fernandez", "Jorge Alvarez",
		"Ana Pereira", "Raul Mendez", "Clara Suarez", "Hugo Diaz",
		"Sofia Castro", "Miguel Torres", "Elena Ruiz", "Oscar Blanco",
	}

	type saleSpec struct {
		fn       int // indice de funcion
		seller   int // indice de vendedora
		buyer    int
		quantity int32
		paid     bool
		method   string
		checkin  bool // ingreso en la funcion de anoche
	}
	// Anoche (fn 0): mucha venta, casi todo pago, casi todos entraron.
	// Hoy (fn 1) y futuras: mezcla de pagos y pendientes.
	specs := []saleSpec{
		{0, 0, 0, 3, true, "cash", true},
		{0, 0, 1, 2, true, "transfer", true},
		{0, 1, 2, 4, true, "cash", true},
		{0, 2, 3, 2, true, "transfer", false}, // pago pero no fue
		{0, 3, 4, 1, true, "cash", true},
		{1, 0, 5, 2, true, "cash", false},
		{1, 1, 6, 3, false, "", false},
		{1, 4, 7, 2, true, "transfer", false},
		{2, 0, 8, 4, false, "", false},
		{2, 2, 9, 2, true, "cash", false},
		{3, 3, 10, 3, false, "", false},
		{3, 4, 11, 2, false, "", false},
	}

	for _, spec := range specs {
		fn := functions[spec.fn]
		sale, err := queries.CreateSale(ctx, sqlcgen.CreateSaleParams{
			FunctionID:  fn.ID,
			SellerID:    sellers[spec.seller].ID,
			Code:        ulid.Make().String(),
			BuyerName:   buyers[spec.buyer],
			Quantity:    spec.quantity,
			AmountCents: domain.SaleAmount(fn.PriceCents, spec.quantity, false),
		})
		if err != nil {
			return err
		}
		if spec.paid {
			method := spec.method
			if _, err := queries.UpdateSalePayment(ctx, sqlcgen.UpdateSalePaymentParams{
				PaymentStatus: string(domain.PaymentPaid),
				PaymentMethod: &method,
				ID:            sale.ID,
			}); err != nil {
				return err
			}
		}
		for i := range spec.quantity {
			ticket, err := queries.CreateTicket(ctx, sqlcgen.CreateTicketParams{
				SaleID: sale.ID,
				Code:   ulid.Make().String(),
			})
			if err != nil {
				return err
			}
			if spec.checkin {
				// Ingresos escalonados durante la apertura de anoche.
				enteredAt := fn.StartsAt.Add(-time.Duration(30-int(i)*7) * time.Minute)
				if _, err := queries.InsertCheckin(ctx, sqlcgen.InsertCheckinParams{
					TicketID:  ticket.ID,
					UserID:    door.ID,
					Method:    "scan",
					CreatedAt: enteredAt,
				}); err != nil {
					return err
				}
				if err := queries.MarkTicketCheckedIn(ctx, ticket.ID); err != nil {
					return err
				}
			}
		}
	}

	// Cortesias de Eli para anoche (los admin del coro tambien invitan).
	admins, err := queries.ListUsers(ctx)
	if err != nil {
		return err
	}
	var adminID int64
	for _, u := range admins {
		if u.Role == string(domain.RoleAdmin) {
			adminID = u.ID
			break
		}
	}
	compSale, err := queries.CreateSale(ctx, sqlcgen.CreateSaleParams{
		FunctionID:  functions[0].ID,
		SellerID:    adminID,
		Code:        ulid.Make().String(),
		BuyerName:   "Invitados de la direccion",
		Quantity:    2,
		AmountCents: 0,
		IsComp:      true,
	})
	if err != nil {
		return err
	}
	for range 2 {
		if _, err := queries.CreateTicket(ctx, sqlcgen.CreateTicketParams{
			SaleID: compSale.ID,
			Code:   ulid.Make().String(),
		}); err != nil {
			return err
		}
	}

	// Carolina ya rindio una parte de lo cobrado.
	notes := "Primera rendicion, despues de la apertura"
	if _, err := queries.CreateSettlement(ctx, sqlcgen.CreateSettlementParams{
		SellerID:    sellers[0].ID,
		SeasonID:    season.ID,
		AmountCents: 3000000, // $30.000
		Method:      "cash",
		Notes:       &notes,
	}); err != nil {
		return err
	}

	fmt.Printf("\n  Demo cargada\n  ------------\n")
	fmt.Printf("  Temporada 2026 con 4 funciones (una anoche, con ingresos).\n")
	fmt.Printf("  Vendedoras: carolina/valeria/silvia/marta/norma @demo.acapelius.local\n")
	fmt.Printf("  Puerta:     puerta@demo.acapelius.local\n")
	fmt.Printf("  Contrasena de todas: %s\n\n", demoPassword)
	return nil
}
