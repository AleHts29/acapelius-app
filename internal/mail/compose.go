package mail

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// TicketEmailData es todo lo que necesita el email de la entrada.
type TicketEmailData struct {
	BuyerName    string
	BuyerEmail   string
	FunctionName string // opcional
	Venue        string
	StartsAt     time.Time
	Quantity     int
	IsComp       bool
	PublicURL    string   // BASE_URL/e/{sale_code}
	TicketCodes  []string // para los nombres de adjuntos y las imagenes
	BaseURL      string
}

var monthNames = [...]string{
	"enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
}

var dayNames = [...]string{
	"domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado",
}

// formatStartsAt formatea en castellano sin depender del locale del sistema:
// "viernes 5 de diciembre, 21:00 hs".
func formatStartsAt(t time.Time) string {
	local := t.Local()
	return fmt.Sprintf("%s %d de %s, %02d:%02d hs",
		dayNames[local.Weekday()], local.Day(), monthNames[local.Month()-1],
		local.Hour(), local.Minute())
}

// ComposeTicketEmail arma el mensaje de la entrada (spec §7): datos de la
// funcion, un QR por entrada y el link a la pagina publica. Los QR van como
// imagen hosteada (los clientes de mail cargan imagenes remotas) y ademas
// adjuntos, y el link publico cubre cualquier cliente que bloquee todo.
func ComposeTicketEmail(data TicketEmailData, qrPNG func(code string) ([]byte, error)) (Message, error) {
	eventName := "Acapelius"
	if data.FunctionName != "" {
		eventName = data.FunctionName
	}

	plural := "entrada"
	subjectLead := "Tu entrada"
	if data.Quantity > 1 {
		plural = "entradas"
		subjectLead = fmt.Sprintf("Tus %d entradas", data.Quantity)
	}
	subject := fmt.Sprintf("%s para %s — %s", subjectLead, eventName, formatStartsAt(data.StartsAt))

	var textB strings.Builder
	fmt.Fprintf(&textB, "Hola %s:\n\n", data.BuyerName)
	if data.IsComp {
		fmt.Fprintf(&textB, "Tenes %d %s de cortesia para %s.\n", data.Quantity, plural, eventName)
	} else {
		fmt.Fprintf(&textB, "Aca van tus %d %s para %s.\n", data.Quantity, plural, eventName)
	}
	fmt.Fprintf(&textB, "\nCuando:  %s\nDonde:   %s\n", formatStartsAt(data.StartsAt), data.Venue)
	fmt.Fprintf(&textB, "\nEntrada general, sin numerar.\n")
	fmt.Fprintf(&textB, "\nTu entrada online (mostrala desde el celular si no te llegan los QR):\n%s\n", data.PublicURL)

	var htmlB strings.Builder
	esc := html.EscapeString
	fmt.Fprintf(&htmlB, `<div style="font-family:sans-serif;max-width:32rem;margin:0 auto;color:#222">`)
	fmt.Fprintf(&htmlB, `<h1 style="font-size:1.3rem">%s</h1>`, esc(eventName))
	fmt.Fprintf(&htmlB, `<p>Hola %s:</p>`, esc(data.BuyerName))
	if data.IsComp {
		fmt.Fprintf(&htmlB, `<p>Tenes <strong>%d %s de cortesia</strong>.</p>`, data.Quantity, plural)
	} else {
		fmt.Fprintf(&htmlB, `<p>Aca van tus <strong>%d %s</strong>.</p>`, data.Quantity, plural)
	}
	fmt.Fprintf(&htmlB, `<p><strong>%s</strong><br>%s</p>`, esc(formatStartsAt(data.StartsAt)), esc(data.Venue))
	fmt.Fprintf(&htmlB, `<p style="color:#666">Entrada general, sin numerar. Presenta un QR por persona en la puerta.</p>`)
	for i, code := range data.TicketCodes {
		fmt.Fprintf(&htmlB, `<p style="text-align:center"><img src="%s/api/public/tickets/%s.png" width="240" height="240" alt="Entrada %d"><br>Entrada %d de %d</p>`,
			data.BaseURL, esc(code), i+1, i+1, data.Quantity)
	}
	fmt.Fprintf(&htmlB, `<p><a href="%s">Ver mi entrada online</a> — guarda este link: sirve para mostrarla o reenviarla.</p>`, data.PublicURL)
	fmt.Fprintf(&htmlB, `</div>`)

	msg := Message{
		To:      data.BuyerEmail,
		Subject: subject,
		HTML:    htmlB.String(),
		Text:    textB.String(),
	}

	// Adjuntos: un PNG por entrada, por si el cliente bloquea imagenes remotas.
	for i, code := range data.TicketCodes {
		png, err := qrPNG(code)
		if err != nil {
			return Message{}, err
		}
		msg.Attachments = append(msg.Attachments, Attachment{
			Filename:    fmt.Sprintf("entrada-%d-de-%d.png", i+1, data.Quantity),
			ContentType: "image/png",
			Content:     png,
		})
	}
	return msg, nil
}
