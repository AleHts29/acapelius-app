package mail_test

import (
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	netmail "net/mail"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/mail"
)

// TestBuildMIMERoundTrip construye el email y lo vuelve a parsear con las
// libs estandar: si Gmail no lo puede leer, esto tiene que fallar antes.
func TestBuildMIMERoundTrip(t *testing.T) {
	t.Parallel()

	msg, err := mail.ComposeTicketEmail(sampleData(), fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}

	raw, err := mail.BuildMIME("Acapelius <acapelius@gmail.com>", msg)
	if err != nil {
		t.Fatalf("BuildMIME: %v", err)
	}

	parsed, err := netmail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("el mensaje no parsea como email: %v", err)
	}

	// Cabeceras.
	if got := parsed.Header.Get("From"); got != "Acapelius <acapelius@gmail.com>" {
		t.Fatalf("From = %q", got)
	}
	if got := parsed.Header.Get("To"); got != "maria@gmail.com" {
		t.Fatalf("To = %q", got)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil || !strings.Contains(subject, "Tus 3 entradas") {
		t.Fatalf("Subject decodificado = %q (err %v)", subject, err)
	}

	mediaType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/mixed" {
		t.Fatalf("Content-Type raiz = %q (err %v)", mediaType, err)
	}

	// Estructura: alternative (texto+html) + 3 adjuntos PNG.
	var textBody, htmlBody string
	var attachments []string
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("leer part: %v", err)
		}
		partType, partParams, _ := mime.ParseMediaType(part.Header.Get("Content-Type"))
		switch {
		case partType == "multipart/alternative":
			alt := multipart.NewReader(part, partParams["boundary"])
			for {
				sub, err := alt.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatalf("leer alternativa: %v", err)
				}
				body, _ := io.ReadAll(quotedprintable.NewReader(sub))
				subType, _, _ := mime.ParseMediaType(sub.Header.Get("Content-Type"))
				if subType == "text/plain" {
					textBody = string(body)
				} else if subType == "text/html" {
					htmlBody = string(body)
				}
			}
		case partType == "image/png":
			attachments = append(attachments, part.FileName())
			// El transfer encoding declarado tiene que ser base64.
			if enc := part.Header.Get("Content-Transfer-Encoding"); enc != "base64" {
				t.Fatalf("adjunto %s con encoding %q", part.FileName(), enc)
			}
		default:
			t.Fatalf("part inesperado: %q", partType)
		}
	}

	if !strings.Contains(textBody, "Maria Dutra") || !strings.Contains(textBody, "Teatro Municipal") {
		t.Fatalf("texto incompleto:\n%s", textBody)
	}
	if !strings.Contains(htmlBody, "/api/public/tickets/T1.png") {
		t.Fatalf("html sin los QR:\n%s", htmlBody)
	}
	if len(attachments) != 3 || attachments[0] != "entrada-1-de-3.png" {
		t.Fatalf("adjuntos = %v", attachments)
	}
}

func TestBuildMIMELineasCortas(t *testing.T) {
	t.Parallel()

	// SMTP corta lineas de mas de 998 bytes; el HTML largo va en
	// quoted-printable (max 76) y el base64 se parte a mano.
	msg, err := mail.ComposeTicketEmail(sampleData(), func(string) ([]byte, error) {
		return make([]byte, 4096), nil // adjunto grande para forzar el partido
	})
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	raw, err := mail.BuildMIME("Acapelius <a@b.com>", msg)
	if err != nil {
		t.Fatalf("BuildMIME: %v", err)
	}
	for i, line := range strings.Split(string(raw), "\r\n") {
		if len(line) > 998 {
			t.Fatalf("linea %d de %d bytes; SMTP corta en 998", i, len(line))
		}
	}
}
