// Command seeddemo imprime el SQL de una temporada de prueba completa:
// coristas, puerta, cuatro funciones, cupos asignados, ventas repartidas en
// las ultimas dos semanas, ingresos en la puerta, cortesias y rendiciones.
//
// Imprime SQL en vez de escribir en la base para poder cargarlo por cualquier
// via: psql local, el tunel de Railway (`railway connect Postgres`) o un
// archivo que alguien revise antes de correr. Todo va en una transaccion.
//
//	go run ./cmd/seeddemo > demo.sql
//	go run ./cmd/seeddemo | railway connect Postgres
//
// El borrado se lleva la temporada entera (funciones, ventas, entradas,
// ingresos, cupos y rendiciones) y las cuentas de demo. NO toca a la direccion
// ni a ninguna cuenta real: solo borra usuarios cuyo mail sea del dominio de
// prueba. Eli conserva su usuario y su contrasena.
package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/ale-hts/acapelius/internal/auth"
)

// demoPassword entra directo: las cuentas de prueba no piden cambiarla.
const demoPassword = "acapelius-demo"

const (
	// Dominio no ruteable: ningun email de prueba puede salir a la calle por
	// accidente si algun dia se destraba el SMTP.
	demoDomain = "demo.acapelius.local"
	venue      = "Teatro Municipal"
)

type corista struct {
	name string
	// pending: nunca entro a la app (chip "Invitacion pendiente" + alerta).
	pending bool
}

var coristas = []corista{
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
	capacity    int
	priceCents  int
}

var funciones = []funcSpec{
	{"Función de apertura", -12, 21, 45, 800000},
	{"Concierto de invierno", -4, 20, 50, 800000},
	{"Función de gala", 0, 21, 80, 1000000}, // hoy: se ve el "EN VIVO"
	{"Cierre de temporada", 18, 21, 80, 900000},
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

// venta describe una venta del set de prueba.
type venta struct {
	fn       int // indice de funcion
	seller   int // indice de corista, -1 = la direccion (cortesia)
	buyer    int
	qty      int
	paid     bool
	method   string // cash | transfer
	daysAgo  int    // cuando se registro (alimenta el ritmo de ventas)
	checkins int    // cuantas de sus entradas ingresaron
	isComp   bool
}

// El set esta armado para que cada pantalla tenga algo que mostrar:
//   - apertura y concierto: casi todo vendido y cobrado, con ingresos (una
//     venta parcial y otra ausente, para el toggle "Faltan" de Asistencia).
//   - gala (hoy): 70% vendida, con los primeros ingresos ya escaneados.
//   - cierre: venta incipiente y cupo sin repartir, para la alerta de C9.
//   - las fechas de registro cubren las ultimas dos semanas: el grafico de
//     ritmo tiene curva en vez de un solo pico.
var ventas = []venta{
	// --- Función de apertura (hace 12 días) ---------------------------------
	{0, 0, 0, 3, true, "cash", 14, 3, false},
	{0, 0, 1, 2, true, "transfer", 14, 2, false},
	{0, 1, 2, 4, true, "cash", 13, 4, false},
	{0, 1, 3, 2, true, "transfer", 13, 0, false}, // pagó y no fue
	{0, 2, 4, 2, true, "cash", 13, 2, false},
	{0, 2, 5, 3, true, "cash", 12, 2, false}, // entraron 2 de 3
	{0, 3, 6, 2, true, "transfer", 12, 2, false},
	{0, 4, 7, 4, true, "cash", 12, 4, false},
	{0, 3, 8, 2, true, "cash", 12, 2, false},
	{0, 6, 9, 3, true, "transfer", 12, 3, false},
	{0, 7, 10, 2, true, "cash", 12, 2, false},
	{0, -1, 15, 2, false, "", 12, 2, true}, // cortesía de la dirección

	// --- Concierto de invierno (hace 4 días) --------------------------------
	{1, 0, 11, 3, true, "transfer", 11, 3, false},
	{1, 1, 12, 4, true, "cash", 10, 4, false},
	{1, 2, 13, 2, true, "cash", 9, 2, false},
	{1, 3, 14, 3, true, "transfer", 8, 1, false}, // entró 1 de 3
	{1, 4, 16, 2, true, "cash", 8, 2, false},
	{1, 4, 17, 5, true, "transfer", 7, 5, false},
	{1, 6, 18, 2, false, "", 7, 2, false}, // entró sin haber pagado
	{1, 7, 19, 3, true, "cash", 6, 3, false},
	{1, 7, 20, 2, true, "cash", 6, 0, false},
	{1, 9, 21, 4, true, "transfer", 5, 4, false},
	{1, -1, 22, 2, false, "", 5, 2, true},

	// --- Función de gala (hoy) ----------------------------------------------
	{2, 0, 23, 4, true, "transfer", 9, 2, false}, // llegaron 2 de 4
	{2, 0, 24, 2, true, "cash", 7, 2, false},
	{2, 1, 25, 3, true, "cash", 6, 3, false},
	{2, 1, 26, 2, false, "", 5, 0, false},
	{2, 2, 27, 5, true, "transfer", 5, 5, false},
	{2, 3, 28, 2, true, "cash", 4, 0, false},
	{2, 3, 29, 3, true, "transfer", 4, 3, false},
	{2, 4, 30, 4, true, "cash", 3, 4, false},
	{2, 2, 31, 2, false, "", 3, 0, false},
	{2, 6, 32, 6, true, "transfer", 2, 6, false},
	{2, 6, 33, 2, true, "cash", 2, 2, false},
	{2, 7, 34, 3, true, "cash", 2, 0, false},
	{2, 6, 35, 4, true, "transfer", 1, 0, false},
	{2, 7, 36, 2, false, "", 1, 0, false},
	{2, 9, 37, 5, true, "cash", 1, 0, false},
	{2, 9, 38, 3, true, "transfer", 0, 0, false},
	{2, 0, 39, 2, false, "", 0, 0, false},
	{2, 1, 40, 4, true, "cash", 0, 0, false},
	{2, -1, 41, 3, false, "", 1, 2, true}, // cortesía: entraron 2 de 3

	// --- Cierre de temporada (en 18 días) ------------------------------------
	{3, 0, 42, 3, false, "", 3, 0, false},
	{3, 2, 43, 2, true, "transfer", 2, 0, false},
	{3, 4, 44, 4, false, "", 1, 0, false},
	{3, 6, 45, 2, true, "cash", 1, 0, false},
	{3, 9, 46, 3, false, "", 0, 0, false},
}

// asignarCupos reparte el cupo de cada funcion: a cada corista lo que vendio
// mas un margen, y lo que sobra a las que todavia no vendieron nada. Derivarlo
// de las ventas garantiza la invariante de C8 (nadie vende mas que su cupo) sin
// tener que cuidarla a mano cada vez que se toca el set.
//
// El cierre de temporada queda a proposito con cupo sin repartir: es la alerta
// "N entradas sin asignar" del panel de Direccion.
func asignarCupos(vendidoPorCorista []int, fn int) []int {
	cupo := make([]int, len(coristas))
	total := 0
	for i, vendido := range vendidoPorCorista {
		if vendido > 0 {
			cupo[i] = vendido + 1 // un poco de aire sobre lo ya vendido
			total += cupo[i]
		}
	}

	// La gala se reparte entera: el sobrante va a las que no vendieron nada.
	if fn == 2 {
		sinVender := []int{}
		for i := range coristas {
			if cupo[i] == 0 {
				sinVender = append(sinVender, i)
			}
		}
		resto := funciones[fn].capacity - total
		for n, i := range sinVender {
			parte := resto / len(sinVender)
			if n == len(sinVender)-1 {
				parte = resto - parte*(len(sinVender)-1)
			}
			if parte > 0 {
				cupo[i] = parte
				total += parte
			}
		}
	}

	if total > funciones[fn].capacity {
		panic(fmt.Sprintf("funcion %q: %d asignadas para un cupo de %d",
			funciones[fn].name, total, funciones[fn].capacity))
	}
	return cupo
}

// rendido es la fraccion de lo cobrado que cada corista ya entrego, por
// indice. Expresarlo como porcentaje y no como monto evita que una rendicion
// quede por encima de lo cobrado cuando se toca el set de ventas.
//
//	1.0 = al dia · 0 = debe todo · las que no estan, no rindieron nada.
var rendido = map[int]struct {
	fraccion float64
	method   string
	notes    string
	daysAgo  int
}{
	0: {0.65, "cash", "Después de la apertura", 10},
	1: {1.0, "transfer", "Apertura y concierto, todo", 9},
	2: {0.5, "cash", "", 8},
	4: {1.0, "transfer", "Al día", 5},
	6: {0.55, "cash", "Lo del concierto", 4},
	7: {0.3, "cash", "", 3},
}

func main() {
	if err := run(os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// q escapa una cadena para un literal de SQL.
func q(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// ts formatea un instante como literal timestamptz.
func ts(t time.Time) string {
	return q(t.Format(time.RFC3339))
}

// email arma el mail de prueba a partir del nombre ("Carolina Vega" →
// carolina.vega@demo.acapelius.local).
func email(name string) string {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		case r == ' ':
			return '.'
		}
		return -1 // tildes y demas se caen
	}, name)
	return clean + "@" + demoDomain
}

func run(out *os.File) error {
	hash, err := auth.HashPassword(demoPassword)
	if err != nil {
		return err
	}

	now := time.Now()
	day := func(days, hour int) time.Time {
		d := now.AddDate(0, 0, days)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, time.Local)
	}

	var b strings.Builder
	p := func(format string, args ...any) { fmt.Fprintf(&b, format, args...) }

	p("-- Datos de prueba de Acapelius. Generado por cmd/seeddemo.\n")
	p("-- Borra la temporada y el equipo, y deja intacta a la direccion.\n")
	p("BEGIN;\n\n")

	p("-- 1. Limpieza. El orden respeta las foreign keys.\n")
	for _, table := range []string{
		"checkins", "email_sends", "tickets", "sales",
		"settlements", "allocations", "functions", "seasons",
	} {
		p("DELETE FROM %s;\n", table)
	}
	// Solo se borran las cuentas de prueba: la direccion y cualquier persona
	// real que ya este cargada se conservan con su contrasena.
	p("DELETE FROM users WHERE email LIKE '%%@%s';\n", demoDomain)
	p("DELETE FROM sessions;  -- las sesiones de quienes ya no estan\n\n")

	p("-- Numeracion desde 1 otra vez en lo que quedo vacio.\n")
	for _, table := range []string{
		"seasons", "functions", "sales", "tickets", "checkins",
		"allocations", "settlements", "email_sends",
	} {
		p("SELECT setval(pg_get_serial_sequence('%s', 'id'), 1, false);\n", table)
	}
	p("SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT max(id) FROM users), 1));\n\n")

	p("-- 2. Equipo: 10 coristas y una persona en la puerta.\n")
	p("-- Contrasena de todas: %s\n", demoPassword)
	for _, c := range coristas {
		lastLogin := "now() - interval '2 days'"
		if c.pending {
			lastLogin = "NULL" // nunca entro: invitacion pendiente
		}
		p("INSERT INTO users (name, email, password_hash, role, must_change_password, is_active, created_at, last_login_at)\n")
		p("  VALUES (%s, %s, %s, 'seller', false, true, now() - interval '20 days', %s);\n",
			q(c.name), q(email(c.name)), q(hash), lastLogin)
	}
	p("INSERT INTO users (name, email, password_hash, role, must_change_password, is_active, created_at, last_login_at)\n")
	p("  VALUES ('Recepción', %s, %s, 'door', false, true, now() - interval '20 days', now() - interval '4 days');\n\n",
		q("puerta@"+demoDomain), q(hash))

	// Referencias por nombre: los ids reales los resuelve la base.
	sellerRef := func(i int) string {
		if i < 0 {
			return "(SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)"
		}
		return fmt.Sprintf("(SELECT id FROM users WHERE email = %s)", q(email(coristas[i].name)))
	}
	doorRef := fmt.Sprintf("(SELECT id FROM users WHERE email = %s)", q("puerta@"+demoDomain))
	seasonRef := "(SELECT id FROM seasons WHERE name = 'Temporada 2026')"
	fnRef := func(i int) string {
		return fmt.Sprintf("(SELECT id FROM functions WHERE name = %s)", q(funciones[i].name))
	}

	p("-- 3. La temporada y sus cuatro funciones.\n")
	p("INSERT INTO seasons (name, is_active) VALUES ('Temporada 2026', true);\n")
	for _, f := range funciones {
		p("INSERT INTO functions (season_id, name, venue, starts_at, capacity, price_cents)\n")
		p("  VALUES (%s, %s, %s, %s, %d, %d);\n",
			seasonRef, q(f.name), q(venue), ts(day(f.daysFromNow, f.hour)), f.capacity, f.priceCents)
	}
	p("\n")

	// Lo vendido por corista y funcion, base de los cupos y de las rendiciones.
	vendido := make([][]int, len(funciones))
	cobrado := make([]int64, len(coristas))
	for i := range vendido {
		vendido[i] = make([]int, len(coristas))
	}
	for _, v := range ventas {
		if v.seller < 0 || v.isComp {
			continue // las cortesias de la direccion no consumen cupo
		}
		vendido[v.fn][v.seller] += v.qty
		if v.paid {
			cobrado[v.seller] += int64(funciones[v.fn].priceCents * v.qty)
		}
	}

	p("-- 4. Cupos asignados por la direccion (C8), derivados de lo vendido.\n")
	for fi := range funciones {
		for si, qty := range asignarCupos(vendido[fi], fi) {
			if qty == 0 {
				continue // esa corista no vende esa funcion
			}
			p("INSERT INTO allocations (user_id, function_id, quantity) VALUES (%s, %s, %d);\n",
				sellerRef(si), fnRef(fi), qty)
		}
	}
	p("\n")

	p("-- 5. Ventas, entradas e ingresos.\n")
	for i, v := range ventas {
		f := funciones[v.fn]
		amount := 0
		if !v.isComp {
			amount = f.priceCents * v.qty
		}
		status, method := "pending", "NULL"
		if v.paid {
			status, method = "paid", q(v.method)
		}
		saleCode := ulid.Make().String()
		createdAt := ts(now.AddDate(0, 0, -v.daysAgo).Add(time.Duration(-i*7) * time.Minute))

		p("INSERT INTO sales (function_id, seller_id, code, buyer_name, quantity, amount_cents, payment_status, payment_method, is_comp, created_at)\n")
		p("  VALUES (%s, %s, %s, %s, %d, %d, '%s', %s, %t, %s);\n",
			fnRef(v.fn), sellerRef(v.seller), q(saleCode), q(compradores[v.buyer]),
			v.qty, amount, status, method, v.isComp, createdAt)

		for n := range v.qty {
			ticketCode := ulid.Make().String()
			entered := n < v.checkins
			ticketStatus := "issued"
			if entered {
				ticketStatus = "checked_in"
			}
			p("INSERT INTO tickets (sale_id, code, status, created_at) VALUES ((SELECT id FROM sales WHERE code = %s), %s, '%s', %s);\n",
				q(saleCode), q(ticketCode), ticketStatus, createdAt)
			if entered {
				// Ingresos escalonados en la hora previa a la funcion. Si la
				// funcion todavia no empezo (la de hoy), los ingresos van en
				// las ultimas dos horas: la puerta esta abriendo ahora.
				puerta := day(f.daysFromNow, f.hour).Add(-55 * time.Minute)
				if puerta.After(now) {
					puerta = now.Add(-2 * time.Hour)
				}
				at := puerta.Add(time.Duration(n*6+i) * time.Minute)
				method := "scan"
				if (i+n)%7 == 0 {
					method = "manual" // algunos entran a mano: se ve el icono
				}
				p("INSERT INTO checkins (ticket_id, user_id, method, created_at) VALUES ((SELECT id FROM tickets WHERE code = %s), %s, '%s', %s);\n",
					q(ticketCode), doorRef, method, ts(at))
			}
		}
	}
	p("\n")

	p("-- 6. Rendiciones ya entregadas. Lo que falta queda como alerta.\n")
	for si := range coristas {
		r, ok := rendido[si]
		if !ok {
			continue // no rindio nada todavia: debe todo lo cobrado
		}
		// Se redondea a miles: nadie rinde $47.312,50.
		cents := int64(float64(cobrado[si])*r.fraccion/100000) * 100000
		if cents <= 0 {
			continue
		}
		notes := "NULL"
		if r.notes != "" {
			notes = q(r.notes)
		}
		p("INSERT INTO settlements (seller_id, season_id, amount_cents, method, notes, created_at)\n")
		p("  VALUES (%s, %s, %d, '%s', %s, now() - interval '%d days');\n",
			sellerRef(si), seasonRef, cents, r.method, notes, r.daysAgo)
	}

	// Cualquier corista real que ya estuviera cargada (no es de demo, no se
	// borro) se queda sin cupo: se le da uno en el cierre de temporada, que es
	// justamente la funcion con entradas sin repartir. Asi puede entrar a la
	// app y registrar una venta de prueba.
	p("\n-- 7. Cupo para las coristas reales que sobrevivieron al borrado.\n")
	p("INSERT INTO allocations (user_id, function_id, quantity)\n")
	p("  SELECT u.id, f.id, 5 FROM users u, functions f\n")
	p("  WHERE u.role = 'seller' AND u.is_active AND f.name = %s\n", q(funciones[3].name))
	p("    AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.user_id = u.id AND a.function_id = f.id);\n")

	p("\nCOMMIT;\n")

	_, err = out.WriteString(b.String())
	return err
}
