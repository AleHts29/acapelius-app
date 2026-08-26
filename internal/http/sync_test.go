package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// TestSyncOffline cubre la aceptacion de la fase 4 del lado del server: la
// cola juntada sin conexion se sincroniza en batch, es idempotente, y los
// check-ins quedan visibles para el panel.
func TestSyncOffline(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)
	assignQuota(t, admin, fnID, 2, 50)

	maria := sellTickets(t, seller, fnID, "Maria Dutra", 2)
	pedro := sellTickets(t, seller, fnID, "Pedro Gomez", 1)

	// El dispositivo estuvo offline: junto tres ingresos con sus timestamps
	// reales (dos por scan con payload firmado, uno manual).
	at := time.Now().Add(-10 * time.Minute).Format(time.RFC3339)
	batch := map[string]any{
		"function_id": fnID,
		"device_id":   "celu-de-la-puerta",
		"checkins": []map[string]any{
			{"method": "scan", "payload": env.signer.Payload(maria[0]), "at": at},
			{"method": "scan", "payload": env.signer.Payload(maria[1]), "at": at},
			{"method": "manual", "code": pedro[0], "at": at},
		},
	}

	first := door.post("/api/checkins/sync", batch)
	assertStatus(t, first, http.StatusOK)
	results := first.Body["results"].([]any)
	if len(results) != 3 {
		t.Fatalf("se esperaban 3 resultados, hay %d", len(results))
	}
	for i, raw := range results {
		res := raw.(map[string]any)
		if res["result"] != "ok" {
			t.Fatalf("item %d tendria que ser ok: %v", i, res)
		}
	}

	// El timestamp guardado es el del cliente (momento real del ingreso).
	snapshot := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	checkins := snapshot.Body["checkins"].([]any)
	if len(checkins) != 3 {
		t.Fatalf("tendria que haber 3 check-ins, hay %d", len(checkins))
	}
	saved, err := time.Parse(time.RFC3339, checkins[0].(map[string]any)["created_at"].(string))
	if err != nil {
		t.Fatalf("created_at invalido: %v", err)
	}
	wantAt, _ := time.Parse(time.RFC3339, at)
	if diff := saved.Sub(wantAt); diff < -time.Second || diff > time.Second {
		t.Fatalf("el created_at tendria que ser el del cliente (%s), es %s", wantAt, saved)
	}

	// Reintentar el mismo batch (respuesta perdida, el cliente reintenta):
	// idempotente, todo already_checked_in, nada duplicado.
	retry := door.post("/api/checkins/sync", batch)
	assertStatus(t, retry, http.StatusOK)
	for i, raw := range retry.Body["results"].([]any) {
		res := raw.(map[string]any)
		if res["result"] != "already_checked_in" {
			t.Fatalf("retry item %d tendria que ser already_checked_in: %v", i, res)
		}
	}
	after := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	if got := len(after.Body["checkins"].([]any)); got != 3 {
		t.Fatalf("el retry no puede duplicar: hay %d check-ins", got)
	}
}

// TestSyncDosDispositivosMismoTicket es el caso pedido por la aceptacion de
// la spec: dos dispositivos escanearon el mismo ticket estando offline; gana
// el primero que sincroniza y el otro recibe already_checked_in.
func TestSyncDosDispositivosMismoTicket(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)
	assignQuota(t, admin, fnID, 2, 50)

	codes := sellTickets(t, seller, fnID, "Maria Dutra", 1)
	payload := env.signer.Payload(codes[0])

	deviceA := time.Now().Add(-20 * time.Minute).Format(time.RFC3339)
	deviceB := time.Now().Add(-15 * time.Minute).Format(time.RFC3339)

	// El dispositivo A sincroniza primero: gana.
	syncA := door.post("/api/checkins/sync", map[string]any{
		"function_id": fnID, "device_id": "celu-A",
		"checkins": []map[string]any{{"method": "scan", "payload": payload, "at": deviceA}},
	})
	resA := syncA.Body["results"].([]any)[0].(map[string]any)
	if resA["result"] != "ok" {
		t.Fatalf("el primero en sincronizar tendria que ganar: %v", resA)
	}

	// El dispositivo B sincroniza despues: el server le dice que ya entro,
	// con la hora del ingreso ganador.
	syncB := door.post("/api/checkins/sync", map[string]any{
		"function_id": fnID, "device_id": "celu-B",
		"checkins": []map[string]any{{"method": "scan", "payload": payload, "at": deviceB}},
	})
	resB := syncB.Body["results"].([]any)[0].(map[string]any)
	if resB["result"] != "already_checked_in" {
		t.Fatalf("el segundo tendria que recibir already_checked_in: %v", resB)
	}
	winnerAt, _ := time.Parse(time.RFC3339, resB["checked_in_at"].(string))
	wantAt, _ := time.Parse(time.RFC3339, deviceA)
	if diff := winnerAt.Sub(wantAt); diff < -time.Second || diff > time.Second {
		t.Fatalf("la hora reportada tendria que ser la del ganador (%s), es %s", wantAt, winnerAt)
	}

	// Un solo check-in en la base.
	snapshot := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	if got := len(snapshot.Body["checkins"].([]any)); got != 1 {
		t.Fatalf("tendria que haber exactamente 1 check-in, hay %d", got)
	}
}

func TestSyncValidaCadaItem(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)
	assignQuota(t, admin, fnID, 2, 50)

	codes := sellTickets(t, seller, fnID, "Maria", 1)

	// Un batch mixto: valido, firma trucha, codigo inexistente, timestamp
	// futuro (reloj corrido) y metodo desconocido.
	future := time.Now().Add(2 * time.Hour).Format(time.RFC3339)
	resp := door.post("/api/checkins/sync", map[string]any{
		"function_id": fnID,
		"checkins": []map[string]any{
			{"method": "scan", "payload": env.signer.Payload(codes[0]), "at": future},
			{"method": "scan", "payload": codes[0] + ".firma-trucha", "at": future},
			{"method": "manual", "code": "NO-EXISTE", "at": future},
			{"method": "telepatia", "code": codes[0], "at": future},
		},
	})
	assertStatus(t, resp, http.StatusOK)
	results := resp.Body["results"].([]any)

	wants := []string{"ok", "invalid", "invalid", "invalid"}
	for i, want := range wants {
		if got := results[i].(map[string]any)["result"]; got != want {
			t.Fatalf("item %d: se esperaba %q, es %v", i, want, got)
		}
	}

	// El timestamp futuro se recorto a ahora, no viaja al futuro.
	at, _ := time.Parse(time.RFC3339, results[0].(map[string]any)["checked_in_at"].(string))
	if at.After(time.Now().Add(time.Minute)) {
		t.Fatalf("un timestamp futuro tendria que recortarse a ahora: %s", at)
	}
}
