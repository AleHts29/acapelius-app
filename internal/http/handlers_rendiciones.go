package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
	"github.com/ale-hts/acapelius/internal/mail"
)

// El recordatorio lleva el detalle completo, pero un mail con cincuenta filas
// no lo lee nadie: pasado esto se manda el total y las mas recientes.
const maxFilasRecordatorio = 20

// debtSource es una venta cobrada que todavia no se rindio: de ahi sale la
// deuda, y es lo que se puede reclamar fila por fila.
type debtSource struct {
	SaleID       int64      `json:"sale_id"`
	BuyerName    string     `json:"buyer_name"`
	FunctionName string     `json:"function_name"`
	Quantity     int32      `json:"quantity"`
	PaidCents    int64      `json:"paid_cents"`
	PaidAt       *time.Time `json:"paid_at"`
}

// timelineItem es una entrada de la historia de la corista: una rendicion, un
// recordatorio, o el primer y ultimo cobro.
type timelineItem struct {
	Kind        string    `json:"kind"` // settlement | reminder | first_paid | last_paid
	At          time.Time `json:"at"`
	AmountCents int64     `json:"amount_cents,omitempty"`
	Method      string    `json:"method,omitempty"`
	Notes       string    `json:"notes,omitempty"`
	Detail      string    `json:"detail,omitempty"`
}

type sellerDetailResponse struct {
	SellerID   int64  `json:"seller_id"`
	SellerName string `json:"seller_name"`
	Email      string `json:"email"`

	CollectedCents   int64 `json:"collected_cents"`
	SettledCents     int64 `json:"settled_cents"`
	BalanceCents     int64 `json:"balance_cents"`
	UncollectedCents int64 `json:"uncollected_cents"`

	TicketsSold int64      `json:"tickets_sold"`
	PaidSales   int64      `json:"paid_sales"`
	FirstPaidAt *time.Time `json:"first_paid_at"`
	LastPaidAt  *time.Time `json:"last_paid_at"`
	// Ultimo recordatorio enviado, si hubo alguno.
	LastReminderAt *time.Time `json:"last_reminder_at"`

	DebtSources []debtSource   `json:"debt_sources"`
	Timeline    []timelineItem `json:"timeline"`
}

// handleSellerDetail: GET /api/settlements/{sellerId}/detail?season_id= — todo
// lo que hace falta para hablar con una corista sobre su deuda: cuanto,
// de donde sale, y que paso antes.
func (s *Server) handleSellerDetail(w http.ResponseWriter, r *http.Request) {
	sellerID, seasonID, ok := s.sellerYTemporada(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	detalle, err := s.sellerDetail(ctx, sellerID, seasonID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, detalle)
}

// sellerDetail arma el detalle. Vive aparte porque el recordatorio manda por
// email exactamente lo mismo que la pantalla muestra: si se armaran por
// separado, el mail y la pantalla podrian discrepar y esa discusion la pierde
// siempre dirección.
func (s *Server) sellerDetail(ctx context.Context, sellerID, seasonID int64) (*sellerDetailResponse, error) {
	user, err := s.queries.GetUserByID(ctx, sellerID)
	if err != nil {
		return nil, err
	}

	rows, err := s.queries.SettlementsReport(ctx, seasonID)
	if err != nil {
		return nil, err
	}
	var fila *sqlcgen.SettlementsReportRow
	for i := range rows {
		if rows[i].SellerID == sellerID {
			fila = &rows[i]
			break
		}
	}
	if fila == nil {
		return nil, pgx.ErrNoRows
	}

	stats, err := s.queries.SellerSeasonStats(ctx, sqlcgen.SellerSeasonStatsParams{
		SellerID: sellerID,
		SeasonID: seasonID,
	})
	if err != nil {
		return nil, err
	}
	fuentes, err := s.queries.SellerDebtSources(ctx, sqlcgen.SellerDebtSourcesParams{
		SellerID: sellerID,
		SeasonID: seasonID,
	})
	if err != nil {
		return nil, err
	}
	entregas, err := s.queries.ListSettlements(ctx, sqlcgen.ListSettlementsParams{
		SeasonID: seasonID,
		SellerID: &sellerID,
	})
	if err != nil {
		return nil, err
	}
	recordatorios, err := s.queries.ListReminders(ctx, sqlcgen.ListRemindersParams{
		SellerID: sellerID,
		SeasonID: seasonID,
	})
	if err != nil {
		return nil, err
	}

	out := &sellerDetailResponse{
		SellerID:         sellerID,
		SellerName:       user.Name,
		Email:            user.Email,
		CollectedCents:   fila.CollectedCents,
		SettledCents:     fila.SettledCents,
		BalanceCents:     fila.CollectedCents - fila.SettledCents,
		UncollectedCents: stats.UncollectedCents,
		TicketsSold:      stats.TicketsSold,
		PaidSales:        stats.PaidSales,
		FirstPaidAt:      sentinelTime(stats.FirstPaidAt),
		LastPaidAt:       sentinelTime(stats.LastPaidAt),
		DebtSources:      []debtSource{},
		Timeline:         []timelineItem{},
	}

	for _, f := range fuentes {
		nombre := f.FunctionVenue
		if f.FunctionName != nil {
			nombre = *f.FunctionName
		}
		var pagado *time.Time
		if !f.PaidAt.IsZero() {
			t := f.PaidAt
			pagado = &t
		}
		out.DebtSources = append(out.DebtSources, debtSource{
			SaleID:       f.ID,
			BuyerName:    f.BuyerName,
			FunctionName: nombre,
			Quantity:     f.Quantity,
			PaidCents:    f.PaidCents,
			PaidAt:       pagado,
		})
	}

	for _, e := range entregas {
		item := timelineItem{
			Kind:        "settlement",
			At:          e.CreatedAt,
			AmountCents: e.AmountCents,
			Method:      e.Method,
		}
		if e.Notes != nil {
			item.Notes = *e.Notes
		}
		out.Timeline = append(out.Timeline, item)
	}
	for i, rec := range recordatorios {
		if i == 0 {
			t := rec.CreatedAt
			out.LastReminderAt = &t
		}
		out.Timeline = append(out.Timeline, timelineItem{
			Kind:        "reminder",
			At:          rec.CreatedAt,
			AmountCents: rec.AmountCents,
			Detail:      rec.Status,
		})
	}
	// Los cobros extremos dan el marco temporal: "desde cuando" tiene esa
	// plata en la mano, que es la pregunta que sigue a "cuanto debe".
	if out.LastPaidAt != nil {
		out.Timeline = append(out.Timeline, timelineItem{Kind: "last_paid", At: *out.LastPaidAt})
	}
	if out.FirstPaidAt != nil && out.PaidSales > 1 {
		out.Timeline = append(out.Timeline, timelineItem{Kind: "first_paid", At: *out.FirstPaidAt})
	}
	sortTimeline(out.Timeline)

	return out, nil
}

// handleRemindSeller: POST /api/settlements/{sellerId}/remind?season_id= —
// le manda por email el detalle de lo que debe y lo deja registrado.
func (s *Server) handleRemindSeller(w http.ResponseWriter, r *http.Request) {
	sellerID, seasonID, ok := s.sellerYTemporada(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	actor := auth.MustUserFrom(ctx)

	estado, err := s.recordarA(ctx, sellerID, seasonID, actor.Name, actor.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"email_status": estado})
}

// handleRemindAll: POST /api/settlements/remind-all?season_id= — el mismo
// recordatorio a todas las que deben, de una.
func (s *Server) handleRemindAll(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	actor := auth.MustUserFrom(ctx)

	deudoras, err := s.queries.AttentionSettlements(ctx, seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	enviados, fallidos := 0, 0
	for _, d := range deudoras {
		estado, err := s.recordarA(ctx, d.SellerID, seasonID, actor.Name, actor.ID)
		if err != nil || estado == emailStatusFailed {
			fallidos++
			continue
		}
		enviados++
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"sent": enviados, "failed": fallidos})
}

// recordarA compone y manda el recordatorio, y registra el intento pase lo que
// pase: un recordatorio que no salio tambien es informacion.
func (s *Server) recordarA(ctx context.Context, sellerID, seasonID int64, actorName string, actorID int64) (string, error) {
	detalle, err := s.sellerDetail(ctx, sellerID, seasonID)
	if err != nil {
		return "", err
	}

	ventas := make([]mail.ReminderSale, 0, len(detalle.DebtSources))
	for i, f := range detalle.DebtSources {
		if i >= maxFilasRecordatorio {
			break
		}
		var cuando time.Time
		if f.PaidAt != nil {
			cuando = *f.PaidAt
		}
		ventas = append(ventas, mail.ReminderSale{
			BuyerName:    f.BuyerName,
			FunctionName: f.FunctionName,
			Quantity:     f.Quantity,
			PaidCents:    f.PaidCents,
			PaidAt:       cuando,
		})
	}

	season, err := s.queries.GetSeason(ctx, seasonID)
	if err != nil {
		return "", err
	}

	msg := mail.ComposeReminderEmail(mail.ReminderEmailData{
		Name:       detalle.SellerName,
		Email:      detalle.Email,
		SeasonName: season.Name,
		DebtCents:  detalle.BalanceCents,
		Sales:      ventas,
		BaseURL:    s.cfg.BaseURL,
		SenderName: actorName,
	})

	estado := emailStatusSent
	sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := s.mailer.Send(sendCtx, msg); err != nil {
		estado = emailStatusFailed
	}

	if _, err := s.queries.CreateReminder(ctx, sqlcgen.CreateReminderParams{
		SellerID:    sellerID,
		SeasonID:    seasonID,
		SentBy:      actorID,
		AmountCents: detalle.BalanceCents,
		Status:      estado,
	}); err != nil {
		return estado, err
	}
	return estado, nil
}

// sellerYTemporada saca los dos parametros que comparten estos handlers.
func (s *Server) sellerYTemporada(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	sellerID, err := strconv.ParseInt(chi.URLParam(r, "sellerId"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return 0, 0, false
	}
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return 0, 0, false
	}
	return sellerID, seasonID, true
}

// sortTimeline: lo mas nuevo arriba.
func sortTimeline(items []timelineItem) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].At.After(items[j-1].At); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}
