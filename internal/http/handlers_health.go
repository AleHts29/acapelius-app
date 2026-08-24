package httpapi

import (
	"net/http"
	"time"

	"github.com/ale-hts/acapelius/internal/httpx"
)

type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// handleHealth responde 200 solo si tambien responde Postgres: un server vivo
// con la base caida no sirve para nada y no tiene que recibir trafico.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := timeoutContext(r, 3*time.Second)
	defer cancel()

	if err := s.pool.Ping(ctx); err != nil {
		httpx.JSON(w, http.StatusServiceUnavailable, healthResponse{
			Status:   "degraded",
			Database: "unreachable",
		})
		return
	}

	httpx.JSON(w, http.StatusOK, healthResponse{Status: "ok", Database: "ok"})
}
