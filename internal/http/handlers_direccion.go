package httpapi

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ale-hts/acapelius/internal/httpx"
)

// Direccion muestra conclusiones, no tablas: cada dato que necesita contexto
// para entenderse vive detras de un click. Estas son las tres cifras que
// pueden ser un hallazgo, y los umbrales a partir de los cuales vale la pena
// nombrarlas.
const (
	// Una funcion con menos de esto de asistencia esta mal, no "regular".
	asistenciaBaja = 60
	// Y ademas tiene que estar claramente peor que el resto: si todas
	// rondaron el 55% no es un hallazgo de esa funcion, es como viene el coro.
	asistenciaBrecha = 15
)

type direccionMoney struct {
	SoldCents        int64 `json:"sold_cents"`
	InHandCents      int64 `json:"in_hand_cents"`
	UnsettledCents   int64 `json:"unsettled_cents"`
	UncollectedCents int64 `json:"uncollected_cents"`
	SellersOwing     int   `json:"sellers_owing"`
	SalesUncollected int64 `json:"sales_uncollected"`
}

// direccionFunction es una fila de la comparacion entre funciones.
type direccionFunction struct {
	ID             int64     `json:"id"`
	Name           *string   `json:"name"`
	Venue          string    `json:"venue"`
	StartsAt       time.Time `json:"starts_at"`
	Capacity       int32     `json:"capacity"`
	Sold           int64     `json:"sold"`
	Entered        int64     `json:"entered"`
	CollectedCents int64     `json:"collected_cents"`
	CompTickets    int64     `json:"comp_tickets"`
	Assigned       int64     `json:"assigned"`
	PriceCents     int64     `json:"price_cents"`
	// Derivados, calculados aca para que la pantalla no repita la cuenta.
	OccupancyPct int64 `json:"occupancy_pct"`
	// -1 = todavia no paso: no hay asistencia que mostrar.
	AttendancePct  int64 `json:"attendance_pct"`
	TicketAvgCents int64 `json:"ticket_avg_cents"`
	Done           bool  `json:"done"`
}

// direccionFinding es una de las cosas que hay que mirar. `value` es la cifra
// grande y `body` la frase que la explica; el texto lo arma el server porque
// depende de comparar funciones entre si.
type direccionFinding struct {
	Kind       string `json:"kind"`
	Value      string `json:"value"`
	Suffix     string `json:"suffix,omitempty"`
	Tone       string `json:"tone"` // danger | warn | indigo
	Body       string `json:"body"`
	LinkLabel  string `json:"link_label"`
	FunctionID int64  `json:"function_id,omitempty"`
}

type direccionResponse struct {
	Money     direccionMoney      `json:"money"`
	Functions []direccionFunction `json:"functions"`
	Totals    direccionFunction   `json:"totals"`
	Findings  []direccionFinding  `json:"findings"`
	// La funcion en venta: la que la card de asignaciones muestra.
	InSale *direccionFunction `json:"in_sale"`
}

// handleDireccion: GET /api/reports/direccion?season_id= — la temporada
// resumida en tres bloques: la plata, lo que hay que mirar, y las funciones.
func (s *Server) handleDireccion(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	money, err := s.queries.SeasonMoney(ctx, seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	settled, err := s.queries.SeasonSettled(ctx, seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	deudoras, err := s.queries.AttentionSettlements(ctx, seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	summary, err := s.queries.FunctionsSummary(ctx, seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	resp := direccionResponse{
		Money: direccionMoney{
			SoldCents: money.SoldCents,
			// Lo que ya esta en manos de direccion es lo rendido; el resto de
			// lo cobrado sigue en el bolsillo de las coristas.
			InHandCents:      settled,
			UnsettledCents:   money.CollectedCents - settled,
			UncollectedCents: money.UncollectedCents,
			SellersOwing:     len(deudoras),
			SalesUncollected: money.SalesUncollected,
		},
		Functions: []direccionFunction{},
		Findings:  []direccionFinding{},
	}

	ahora := time.Now()
	var totalSold, totalEntered, totalCollected, totalComps int64
	var totalCapacity int64
	for _, fn := range summary {
		item := direccionFunction{
			ID:             fn.ID,
			Name:           fn.Name,
			Venue:          fn.Venue,
			StartsAt:       fn.StartsAt,
			Capacity:       fn.Capacity,
			Sold:           fn.Sold,
			Entered:        fn.Entered,
			CollectedCents: fn.CollectedCents,
			CompTickets:    fn.CompTickets,
			Assigned:       fn.Assigned,
			PriceCents:     fn.PriceCents,
			AttendancePct:  -1,
			Done:           fn.StartsAt.Before(ahora.Add(-3 * time.Hour)),
		}
		item.OccupancyPct = porcentaje(fn.Sold, int64(fn.Capacity))
		item.TicketAvgCents = promedio(fn.CollectedCents, fn.Sold)
		if item.Done {
			item.AttendancePct = porcentaje(fn.Entered, fn.Sold)
		}
		resp.Functions = append(resp.Functions, item)

		totalSold += fn.Sold
		totalEntered += fn.Entered
		totalCollected += fn.CollectedCents
		totalComps += fn.CompTickets
		totalCapacity += int64(fn.Capacity)
	}

	resp.Totals = direccionFunction{
		Sold:           totalSold,
		Entered:        totalEntered,
		CollectedCents: totalCollected,
		CompTickets:    totalComps,
		Capacity:       int32(totalCapacity),
		OccupancyPct:   porcentaje(totalSold, totalCapacity),
		AttendancePct:  porcentaje(totalEntered, totalSold),
		TicketAvgCents: promedio(totalCollected, totalSold),
	}

	// La funcion en venta: la primera que todavia no paso.
	for i := range resp.Functions {
		if !resp.Functions[i].Done {
			resp.InSale = &resp.Functions[i]
			break
		}
	}

	resp.Findings = hallazgos(resp.Functions, resp.InSale, totalComps)
	httpx.JSON(w, http.StatusOK, resp)
}

// hallazgos elige hasta tres cosas que valga la pena mirar, en orden de lo que
// mas duele. Cada una es una conclusion, no un dato: si no hay nada que decir,
// no se inventa una tarjeta.
func hallazgos(fns []direccionFunction, inSale *direccionFunction, comps int64) []direccionFinding {
	out := []direccionFinding{}

	// 1. La funcion que menos entro, si ademas quedo lejos del resto.
	var peor *direccionFunction
	var mejor int64 = -1
	for i := range fns {
		fn := &fns[i]
		if fn.AttendancePct < 0 {
			continue
		}
		if peor == nil || fn.AttendancePct < peor.AttendancePct {
			peor = fn
		}
		if fn.AttendancePct > mejor {
			mejor = fn.AttendancePct
		}
	}
	if peor != nil && peor.AttendancePct < asistenciaBaja && mejor-peor.AttendancePct >= asistenciaBrecha {
		out = append(out, direccionFinding{
			Kind:       "attendance",
			Value:      pct(peor.AttendancePct),
			Tone:       "danger",
			Body:       "De " + nombreFuncion(*peor) + " entró menos de la mitad de la gente que compró. El resto de la temporada estuvo bastante por encima.",
			LinkLabel:  "Ver asistencia",
			FunctionID: peor.ID,
		})
	}

	// 2. Cupo sin repartir de la funcion en venta: entradas que nadie puede
	//    vender porque no estan en manos de nadie.
	if inSale != nil {
		sinAsignar := int64(inSale.Capacity) - inSale.Assigned
		if sinAsignar > 0 {
			out = append(out, direccionFinding{
				Kind:       "unassigned",
				Value:      itoa(sinAsignar),
				Tone:       "warn",
				Body:       "Entradas de " + nombreFuncion(*inSale) + " sin asignar a ninguna corista: nadie las puede vender.",
				LinkLabel:  "Repartir cupo",
				FunctionID: inSale.ID,
			})
		}
	}

	// 3. Cortesias: cuantas butacas se regalaron y cuanto valian.
	if comps > 0 {
		var valor int64
		for _, fn := range fns {
			valor += fn.CompTickets * fn.PriceCents
		}
		out = append(out, direccionFinding{
			Kind:      "comps",
			Value:     itoa(comps),
			Tone:      "warn",
			Body:      "Cortesías emitidas en la temporada: equivalen a " + plata(valor) + " que no entraron.",
			LinkLabel: "Ver cortesías",
		})
	}

	if len(out) > 3 {
		out = out[:3]
	}
	return out
}

// --- Formato ----------------------------------------------------------------
// Estas cuentas viven en el server porque el texto de los hallazgos las
// necesita armadas: la pantalla muestra la frase, no la division.

func porcentaje(parte, total int64) int64 {
	if total <= 0 {
		return 0
	}
	return int64(math.Round(float64(parte) / float64(total) * 100))
}

// promedio redondeado al peso: en un promedio los centavos son ruido, y
// "$7.483,87" se lee peor que "$7.484" para la misma decision.
func promedio(total, unidades int64) int64 {
	if unidades <= 0 {
		return 0
	}
	return int64(math.Round(float64(total)/float64(unidades)/100)) * 100
}

func pct(v int64) string { return strconv.FormatInt(v, 10) + "%" }

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

// plata: centavos a "$264.000", con el punto de miles del castellano.
func plata(cents int64) string {
	pesos := cents / 100
	s := strconv.FormatInt(pesos, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return "$" + b.String()
}

func nombreFuncion(fn direccionFunction) string {
	if fn.Name != nil && *fn.Name != "" {
		return *fn.Name
	}
	return fn.Venue
}
