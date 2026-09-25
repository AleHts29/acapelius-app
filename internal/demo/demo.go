// Package demo siembra y reinicia la organizacion de prueba (C17 §C): una
// organizacion mas, con is_demo = true, datos verosimiles y nombres
// inventados. Reset la borra entera y la vuelve a sembrar; es idempotente y
// lo corre tanto el job nocturno como `make demo-reset`.
package demo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
)

const (
	// Slug es el de la organizacion demo: fijo, para encontrarla siempre.
	Slug = "demo"
	// Name es como se presenta en la app.
	Name = "Coro Demo"
	// AdminEmail es la cuenta con la que entra la sesion de invitado.
	AdminEmail = "direccion@demo.acapelius.local"
	// Dominio no ruteable: ningun mail de prueba sale a la calle.
	dominio  = "demo.acapelius.local"
	venue    = "Teatro Municipal"
	password = "acapelius-demo"
)

// ResetHour es la hora local a la que corre el reinicio nocturno.
const ResetHour = 4

// Reset borra todo lo de la organizacion demo y la vuelve a sembrar, en una
// transaccion. Si no existe, la crea. Devuelve el id de la organizacion.
func Reset(ctx context.Context, pool *pgxpool.Pool, loc *time.Location) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := sqlcgen.New(tx)

	orgID, err := ensureOrg(ctx, tx, q)
	if err != nil {
		return 0, err
	}
	if err := wipe(ctx, tx, orgID); err != nil {
		return 0, fmt.Errorf("vaciar la demo: %w", err)
	}
	if err := seed(ctx, tx, q, orgID, time.Now().In(loc)); err != nil {
		return 0, fmt.Errorf("sembrar la demo: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return orgID, nil
}

// ensureOrg devuelve la organizacion demo, creandola si hace falta. El id
// queda fijo entre reinicios: las sesiones abiertas siguen apuntando a ella.
func ensureOrg(ctx context.Context, tx pgx.Tx, q *sqlcgen.Queries) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx, "SELECT id FROM organizations WHERE slug = $1", Slug).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return 0, err
	}
	org, err := q.CreateOrganization(ctx, sqlcgen.CreateOrganizationParams{
		Name: Name, Kind: string(domain.KindChoir), Slug: Slug, IsDemo: true,
	})
	if err != nil {
		return 0, err
	}
	return org.ID, nil
}

// wipe borra todo lo que cuelga de la organizacion, en el orden que exigen
// las foreign keys (casi ninguna tiene ON DELETE CASCADE). Solo toca filas
// de esta organizacion: el resto de la base ni se mira.
func wipe(ctx context.Context, tx pgx.Tx, orgID int64) error {
	pasos := []string{
		`DELETE FROM checkins c USING tickets t, sales s, functions f, seasons se
		   WHERE c.ticket_id = t.id AND t.sale_id = s.id AND s.function_id = f.id AND f.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM email_sends e USING sales s, functions f, seasons se
		   WHERE e.sale_id = s.id AND s.function_id = f.id AND f.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM tickets t USING sales s, functions f, seasons se
		   WHERE t.sale_id = s.id AND s.function_id = f.id AND f.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM sales s USING functions f, seasons se
		   WHERE s.function_id = f.id AND f.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM settlement_reminders r USING seasons se WHERE r.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM settlements st USING seasons se WHERE st.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM allocations a USING users u WHERE a.user_id = u.id AND u.organization_id = $1`,
		`DELETE FROM functions f USING seasons se WHERE f.season_id = se.id AND se.organization_id = $1`,
		`DELETE FROM seasons WHERE organization_id = $1`, // season_members cae en cascada
		`DELETE FROM users WHERE organization_id = $1`,
	}
	for _, sql := range pasos {
		if _, err := tx.Exec(ctx, sql, orgID); err != nil {
			return err
		}
	}
	return nil
}

// ============================================================================
// El set de datos
// ============================================================================

type integrante struct {
	name string
	// pending: nunca entro a la app (chip "Invitacion pendiente" + alerta).
	pending bool
}

// Nombres inventados; ninguno real.
var coristas = []integrante{
	{name: "Carolina Vega"},
	{name: "Virginia Sosa"},
	{name: "Silvia Rey"},
	{name: "Marta Ledesma"},
	{name: "Norma Quiroga"},
	{name: "Josefina Paz", pending: true},
	{name: "Adriana Bustos"},
	{name: "Mercedes Ibarra"},
	{name: "Roxana Nieves", pending: true},
	{name: "Beatriz Coria"},
}

type funcSpec struct {
	name        string
	daysFromNow int
	hour        int
	capacity    int32
	priceCents  int64
}

// Tres hechas y una en venta. La gala tiene baja asistencia a proposito: es
// el hallazgo que Direccion tiene que mostrar.
var funciones = []funcSpec{
	{"Función de apertura", -19, 21, 45, 800000},
	{"Concierto de invierno", -11, 20, 50, 800000},
	{"Función de gala", -3, 21, 80, 1000000},
	{"Cierre de temporada", 15, 21, 80, 900000},
}

var compradores = []string{
	"María Dutra", "Pedro Gómez", "Lucía Fernández", "Jorge Álvarez",
	"Ana Pereira", "Raúl Méndez", "Clara Suárez", "Hugo Díaz",
	"Sofía Castro", "Miguel Torres", "Elena Ruiz", "Óscar Blanco",
	"Rosa Suárez", "Julián Petrone", "Graciela Torres", "Padre Benítez",
	"Lucía Molina", "Andrés Bianchi", "Teresa Olmos", "Ramón Cabral",
	"Verónica Lagos", "Alejandro Huertas", "Nélida Farías", "Ernesto Vidal",
	"Paula Aguirre", "Damián Rossi", "Inés Balcarce", "Tomás Aranda",
	"Estela Ferreyra", "Gustavo Pinto", "Delia Márquez", "Ricardo Anaya",
	"Marina Ledesma", "Fabián Coronel", "Susana Portela", "Néstor Ayala",
	"Carmen Villalba", "Diego Sarmiento", "Amalia Recalde", "Julio Bermúdez",
	"Cecilia Ponce", "Martín Ocampo", "Alicia Zabala", "Federico Nardi",
	"Irene Sandoval", "Marcelo Duarte", "Pilar Escobar", "Rubén Casal",
}

// venta describe una venta del set. paid: 0 = debe todo, 1 = pago todo,
// 2 = cobro parcial (la mitad). Con los cuatro estados de pago: pendiente,
// parcial, pagada y cortesia; las anuladas van aparte.
type venta struct {
	fn       int // indice de funcion
	seller   int // indice de corista, -1 = la direccion (cortesia)
	buyer    int
	qty      int
	paid     int
	method   string // cash | transfer
	daysAgo  int    // cuando se registro
	checkins int    // cuantas de sus entradas ingresaron
	isComp   bool
	voided   bool
}

var ventas = []venta{
	// --- Función de apertura: casi todo vendido, cobrado y con buena asistencia.
	{0, 0, 0, 3, 1, "cash", 24, 3, false, false},
	{0, 0, 1, 2, 1, "transfer", 24, 2, false, false},
	{0, 1, 2, 4, 1, "cash", 23, 4, false, false},
	{0, 1, 3, 2, 1, "transfer", 23, 0, false, false}, // pago y no fue
	{0, 2, 4, 2, 1, "cash", 23, 2, false, false},
	{0, 2, 5, 3, 1, "cash", 22, 2, false, false}, // entraron 2 de 3
	{0, 3, 6, 2, 1, "transfer", 22, 2, false, false},
	{0, 4, 7, 4, 1, "cash", 22, 4, false, false},
	{0, 3, 8, 2, 1, "cash", 21, 2, false, false},
	{0, 6, 9, 3, 1, "transfer", 21, 3, false, false},
	{0, 7, 10, 2, 1, "cash", 21, 2, false, false},
	{0, 9, 11, 3, 1, "cash", 20, 3, false, false},
	{0, 7, 12, 2, 0, "", 20, 0, false, true},  // anulada
	{0, -1, 15, 2, 0, "", 20, 2, true, false}, // cortesia de la direccion

	// --- Concierto de invierno: buena venta, asistencia normal.
	{1, 0, 13, 3, 1, "transfer", 18, 3, false, false},
	{1, 1, 14, 4, 1, "cash", 17, 4, false, false},
	{1, 2, 16, 2, 1, "cash", 16, 2, false, false},
	{1, 3, 17, 3, 1, "transfer", 15, 1, false, false}, // entro 1 de 3
	{1, 4, 18, 2, 1, "cash", 15, 2, false, false},
	{1, 4, 19, 5, 1, "transfer", 14, 5, false, false},
	{1, 6, 20, 2, 0, "", 14, 2, false, false}, // entro sin haber pagado
	{1, 7, 21, 3, 1, "cash", 13, 3, false, false},
	{1, 7, 22, 2, 1, "cash", 13, 0, false, false},
	{1, 9, 23, 4, 1, "transfer", 12, 4, false, false},
	{1, 9, 24, 3, 2, "cash", 12, 3, false, false}, // cobro parcial
	{1, -1, 25, 2, 0, "", 12, 2, true, false},

	// --- Función de gala: se vendio bien y fue poca gente (el hallazgo).
	{2, 0, 26, 4, 1, "transfer", 10, 1, false, false},
	{2, 0, 27, 2, 1, "cash", 9, 0, false, false},
	{2, 1, 28, 3, 1, "cash", 9, 1, false, false},
	{2, 1, 29, 2, 0, "", 8, 0, false, false},
	{2, 2, 30, 5, 1, "transfer", 8, 2, false, false},
	{2, 3, 31, 2, 1, "cash", 7, 0, false, false},
	{2, 3, 32, 3, 1, "transfer", 7, 1, false, false},
	{2, 4, 33, 4, 1, "cash", 6, 2, false, false},
	{2, 2, 34, 2, 2, "transfer", 6, 0, false, false}, // cobro parcial
	{2, 6, 35, 6, 1, "transfer", 5, 2, false, false},
	{2, 6, 36, 2, 1, "cash", 5, 0, false, false},
	{2, 7, 37, 3, 1, "cash", 5, 1, false, false},
	{2, 6, 38, 4, 1, "transfer", 4, 0, false, false},
	{2, 7, 39, 2, 0, "", 4, 0, false, false},
	{2, 9, 40, 5, 1, "cash", 4, 2, false, false},
	{2, 9, 41, 3, 1, "transfer", 3, 0, false, false},
	{2, 0, 42, 2, 0, "", 3, 0, false, false},
	{2, 1, 43, 4, 1, "cash", 3, 1, false, false},
	{2, -1, 44, 3, 0, "", 4, 2, true, false}, // cortesia: entraron 2 de 3

	// --- Cierre de temporada (en venta): venta incipiente, cupo sin repartir.
	{3, 0, 45, 3, 0, "", 3, 0, false, false},
	{3, 2, 46, 2, 1, "transfer", 2, 0, false, false},
	{3, 4, 47, 4, 0, "", 1, 0, false, false},
	{3, 6, 12, 2, 1, "cash", 1, 0, false, false},
	{3, 9, 8, 3, 2, "cash", 0, 0, false, false}, // cobro parcial
	{3, 1, 3, 2, 0, "", 0, 0, false, false},
}

// rendido: que fraccion de lo cobrado ya entrego cada corista. Las que no
// estan no rindieron nada y deben todo lo cobrado.
var rendido = map[int]struct {
	fraccion float64
	method   string
	notes    string
	daysAgo  int
}{
	0: {0.65, "cash", "Después de la apertura", 16},
	1: {1.0, "transfer", "Apertura y concierto, todo", 9},
	2: {0.5, "cash", "", 8},
	4: {1.0, "transfer", "Al día", 5},
	6: {0.55, "cash", "Lo del concierto", 4},
	7: {0.3, "cash", "", 3},
}

// asignarCupos reparte el cupo de cada funcion: a cada corista lo que vendio
// mas un margen. El cierre queda a proposito con cupo sin repartir.
func asignarCupos(vendido []int, fn int) []int32 {
	cupo := make([]int32, len(coristas))
	var total int32
	for i, v := range vendido {
		if v > 0 {
			cupo[i] = int32(v) + 1
			total += cupo[i]
		}
	}
	if fn == 2 { // la gala se reparte entera
		sinVender := []int{}
		for i := range coristas {
			if cupo[i] == 0 {
				sinVender = append(sinVender, i)
			}
		}
		resto := funciones[fn].capacity - total
		for n, i := range sinVender {
			parte := resto / int32(len(sinVender))
			if n == len(sinVender)-1 {
				parte = resto - parte*int32(len(sinVender)-1)
			}
			if parte > 0 {
				cupo[i] = parte
				total += parte
			}
		}
	}
	if total > funciones[fn].capacity {
		panic(fmt.Sprintf("demo: funcion %q con %d asignadas para un cupo de %d", funciones[fn].name, total, funciones[fn].capacity))
	}
	return cupo
}

func seed(ctx context.Context, tx pgx.Tx, q *sqlcgen.Queries, orgID int64, now time.Time) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	day := func(days, hour int) time.Time {
		d := now.AddDate(0, 0, days)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, now.Location())
	}

	// Las cuentas: direccion, coristas y puerta. Ninguna pide cambiar la
	// contraseña; la de la direccion es la de la sesion de invitado.
	crear := func(name, email string, lastLogin *time.Time) (int64, error) {
		var id int64
		err := tx.QueryRow(ctx, `INSERT INTO users (name, email, password_hash, must_change_password, organization_id, created_at, last_login_at)
			VALUES ($1, $2, $3, false, $4, $5, $6) RETURNING id`,
			name, email, hash, orgID, now.AddDate(0, 0, -30), lastLogin).Scan(&id)
		return id, err
	}
	hace := func(days int) *time.Time { t := now.AddDate(0, 0, -days); return &t }
	adminID, err := crear("Dirección", AdminEmail, hace(0))
	if err != nil {
		return err
	}
	sellerIDs := make([]int64, len(coristas))
	for i, c := range coristas {
		var last *time.Time
		if !c.pending {
			last = hace(2 + i%5)
		}
		if sellerIDs[i], err = crear(c.name, email(c.name), last); err != nil {
			return err
		}
	}
	doorID, err := crear("Recepción", "puerta@"+dominio, hace(4))
	if err != nil {
		return err
	}

	season, err := q.CreateSeason(ctx, sqlcgen.CreateSeasonParams{
		Name: fmt.Sprintf("Temporada %d", now.Year()), OrganizationID: orgID, IsActive: true,
	})
	if err != nil {
		return err
	}
	miembro := func(userID int64, role domain.Role) error {
		_, err := q.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
			SeasonID: season.ID, UserID: userID, Role: string(role), OrganizationID: orgID,
		})
		return err
	}
	if err := miembro(adminID, domain.RoleAdmin); err != nil {
		return err
	}
	for _, id := range sellerIDs {
		if err := miembro(id, domain.RoleSeller); err != nil {
			return err
		}
	}
	if err := miembro(doorID, domain.RoleDoor); err != nil {
		return err
	}

	fnIDs := make([]int64, len(funciones))
	for i, f := range funciones {
		name := f.name
		fn, err := q.CreateFunction(ctx, sqlcgen.CreateFunctionParams{
			SeasonID: season.ID, Name: &name, Venue: venue, StartsAt: day(f.daysFromNow, f.hour),
			Capacity: f.capacity, PriceCents: f.priceCents, OrganizationID: orgID,
		})
		if err != nil {
			return err
		}
		fnIDs[i] = fn.ID
	}

	// Lo vendido por corista y funcion: base de los cupos y las rendiciones.
	vendido := make([][]int, len(funciones))
	for i := range vendido {
		vendido[i] = make([]int, len(coristas))
	}
	cobrado := make([]int64, len(coristas))
	for _, v := range ventas {
		if v.seller < 0 || v.isComp || v.voided {
			continue
		}
		vendido[v.fn][v.seller] += v.qty
		monto := funciones[v.fn].priceCents * int64(v.qty)
		switch v.paid {
		case 1:
			cobrado[v.seller] += monto
		case 2:
			cobrado[v.seller] += monto / 2
		}
	}
	for fi := range funciones {
		for si, qty := range asignarCupos(vendido[fi], fi) {
			if qty == 0 {
				continue
			}
			if _, err := q.UpsertAllocation(ctx, sqlcgen.UpsertAllocationParams{
				UserID: sellerIDs[si], FunctionID: fnIDs[fi], Quantity: qty, OrganizationID: orgID,
			}); err != nil {
				return err
			}
		}
	}

	// Ventas, entradas, cobros e ingresos.
	for i, v := range ventas {
		f := funciones[v.fn]
		sellerID := adminID
		if v.seller >= 0 {
			sellerID = sellerIDs[v.seller]
		}
		var amount int64
		if !v.isComp {
			amount = f.priceCents * int64(v.qty)
		}
		createdAt := now.AddDate(0, 0, -v.daysAgo).Add(time.Duration(-i*7) * time.Minute)
		var buyerEmail *string
		if i%3 != 0 { // dos de cada tres compradores dejaron mail
			e := email(compradores[v.buyer])
			buyerEmail = &e
		}
		var voidedAt *time.Time
		if v.voided {
			t := createdAt.Add(2 * time.Hour)
			voidedAt = &t
		}
		var saleID int64
		if err := tx.QueryRow(ctx, `INSERT INTO sales (function_id, seller_id, code, buyer_name, buyer_email, quantity, amount_cents, is_comp, created_at, voided_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
			fnIDs[v.fn], sellerID, ulid.Make().String(), compradores[v.buyer], buyerEmail, v.qty, amount, v.isComp, createdAt, voidedAt).Scan(&saleID); err != nil {
			return err
		}
		if buyerEmail != nil && !v.voided {
			if _, err := tx.Exec(ctx, `INSERT INTO email_sends (sale_id, recipient, status, created_at) VALUES ($1, $2, 'sent', $3)`,
				saleID, *buyerEmail, createdAt.Add(time.Minute)); err != nil {
				return err
			}
		}
		// Cobros: total, parcial o nada. El cache de la venta se recalcula
		// como en la app, para que sea exactamente lo que mostraria.
		var cobro int64
		switch v.paid {
		case 1:
			cobro = amount
		case 2:
			cobro = amount / 2
		}
		if cobro > 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO sale_payments (sale_id, amount_cents, method, user_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
				saleID, cobro, v.method, sellerID, createdAt.Add(time.Duration(v.paid)*24*time.Hour)); err != nil {
				return err
			}
			if _, err := q.RecalcSalePayment(ctx, saleID); err != nil {
				return err
			}
		}
		for n := range v.qty {
			entered := n < v.checkins && !v.voided
			status := "issued"
			if v.voided {
				status = "void"
			} else if entered {
				status = "checked_in"
			}
			var ticketID int64
			if err := tx.QueryRow(ctx, `INSERT INTO tickets (sale_id, code, status, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
				saleID, ulid.Make().String(), status, createdAt).Scan(&ticketID); err != nil {
				return err
			}
			if entered {
				// Ingresos escalonados en la hora previa a la funcion.
				at := day(f.daysFromNow, f.hour).Add(-55 * time.Minute).Add(time.Duration(n*6+i) * time.Minute)
				method := "scan"
				if (i+n)%7 == 0 {
					method = "manual"
				}
				if _, err := tx.Exec(ctx, `INSERT INTO checkins (ticket_id, user_id, method, created_at) VALUES ($1, $2, $3, $4)`,
					ticketID, doorID, method, at); err != nil {
					return err
				}
			}
		}
	}

	// Rendiciones parciales: lo que falta queda como alerta.
	for si := range coristas {
		r, ok := rendido[si]
		if !ok {
			continue
		}
		cents := int64(float64(cobrado[si])*r.fraccion/100000) * 100000 // a miles
		if cents <= 0 {
			continue
		}
		var notes *string
		if r.notes != "" {
			n := r.notes
			notes = &n
		}
		if _, err := tx.Exec(ctx, `INSERT INTO settlements (seller_id, season_id, amount_cents, method, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
			sellerIDs[si], season.ID, cents, r.method, notes, now.AddDate(0, 0, -r.daysAgo)); err != nil {
			return err
		}
	}
	return nil
}

// email arma un mail no ruteable a partir del nombre.
func email(name string) string {
	out := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out = append(out, r)
		case r >= 'A' && r <= 'Z':
			out = append(out, r+('a'-'A'))
		case r == ' ':
			out = append(out, '.')
		default:
			// tildes y demas se caen
			switch r {
			case 'á', 'Á':
				out = append(out, 'a')
			case 'é', 'É':
				out = append(out, 'e')
			case 'í', 'Í':
				out = append(out, 'i')
			case 'ó', 'Ó':
				out = append(out, 'o')
			case 'ú', 'Ú', 'ü':
				out = append(out, 'u')
			case 'ñ', 'Ñ':
				out = append(out, 'n')
			}
		}
	}
	return string(out) + "@" + dominio
}

// EnsureSeeded siembra la demo solo si la organizacion no existe todavia:
// es lo que corre el server al arrancar, para que un deploy nuevo la tenga
// sin pasos a mano y sin pisar lo que alguien esta tocando.
func EnsureSeeded(ctx context.Context, pool *pgxpool.Pool, loc *time.Location) error {
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM organizations WHERE slug = $1)", Slug).Scan(&existe); err != nil {
		return err
	}
	if existe {
		return nil
	}
	_, err := Reset(ctx, pool, loc)
	return err
}

// Nightly reinicia la demo todos los dias a ResetHour (hora local) hasta que
// el contexto se cancele. Corre en una goroutine del server: hay una sola
// instancia, no hace falta un scheduler afuera.
func Nightly(ctx context.Context, pool *pgxpool.Pool, loc *time.Location, log func(msg string, args ...any)) {
	for {
		now := time.Now().In(loc)
		next := time.Date(now.Year(), now.Month(), now.Day(), ResetHour, 0, 0, 0, loc)
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
		}
		if _, err := Reset(ctx, pool, loc); err != nil {
			log("no se pudo reiniciar la demo", "error", err)
		} else {
			log("demo reiniciada")
		}
	}
}
