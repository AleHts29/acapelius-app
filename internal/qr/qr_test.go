package qr_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/qr"
)

var secret = []byte("test-secret-con-mas-de-32-bytes-para-firmar")

func TestPayloadRoundTrip(t *testing.T) {
	t.Parallel()

	signer := qr.NewSigner(secret)
	payload := signer.Payload("01JGXH2M5NQR8VWXYZ0123456A")

	code, ok := signer.Verify(payload)
	if !ok {
		t.Fatal("un payload recien firmado tendria que verificar")
	}
	if code != "01JGXH2M5NQR8VWXYZ0123456A" {
		t.Fatalf("codigo recuperado %q", code)
	}
}

func TestVerifyRechazaAlteraciones(t *testing.T) {
	t.Parallel()

	signer := qr.NewSigner(secret)
	payload := signer.Payload("TICKET1")

	bad := []string{
		"",            // vacio
		"TICKET1",     // sin firma
		"TICKET1.",    // firma vacia
		".firma",      // sin codigo
		payload + "x", // firma alterada
		strings.Replace(payload, "TICKET1", "TICKET2", 1), // otro codigo con firma ajena
	}
	for _, p := range bad {
		if _, ok := signer.Verify(p); ok {
			t.Fatalf("Verify(%q) tendria que fallar", p)
		}
	}

	// Un secreto distinto no puede validar la firma.
	other := qr.NewSigner([]byte("otro-secreto-igual-de-largo-que-el-primero"))
	if _, ok := other.Verify(payload); ok {
		t.Fatal("una firma de otro secreto no puede validar")
	}
}

func TestPayloadNoContieneDatosPersonales(t *testing.T) {
	t.Parallel()

	signer := qr.NewSigner(secret)
	payload := signer.Payload("01JGXH2M5NQR8VWXYZ0123456A")

	// Solo codigo.firma, sin nada mas.
	parts := strings.Split(payload, ".")
	if len(parts) != 2 {
		t.Fatalf("payload con forma inesperada: %q", payload)
	}
}

func TestPNG(t *testing.T) {
	t.Parallel()

	signer := qr.NewSigner(secret)
	png, err := signer.PNG("TICKET1")
	if err != nil {
		t.Fatalf("PNG: %v", err)
	}
	if !bytes.HasPrefix(png, []byte("\x89PNG")) {
		t.Fatal("la salida no es un PNG")
	}
}
