package mail_test

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ale-hts/acapelius/internal/mail"
)

func sampleData() mail.TicketEmailData {
	return mail.TicketEmailData{
		BuyerName:   "Maria Dutra",
		BuyerEmail:  "maria@gmail.com",
		Venue:       "Teatro Municipal",
		StartsAt:    time.Date(2026, 12, 5, 21, 0, 0, 0, time.FixedZone("-03", -3*3600)),
		Quantity:    3,
		PublicURL:   "https://acapelius.test/e/SALE123",
		TicketCodes: []string{"T1", "T2", "T3"},
		BaseURL:     "https://acapelius.test",
	}
}

func fakePNG(code string) ([]byte, error) {
	return []byte("png-de-" + code), nil
}

func TestComposeTicketEmail(t *testing.T) {
	t.Parallel()

	msg, err := mail.ComposeTicketEmail(sampleData(), fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}

	if msg.To != "maria@gmail.com" {
		t.Fatalf("destinatario %q", msg.To)
	}
	if !strings.Contains(msg.Subject, "3 entradas") {
		t.Fatalf("el asunto no menciona la cantidad: %q", msg.Subject)
	}
	if len(msg.Attachments) != 3 {
		t.Fatalf("se esperaban 3 QR adjuntos, hay %d", len(msg.Attachments))
	}

	for _, want := range []string{"Maria Dutra", "Teatro Municipal", "sabado 5 de diciembre, 21:00 hs", "https://acapelius.test/e/SALE123", "Entrada general"} {
		if !strings.Contains(msg.Text, want) {
			t.Fatalf("el texto no contiene %q:\n%s", want, msg.Text)
		}
	}
	for _, code := range []string{"T1", "T2", "T3"} {
		if !strings.Contains(msg.HTML, "/api/public/tickets/"+code+".png") {
			t.Fatalf("el HTML no referencia el QR de %s", code)
		}
	}
}

func TestComposeCortesia(t *testing.T) {
	t.Parallel()

	data := sampleData()
	data.IsComp = true
	data.Quantity = 1
	data.TicketCodes = []string{"T1"}

	msg, err := mail.ComposeTicketEmail(data, fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	if !strings.Contains(msg.Text, "cortesia") {
		t.Fatalf("una cortesia tendria que decirlo: %s", msg.Text)
	}
	if !strings.Contains(msg.Subject, "Tu entrada") {
		t.Fatalf("singular mal pluralizado: %q", msg.Subject)
	}
}

func TestLogDriverEscribeElEmail(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	driver := mail.NewLogDriver(&buf)

	msg, err := mail.ComposeTicketEmail(sampleData(), fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	if err := driver.Send(context.Background(), msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	out := buf.String()
	for _, want := range []string{"maria@gmail.com", "entrada-1-de-3.png", "entrada-2-de-3.png", "entrada-3-de-3.png", "Teatro Municipal"} {
		if !strings.Contains(out, want) {
			t.Fatalf("la salida del driver log no contiene %q:\n%s", want, out)
		}
	}
}
