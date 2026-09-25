package httpapi_test

import (
	"net/http"
	"testing"
)

// El alta de cuenta (C17 §B.3): una organizacion, su direccion y la primera
// temporada en una transaccion, con la sesion abierta al terminar.
func TestAltaDeCuenta(t *testing.T) {
	env := newTestEnv(t)
	c := env.client(t)

	alta := c.post("/api/signup", map[string]string{
		"org_name": "Compañía El Ático", "kind": "theatre",
		"name": "Rocío Paz", "email": "Rocio@atico.test", "password": "temporada-de-otoño",
	})
	assertStatus(t, alta, http.StatusCreated)
	u := alta.user()
	if u["role"] != "admin" || u["organization_kind"] != "theatre" || u["organization_name"] != "Compañía El Ático" || u["must_change_password"] != false {
		t.Fatalf("la direccion recien creada no es lo que se esperaba: %v", u)
	}

	// Quedo adentro: /me responde con la misma persona, y ya tiene temporada.
	me := c.get("/api/me")
	assertStatus(t, me, http.StatusOK)
	if me.user()["email"] != "rocio@atico.test" {
		t.Fatalf("la sesion no quedo abierta: %v", me.Body)
	}
	temporadas := c.get("/api/seasons")
	assertStatus(t, temporadas, http.StatusOK)
	lista := temporadas.Body["seasons"].([]any)
	if len(lista) != 1 || lista[0].(map[string]any)["is_active"] != true {
		t.Fatalf("tendria que haber una temporada en curso: %v", lista)
	}
	// Y puede administrar: crear una funcion en su temporada.
	fn := c.post("/api/functions", map[string]any{
		"season_id": lista[0].(map[string]any)["id"], "venue": "Sala chica",
		"starts_at": "2026-11-20T21:00:00-03:00", "capacity": 40, "price_cents": 500000,
	})
	assertStatus(t, fn, http.StatusCreated)

	// El slug sale del nombre; el segundo grupo con el mismo nombre lleva sufijo.
	otra := env.client(t)
	assertStatus(t, otra.post("/api/signup", map[string]string{
		"org_name": "Compañía El Ático", "kind": "other",
		"name": "Otra Rocío", "email": "rocio@atico.test", "password": "otra-clave-larga",
	}), http.StatusCreated)
	var slugs []string
	rows, err := env.pool.Query(t.Context(), "SELECT slug FROM organizations ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		slugs = append(slugs, s)
	}
	if len(slugs) != 2 || slugs[0] != "compania-el-atico" || slugs[1] != "compania-el-atico-2" {
		t.Fatalf("slugs = %v", slugs)
	}
	// Mismo email en dos organizaciones: cada una es una cuenta distinta.
	if otra.get("/api/me").user()["organization_id"] == me.user()["organization_id"] {
		t.Fatal("el segundo alta tendria que ser otra organizacion")
	}
}

func TestAltaDeCuentaValidaciones(t *testing.T) {
	env := newTestEnv(t)
	c := env.client(t)
	base := map[string]string{
		"org_name": "Coro", "kind": "choir", "name": "Eli", "email": "eli@coro.test", "password": "clave-suficiente",
	}
	con := func(k, v string) map[string]string {
		m := map[string]string{}
		for kk, vv := range base {
			m[kk] = vv
		}
		m[k] = v
		return m
	}
	for nombre, body := range map[string]map[string]string{
		"sin grupo":   con("org_name", "  "),
		"tipo raro":   con("kind", "banda"),
		"clave corta": con("password", "corta-123"),
		"email malo":  con("email", "eli"),
		// (Cuatro casos y el honeypot: cinco requests, justo el limite por IP.)
	} {
		assertErrorCode(t, c.post("/api/signup", body), http.StatusBadRequest, "validation_error")
		if _, ok := c.get("/api/me").Body["user"]; ok {
			t.Fatalf("%s: no tendria que haber abierto sesion", nombre)
		}
	}

	// Honeypot: "listo" vacio, sin cuenta ni sesion.
	trampa := c.post("/api/signup", con("website", "http://spam.example"))
	assertStatus(t, trampa, http.StatusCreated)
	if _, ok := trampa.Body["user"]; ok {
		t.Fatal("el honeypot no tendria que crear nada")
	}
	assertStatus(t, c.get("/api/me"), http.StatusUnauthorized)
	var n int
	_ = env.pool.QueryRow(t.Context(), "SELECT count(*) FROM organizations").Scan(&n)
	if n != 0 {
		t.Fatalf("hay %d organizaciones; el honeypot y las validaciones no crean ninguna", n)
	}
}

func TestAltaDeCuentaTieneLimitePorIP(t *testing.T) {
	env := newTestEnv(t)
	c := env.client(t)
	// Las validaciones tambien cuentan: el limite es por request, no por alta.
	for i := 0; i < 5; i++ {
		assertStatus(t, c.post("/api/signup", map[string]string{"org_name": ""}), http.StatusBadRequest)
	}
	assertStatus(t, c.post("/api/signup", map[string]string{"org_name": ""}), http.StatusTooManyRequests)
}
