package domain

import "testing"

func TestSlugify(t *testing.T) {
	casos := map[string]string{
		"Coro Acapelius":              "coro-acapelius",
		"  Elenco   Las Ñandúes  ":    "elenco-las-nandues",
		"Ópera de Cámara (2026)":      "opera-de-camara-2026",
		"---":                         "grupo",
		"Compañía Teatral El Ático!!": "compania-teatral-el-atico",
	}
	for in, want := range casos {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}

func TestValidateSignup(t *testing.T) {
	ok := ValidateSignup("Coro", KindChoir, "Eli", "eli@coro.test", "una-clave-larga")
	if ok != nil {
		t.Fatalf("alta valida rechazada: %v", ok)
	}
	casos := []struct {
		nombre string
		err    error
	}{
		{"sin grupo", ErrOrgNameRequired},
		{"tipo raro", ErrOrgKindInvalid},
		{"clave corta", ErrSignupPasswordShort},
		{"email malo", ErrEmailInvalid},
	}
	got := []error{
		ValidateSignup("  ", KindChoir, "Eli", "eli@coro.test", "una-clave-larga"),
		ValidateSignup("Coro", "banda", "Eli", "eli@coro.test", "una-clave-larga"),
		ValidateSignup("Coro", KindChoir, "Eli", "eli@coro.test", "corta-123"),
		ValidateSignup("Coro", KindChoir, "Eli", "eli", "una-clave-larga"),
	}
	for i, c := range casos {
		if got[i] != c.err {
			t.Errorf("%s: %v, se esperaba %v", c.nombre, got[i], c.err)
		}
	}
}
