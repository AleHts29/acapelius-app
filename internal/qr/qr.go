// Package qr firma los codigos de ticket con HMAC y genera los PNG de los QR.
//
// El payload del QR es `{ticket_code}.{firma}`, donde la firma es
// base64url(HMAC-SHA256(ticket_code, secret)) truncada a 16 bytes (spec §6).
// El QR no lleva datos personales: el nombre se resuelve contra el snapshot.
package qr

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// signatureBytes es el largo de la firma truncada. 16 bytes = 128 bits: mas
// que suficiente para impedir forjar un payload sin el secreto.
const signatureBytes = 16

// Signer firma y verifica payloads de tickets.
type Signer struct {
	secret []byte
}

// NewSigner crea un Signer con el SERVER_SECRET de la config.
func NewSigner(secret []byte) *Signer {
	return &Signer{secret: secret}
}

func (s *Signer) signature(code string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(code))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:signatureBytes])
}

// Payload arma el contenido del QR para un codigo de ticket.
func (s *Signer) Payload(code string) string {
	return code + "." + s.signature(code)
}

// Verify valida un payload y devuelve el codigo de ticket que contiene.
// La comparacion es de tiempo constante.
func (s *Signer) Verify(payload string) (code string, ok bool) {
	code, sig, found := strings.Cut(payload, ".")
	if !found || code == "" {
		return "", false
	}
	if !hmac.Equal([]byte(sig), []byte(s.signature(code))) {
		return "", false
	}
	return code, true
}

// pngSize esta pensado para el email y la pagina publica: grande para que
// cualquier camara lo lea, chico para no inflar el mensaje.
const pngSize = 512

// PNG genera la imagen del QR para un codigo de ticket, firma incluida.
func (s *Signer) PNG(code string) ([]byte, error) {
	png, err := qrcode.Encode(s.Payload(code), qrcode.Medium, pngSize)
	if err != nil {
		return nil, fmt.Errorf("generar QR: %w", err)
	}
	return png, nil
}
