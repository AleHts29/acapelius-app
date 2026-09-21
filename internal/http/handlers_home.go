package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// La home muestra lo primero que hay que atender, no un listado: alcanza con
// las primeras filas de cada cosa. Los numeros que van en los contadores se
// calculan aparte y sobre el total.
const (
	homeAlerts = 4
	homeSales  = 3
	homeToDo   = 4
	// Se traen todos los pendientes de la corista aunque se muestren cuatro:
	// son pocos y asi el contador del titulo es el numero de verdad.
	homeToDoMax = 50
)

// homeFunction es la funcion del hero y cada fila de "la temporada". Los
// campos del rol que no corresponde vienen en cero: el frontend arma la misma
// pantalla con los datos que le tocan.
type homeFunction struct {
	ID        int64     `json:"id"`
	Name      *string   `json:"name"`
	Venue     string    `json:"venue"`
	StartsAt  time.Time `json:"starts_at"`
	Capacity  int32     `json:"capacity"`
	Sold      int64     `json:"sold"`
	Entered   int64     `json:"entered"`
	Collected int64     `json:"collected_cents"`
	Assigned  int64     `json:"assigned"`

	// Del usuario logueado, solo con rol corista.
	MyAssigned  int64 `json:"my_assigned"`
	MySold      int64 `json:"my_sold"`
	MyCollected int64 `json:"my_collected_cents"`
	// La corista no tiene cupo asignado para esa funcion: no puede vender.
	NoAllocation bool `json:"no_allocation"`
}

// homeSale es una fila de "ultimas ventas".
type homeSale struct {
	ID           int64     `json:"id"`
	BuyerName    string    `json:"buyer_name"`
	SellerName   string    `json:"seller_name"`
	FunctionName string    `json:"function_name"`
	Quantity     int32     `json:"quantity"`
	AmountCents  int64     `json:"amount_cents"`
	PaidCents    int64     `json:"paid_cents"`
	IsComp       bool      `json:"is_comp"`
	CreatedAt    time.Time `json:"created_at"`
}

// homeToDoItem es una fila de "te falta cobrar" (corista).
type homeToDoItem struct {
	SaleID       int64     `json:"sale_id"`
	Code         string    `json:"code"`
	BuyerName    string    `json:"buyer_name"`
	Quantity     int32     `json:"quantity"`
	BalanceCents int64     `json:"balance_cents"`
	HasEmail     bool      `json:"has_email"`
	CreatedAt    time.Time `json:"created_at"`
}

type homeResponse struct {
	Role       string           `json:"role"`
	Name       string           `json:"name"`
	Season     *sqlcgen.Season  `json:"season"`
	Next       *homeFunction    `json:"next_function"`
	Functions  []homeFunction   `json:"functions"`
	Alerts     []attentionAlert `json:"alerts"`
	AlertTotal int              `json:"alert_total"`
	ToDo       []homeToDoItem   `json:"todo"`
	ToDoTotal  int              `json:"todo_total"`
	LastSales  []homeSale       `json:"last_sales"`
	Badges     homeBadges       `json:"badges"`
	// Solo para la corista: nil para direccion, que lo ve en Plata.
	MySettlement *homeSettlement `json:"my_settlement,omitempty"`
}

// homeSettlement es lo que la corista tiene que rendir: lo que cobro menos lo
// que ya entrego. Hasta C16 este numero no se veia en ningun lado —el acceso
// de su home apuntaba a una ruta de admin y rebotaba—, asi que la unica forma
// de saberlo era preguntarle a Eli.
type homeSettlement struct {
	CollectedCents int64 `json:"collected_cents"`
	SettledCents   int64 `json:"settled_cents"`
	BalanceCents   int64 `json:"balance_cents"`
	// Ventas que efectivamente cobro: es lo que hace entendible el monto.
	Sales int64 `json:"sales"`
}

// homeBadges alimenta los numeritos de la navegacion.
type homeBadges struct {
	SalesPending       int64 `json:"sales_pending"`
	SettlementsPending int64 `json:"settlements_pending"`
}

// handleHome: GET /api/home — todo lo que la home necesita, en una sola
// llamada y segun el rol. Direccion ve la temporada entera; la corista ve solo
// lo suyo, y ningun dato global se arma siquiera del lado del server.
func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUserFrom(ctx)

	resp := homeResponse{
		Role:      string(user.Role),
		Name:      user.Name,
		Functions: []homeFunction{},
		Alerts:    []attentionAlert{},
		ToDo:      []homeToDoItem{},
		LastSales: []homeSale{},
	}

	// La temporada la manda el selector global (C16 §Fase 2): si la home se
	// quedara siempre en la que esta en curso, el selector diria 2025 y la
	// pantalla mostraria 2026 sin avisar. Solo direccion elige: la corista y
	// la puerta operan siempre sobre la temporada en curso.
	var season *sqlcgen.Season
	if raw := r.URL.Query().Get("season_id"); raw != "" && user.Role == domain.RoleAdmin {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "season_id tiene que ser un numero.")
			return
		}
		elegida, err := s.queries.GetSeason(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				mapDomainError(w, domain.ErrSeasonNotFound)
				return
			}
			httpx.Internal(w, r, err)
			return
		}
		season = &elegida
	} else {
		enCurso, err := s.activeSeason(ctx)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		season = enCurso
	}
	if season == nil {
		httpx.JSON(w, http.StatusOK, resp)
		return
	}
	resp.Season = season

	summary, err := s.queries.FunctionsSummary(ctx, season.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	esCorista := user.Role == domain.RoleSeller
	var misCupos map[int64]sqlcgen.MyAllocationsRow
	if esCorista {
		filas, err := s.queries.MyAllocations(ctx, user.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		misCupos = make(map[int64]sqlcgen.MyAllocationsRow, len(filas))
		for _, fila := range filas {
			misCupos[fila.FunctionID] = fila
		}
	}

	for _, fn := range summary {
		item := homeFunction{
			ID:        fn.ID,
			Name:      fn.Name,
			Venue:     fn.Venue,
			StartsAt:  fn.StartsAt,
			Capacity:  fn.Capacity,
			Sold:      fn.Sold,
			Entered:   fn.Entered,
			Collected: fn.CollectedCents,
			Assigned:  fn.Assigned,
		}
		if esCorista {
			cupo, tiene := misCupos[fn.ID]
			item.NoAllocation = !tiene
			if tiene {
				item.MyAssigned = int64(cupo.Assigned)
				item.MySold = cupo.Sold
			}
			// La corista no ve la plata de la funcion, solo la suya.
			item.Collected = 0
		}
		resp.Functions = append(resp.Functions, item)
	}

	// El hero: la proxima funcion; si ya pasaron todas, la ultima. Es la misma
	// regla que usa el hero de hoy, que se probo con la temporada terminada.
	if idx := proximaFuncion(resp.Functions); idx >= 0 {
		next := resp.Functions[idx]
		if esCorista {
			cobrado, err := s.queries.MyCollectedInFunction(ctx, sqlcgen.MyCollectedInFunctionParams{
				SellerID:   user.ID,
				FunctionID: next.ID,
			})
			if err != nil {
				httpx.Internal(w, r, err)
				return
			}
			next.MyCollected = cobrado
		}
		resp.Next = &next
	}

	// Lo accionable, por rol.
	if user.Role == domain.RoleAdmin {
		alerts, err := s.attentionAlerts(ctx, season.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.AlertTotal = len(alerts)
		if len(alerts) > homeAlerts {
			alerts = alerts[:homeAlerts]
		}
		resp.Alerts = alerts

		pendientes, err := s.queries.CountPendingSales(ctx, nil)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.Badges.SalesPending = pendientes

		settlements, err := s.queries.AttentionSettlements(ctx, season.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.Badges.SettlementsPending = int64(len(settlements))
	}

	if esCorista {
		todo, err := s.queries.MyPendingSales(ctx, sqlcgen.MyPendingSalesParams{
			SellerID: user.ID,
			Max:      homeToDoMax,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.ToDoTotal = len(todo)
		if len(todo) > homeToDo {
			todo = todo[:homeToDo]
		}
		for _, fila := range todo {
			resp.ToDo = append(resp.ToDo, homeToDoItem{
				SaleID:       fila.ID,
				Code:         fila.Code,
				BuyerName:    fila.BuyerName,
				Quantity:     fila.Quantity,
				BalanceCents: fila.BalanceCents,
				HasEmail:     fila.HasEmail,
				CreatedAt:    fila.CreatedAt,
			})
		}

		pendientes, err := s.queries.CountPendingSales(ctx, &user.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.Badges.SalesPending = pendientes

		// Lo que tiene que rendir sale de la MISMA consulta que Rendiciones:
		// dos calculos distintos del mismo numero terminan discrepando, y esa
		// discusion la pierde siempre la corista.
		filas, err := s.queries.SettlementsReport(ctx, season.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		stats, err := s.queries.SellerSeasonStats(ctx, sqlcgen.SellerSeasonStatsParams{
			SellerID: user.ID,
			SeasonID: season.ID,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		// Sin fila en el reporte no vendio nada todavia: el bloque igual se
		// muestra, en cero, que es su estado real.
		mio := homeSettlement{Sales: stats.PaidSales}
		for _, fila := range filas {
			if fila.SellerID == user.ID {
				mio.CollectedCents = fila.CollectedCents
				mio.SettledCents = fila.SettledCents
				mio.BalanceCents = fila.CollectedCents - fila.SettledCents
				break
			}
		}
		resp.MySettlement = &mio
	}

	// Ultimas ventas: todas para direccion, las propias para la corista.
	var sellerID *int64
	if esCorista {
		sellerID = &user.ID
	}
	ventas, err := s.queries.RecentSales(ctx, sqlcgen.RecentSalesParams{
		SellerID: sellerID,
		Max:      homeSales,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	for _, v := range ventas {
		nombre := v.FunctionVenue
		if v.FunctionName != nil {
			nombre = *v.FunctionName
		}
		resp.LastSales = append(resp.LastSales, homeSale{
			ID:           v.ID,
			BuyerName:    v.BuyerName,
			SellerName:   v.SellerName,
			FunctionName: nombre,
			Quantity:     v.Quantity,
			AmountCents:  v.AmountCents,
			PaidCents:    v.PaidCents,
			IsComp:       v.IsComp,
			CreatedAt:    v.CreatedAt,
		})
	}

	httpx.JSON(w, http.StatusOK, resp)
}

// activeSeason devuelve la temporada en curso, o nil si todavia no hay
// ninguna. ListSeasons ya las trae con la activa primera.
func (s *Server) activeSeason(ctx context.Context) (*sqlcgen.Season, error) {
	seasons, err := s.queries.ListSeasons(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if len(seasons) == 0 {
		return nil, nil
	}
	for _, season := range seasons {
		if season.IsActive {
			return &season, nil
		}
	}
	return &seasons[0], nil
}

// proximaFuncion: la primera que todavia no empezo; si ya pasaron todas, la
// ultima. Devuelve -1 si la temporada no tiene funciones.
func proximaFuncion(fns []homeFunction) int {
	if len(fns) == 0 {
		return -1
	}
	ahora := time.Now()
	for i, fn := range fns {
		// Tres horas de gracia: durante la funcion sigue siendo "la de hoy".
		if fn.StartsAt.After(ahora.Add(-3 * time.Hour)) {
			return i
		}
	}
	return len(fns) - 1
}
