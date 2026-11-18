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

func TestComposeInviteEmail(t *testing.T) {
	t.Parallel()

	invite := mail.ComposeInviteEmail(mail.InviteEmailData{
		Name:         "Josefina",
		Email:        "jose@gmail.com",
		RoleLabel:    "Corista",
		TempPassword: "ab12cd34",
		BaseURL:      "https://acapelius.test",
	})

	if invite.To != "jose@gmail.com" {
		t.Fatalf("destinatario: %q", invite.To)
	}
	if invite.Subject != "Tu acceso a Acapelius" {
		t.Fatalf("asunto de la invitacion: %q", invite.Subject)
	}
	if len(invite.Attachments) != 0 {
		t.Fatalf("la invitacion no lleva adjuntos: %d", len(invite.Attachments))
	}
	// Las dos versiones tienen que traer con que entrar.
	for _, body := range []string{invite.HTML, invite.Text} {
		for _, want := range []string{"Josefina", "jose@gmail.com", "ab12cd34", "https://acapelius.test"} {
			if !strings.Contains(body, want) {
				t.Fatalf("falta %q en el cuerpo:\n%s", want, body)
			}
		}
	}
	if !strings.Contains(invite.HTML, "Corista") {
		t.Fatalf("la invitacion dice con que rol entra")
	}

	// El reseteo reusa el cuerpo pero cambia el motivo.
	reset := mail.ComposeInviteEmail(mail.InviteEmailData{
		Name: "Josefina", Email: "jose@gmail.com", RoleLabel: "Corista",
		TempPassword: "zz99yy88", BaseURL: "https://acapelius.test", Reset: true,
	})
	if reset.Subject != "Tu nueva contrasena de Acapelius" {
		t.Fatalf("asunto del reseteo: %q", reset.Subject)
	}
	if !strings.Contains(reset.Text, "provisoria nueva") {
		t.Fatalf("el reseteo explica que la clave es nueva:\n%s", reset.Text)
	}
}

func TestComposeDetalleDeLaCompra(t *testing.T) {
	t.Parallel()

	data := sampleData()
	data.SaleCode = "01JD7Z8Q4X5M2PAK7QX9F3"
	data.PriceCents = 1200000
	data.AmountCents = 3600000
	data.PaidCents = 1200000
	data.PaymentMethod = "cash"
	data.SellerName = "Eli"
	data.BuyerPhone = "11 5555-1234"

	msg, err := mail.ComposeTicketEmail(data, fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	for _, body := range []string{msg.HTML, msg.Text} {
		for _, want := range []string{"Detalle de tu compra", "AK7QX9F3", "3 × $12.000", "$36.000", "efectivo", "Falta pagar", "$24.000", "Eli", "11 5555-1234"} {
			if !strings.Contains(body, want) {
				t.Fatalf("falta %q en el detalle:\n%s", want, body)
			}
		}
	}
	if strings.Contains(msg.Subject, "Cambio") {
		t.Fatalf("sin cambio de funcion el asunto no habla de cambio: %q", msg.Subject)
	}
}

func TestComposeCortesiaSinMontos(t *testing.T) {
	t.Parallel()

	data := sampleData()
	data.IsComp = true
	data.PriceCents = 1200000
	msg, err := mail.ComposeTicketEmail(data, fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	for _, body := range []string{msg.HTML, msg.Text} {
		if strings.Contains(body, "$") || strings.Contains(body, "Falta pagar") {
			t.Fatalf("una cortesia no muestra montos:\n%s", body)
		}
	}
}

func TestComposeCambioDeFuncion(t *testing.T) {
	t.Parallel()

	data := sampleData()
	antes := data.StartsAt
	data.StartsAt = antes.AddDate(0, 0, 7)
	data.PreviousStartsAt = &antes

	msg, err := mail.ComposeTicketEmail(data, fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	if !strings.HasPrefix(msg.Subject, "Cambio de fecha: tus 3 entradas") {
		t.Fatalf("asunto: %q", msg.Subject)
	}
	for _, body := range []string{msg.HTML, msg.Text} {
		for _, want := range []string{"Cambiamos la fecha", "sabado 5 de diciembre", "sabado 12 de diciembre", "siguen siendo los mismos"} {
			if !strings.Contains(body, want) {
				t.Fatalf("falta %q:\n%s", want, body)
			}
		}
	}
}

func TestComposeUbicacion(t *testing.T) {
	t.Parallel()

	data := sampleData()
	data.Address = "Marcelo T. de Alvear 1155, CABA"
	data.MapsURL = "https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8"
	msg, err := mail.ComposeTicketEmail(data, fakePNG)
	if err != nil {
		t.Fatalf("ComposeTicketEmail: %v", err)
	}
	for _, body := range []string{msg.HTML, msg.Text} {
		for _, want := range []string{"Marcelo T. de Alvear 1155, CABA", "https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8"} {
			if !strings.Contains(body, want) {
				t.Fatalf("falta %q:\n%s", want, body)
			}
		}
	}
	if !strings.Contains(msg.HTML, "Cómo llegar") {
		t.Fatal("el HTML tendria que tener el boton Como llegar")
	}

	// Sin link de Maps no hay boton.
	data.MapsURL = ""
	msg, _ = mail.ComposeTicketEmail(data, fakePNG)
	if strings.Contains(msg.HTML, "Cómo llegar") || strings.Contains(msg.HTML, "Google Maps") {
		t.Fatal("sin link no se muestra Como llegar")
	}
}
