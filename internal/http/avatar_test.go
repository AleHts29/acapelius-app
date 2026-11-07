package httpapi_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"testing"
)

// Un PNG de 1x1: alcanza para que DetectContentType lo reconozca.
var pngMinimo, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

func subirFoto(t *testing.T, c *testClient, data []byte) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, c.baseURL+"/api/me/avatar", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// Cada persona sube su foto; la ve cualquiera de su grupo; solo imagenes.
func TestFotoDePerfil(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	corista := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")

	if s := subirFoto(t, corista, []byte("no soy una imagen")); s != http.StatusBadRequest {
		t.Fatalf("un texto no es una foto: status %d", s)
	}
	if s := subirFoto(t, corista, pngMinimo); s != http.StatusOK {
		t.Fatalf("subir la foto: status %d", s)
	}

	me := corista.get("/api/me")
	if me.Body["user"].(map[string]any)["avatar_at"] == nil {
		t.Fatalf("/me tendria que traer la fecha de la foto: %v", me.Body)
	}
	carolinaID := me.Body["user"].(map[string]any)["id"].(float64)

	// Direccion la ve, y el equipo trae la fecha.
	foto := admin.getRaw(fmt.Sprintf("/api/users/%.0f/avatar", carolinaID))
	if foto.Status != http.StatusOK || !bytes.Equal([]byte(foto.Text), pngMinimo) {
		t.Fatalf("la foto no volvio igual: status %d", foto.Status)
	}
	var enEquipo bool
	for _, raw := range admin.get("/api/users").Body["members"].([]any) {
		if m := raw.(map[string]any); m["id"].(float64) == carolinaID && m["avatar_at"] != nil {
			enEquipo = true
		}
	}
	if !enEquipo {
		t.Fatal("el equipo tendria que traer avatar_at de Carolina")
	}

	// Sacarla: vuelve a no tener.
	assertStatus(t, corista.do(http.MethodDelete, "/api/me/avatar", nil), http.StatusNoContent)
	if s := admin.getRaw(fmt.Sprintf("/api/users/%.0f/avatar", carolinaID)).Status; s != http.StatusNotFound {
		t.Fatalf("sin foto tendria que dar 404, dio %d", s)
	}
}

// Cada persona edita su nombre y su mail; no puede pisar el mail de otra.
func TestEditarMiPerfil(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	corista := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")

	assertStatus(t, corista.do(http.MethodPatch, "/api/me", map[string]any{"name": "  Carolina Vega ", "email": "Caro.Vega@Acapelius.test"}), http.StatusNoContent)
	me := corista.get("/api/me").Body["user"].(map[string]any)
	if me["name"] != "Carolina Vega" || me["email"] != "caro.vega@acapelius.test" {
		t.Fatalf("no se guardaron los datos: %v", me)
	}
	assertErrorCode(t, corista.do(http.MethodPatch, "/api/me", map[string]any{"name": "", "email": "x@y.com"}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, corista.do(http.MethodPatch, "/api/me", map[string]any{"name": "C", "email": "no-es-mail"}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, corista.do(http.MethodPatch, "/api/me", map[string]any{"name": "C", "email": "vale@acapelius.test"}), http.StatusConflict, "conflict")
}
