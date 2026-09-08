package mail

import (
	"fmt"
	"html"
	"strconv"
	"strings"
	"time"
)

// Paleta de marca de Acapelius (ver Logos Final / paleta de color).
const (
	brandBlue  = "#415DA7"
	brandCream = "#F8ECDE"
	brandInk   = "#1D1D1B"
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

// ComposeTicketEmail arma el mensaje de la entrada (spec §7) con la identidad
// de Acapelius: cabecera azul con el logo, tarjetas crema, una tarjeta por
// entrada con su QR y su link individual (para reenviarle a cada persona la
// suya), y el boton a la pagina publica como respaldo universal. Los QR van
// como imagen hosteada + adjuntos PNG.
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

	// --- Version texto plano -------------------------------------------------
	var textB strings.Builder
	fmt.Fprintf(&textB, "Hola %s:\n\n", data.BuyerName)
	if data.IsComp {
		fmt.Fprintf(&textB, "Tenes %d %s de cortesia para %s.\n", data.Quantity, plural, eventName)
	} else {
		fmt.Fprintf(&textB, "Aca van tus %d %s para %s.\n", data.Quantity, plural, eventName)
	}
	fmt.Fprintf(&textB, "\nCuando:  %s\nDonde:   %s\n", formatStartsAt(data.StartsAt), data.Venue)
	fmt.Fprintf(&textB, "\nEntrada general, sin numerar. Un QR por persona en la puerta.\n")
	fmt.Fprintf(&textB, "\nTus entradas online:\n%s\n", data.PublicURL)
	if len(data.TicketCodes) > 1 {
		fmt.Fprintf(&textB, "\nPara reenviarle a cada persona la suya:\n")
		for i, code := range data.TicketCodes {
			fmt.Fprintf(&textB, "  Entrada %d: %s/t/%s\n", i+1, data.BaseURL, code)
		}
	}

	// --- Version HTML --------------------------------------------------------
	esc := html.EscapeString
	var b strings.Builder

	fmt.Fprintf(&b, `<div style="margin:0;padding:24px 12px;background:%s;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`, brandCream)
	fmt.Fprintf(&b, `<div style="max-width:520px;margin:0 auto">`)

	// Cabecera azul con el logo.
	fmt.Fprintf(&b, `<div style="background:%s;border-radius:16px 16px 0 0;padding:22px 24px;text-align:center">`, brandBlue)
	fmt.Fprintf(&b, `<img src="%s/email-logo.png" alt="Acapelius" width="200" style="max-width:60%%;height:auto">`, data.BaseURL)
	fmt.Fprintf(&b, `</div>`)

	// Cuerpo.
	fmt.Fprintf(&b, `<div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;color:%s">`, brandInk)
	fmt.Fprintf(&b, `<h1 style="margin:0 0 4px;font-size:22px">%s</h1>`, esc(eventName))
	fmt.Fprintf(&b, `<p style="margin:0 0 18px;color:#666">%s · %s</p>`, esc(formatStartsAt(data.StartsAt)), esc(data.Venue))

	fmt.Fprintf(&b, `<p style="margin:0 0 6px">Hola %s:</p>`, esc(data.BuyerName))
	if data.IsComp {
		fmt.Fprintf(&b, `<p style="margin:0 0 18px">Tenes <strong>%d %s de cortesia</strong>. ¡Te esperamos!</p>`, data.Quantity, plural)
	} else {
		fmt.Fprintf(&b, `<p style="margin:0 0 18px">Aca %s <strong>%d %s</strong>. ¡Te esperamos!</p>`,
			map[bool]string{true: "va tu", false: "van tus"}[data.Quantity == 1], data.Quantity, plural)
	}

	// Una tarjeta por entrada, con su QR y su link individual.
	for i, code := range data.TicketCodes {
		fmt.Fprintf(&b, `<div style="border:2px solid %s;border-radius:14px;padding:18px 16px;margin:0 0 14px;text-align:center;background:%s">`, brandBlue, brandCream)
		fmt.Fprintf(&b, `<p style="margin:0 0 10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:12px;color:%s">Entrada %d de %d</p>`, brandBlue, i+1, data.Quantity)
		fmt.Fprintf(&b, `<img src="%s/api/public/tickets/%s.png" width="220" height="220" alt="QR de la entrada %d" style="background:#fff;border-radius:10px">`, data.BaseURL, esc(code), i+1)
		if data.Quantity > 1 {
			fmt.Fprintf(&b, `<p style="margin:12px 0 0;font-size:13px"><a href="%s/t/%s" style="color:%s">Reenviar solo esta entrada →</a></p>`, data.BaseURL, esc(code), brandBlue)
		}
		fmt.Fprintf(&b, `</div>`)
	}

	// Boton principal.
	fmt.Fprintf(&b, `<div style="text-align:center;margin:22px 0 8px">`)
	fmt.Fprintf(&b, `<a href="%s" style="display:inline-block;background:%s;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px">Ver mis entradas online</a>`, data.PublicURL, brandBlue)
	fmt.Fprintf(&b, `</div>`)
	fmt.Fprintf(&b, `<p style="margin:0;text-align:center;color:#888;font-size:12px">Guarda este email: el boton sirve para mostrar o reenviar las entradas.<br>Entrada general, sin numerar. Un QR por persona en la puerta.</p>`)

	fmt.Fprintf(&b, `</div></div></div>`)

	msg := Message{
		To:      data.BuyerEmail,
		Subject: subject,
		HTML:    b.String(),
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

// InviteEmailData es lo que necesita el email de acceso al equipo (C7).
type InviteEmailData struct {
	Name         string
	Email        string
	RoleLabel    string // "Corista", "Puerta", "Direccion"
	TempPassword string
	BaseURL      string
	// Reset distingue el reseteo de contrasena de la invitacion inicial: el
	// cuerpo es casi el mismo, lo que cambia es el motivo.
	Reset bool
}

// ComposeInviteEmail arma la invitacion al equipo: quien la manda, con que
// email entra, la contrasena provisoria y el boton para entrar. Sin adjuntos
// ni QR — es un email de texto con la identidad de Acapelius.
func ComposeInviteEmail(data InviteEmailData) Message {
	subject := "Tu acceso a Acapelius"
	lead := fmt.Sprintf("Te damos acceso a Acapelius como <strong>%s</strong>. Con estos datos entras la primera vez:",
		html.EscapeString(data.RoleLabel))
	leadText := fmt.Sprintf("Te damos acceso a Acapelius como %s. Con estos datos entras la primera vez:", data.RoleLabel)
	if data.Reset {
		subject = "Tu nueva contrasena de Acapelius"
		lead = "Te generamos una contrasena provisoria nueva. Con estos datos entras:"
		leadText = "Te generamos una contrasena provisoria nueva. Con estos datos entras:"
	}

	// --- Version texto plano -------------------------------------------------
	var textB strings.Builder
	fmt.Fprintf(&textB, "Hola %s:\n\n%s\n\n", data.Name, leadText)
	fmt.Fprintf(&textB, "  Direccion: %s\n  Email:     %s\n  Clave:     %s\n",
		data.BaseURL, data.Email, data.TempPassword)
	fmt.Fprintf(&textB, "\nApenas entres te va a pedir elegir tu propia contrasena.\n")
	fmt.Fprintf(&textB, "Esta clave es provisoria: no se la pases a nadie.\n")

	// --- Version HTML --------------------------------------------------------
	esc := html.EscapeString
	var b strings.Builder

	fmt.Fprintf(&b, `<div style="margin:0;padding:24px 12px;background:%s;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`, brandCream)
	fmt.Fprintf(&b, `<div style="max-width:520px;margin:0 auto">`)

	fmt.Fprintf(&b, `<div style="background:%s;border-radius:16px 16px 0 0;padding:22px 24px;text-align:center">`, brandBlue)
	fmt.Fprintf(&b, `<img src="%s/email-logo.png" alt="Acapelius" width="200" style="max-width:60%%;height:auto">`, data.BaseURL)
	fmt.Fprintf(&b, `</div>`)

	fmt.Fprintf(&b, `<div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;color:%s">`, brandInk)
	fmt.Fprintf(&b, `<h1 style="margin:0 0 14px;font-size:22px">Hola %s:</h1>`, esc(data.Name))
	fmt.Fprintf(&b, `<p style="margin:0 0 18px">%s</p>`, lead)

	// Tarjeta con las credenciales, en monoespaciada para que se lean bien.
	fmt.Fprintf(&b, `<div style="border:2px solid %s;border-radius:14px;padding:18px 16px;margin:0 0 18px;background:%s">`, brandBlue, brandCream)
	fmt.Fprintf(&b, `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:%s">Tus datos de acceso</p>`, brandBlue)
	fmt.Fprintf(&b, `<p style="margin:0 0 6px;font-size:14px">Email<br><strong style="font-family:ui-monospace,Menlo,Consolas,monospace">%s</strong></p>`, esc(data.Email))
	fmt.Fprintf(&b, `<p style="margin:0;font-size:14px">Contrasena provisoria<br><strong style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:.04em">%s</strong></p>`, esc(data.TempPassword))
	fmt.Fprintf(&b, `</div>`)

	fmt.Fprintf(&b, `<div style="text-align:center;margin:22px 0 8px">`)
	fmt.Fprintf(&b, `<a href="%s" style="display:inline-block;background:%s;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px">Entrar a Acapelius</a>`, data.BaseURL, brandBlue)
	fmt.Fprintf(&b, `</div>`)
	fmt.Fprintf(&b, `<p style="margin:0;text-align:center;color:#888;font-size:12px">Apenas entres te va a pedir elegir tu propia contrasena.<br>Esta clave es provisoria: no se la pases a nadie.</p>`)

	fmt.Fprintf(&b, `</div></div></div>`)

	return Message{
		To:      data.Email,
		Subject: subject,
		HTML:    b.String(),
		Text:    textB.String(),
	}
}

// ReminderSale es una venta cobrada que la corista todavia no rindio.
type ReminderSale struct {
	BuyerName    string
	FunctionName string
	Quantity     int32
	PaidCents    int64
	PaidAt       time.Time
}

// ReminderEmailData es lo que necesita el recordatorio de rendicion.
type ReminderEmailData struct {
	Name       string
	Email      string
	SeasonName string
	DebtCents  int64
	Sales      []ReminderSale
	BaseURL    string
	SenderName string
}

/*
ComposeReminderEmail arma el recordatorio de rendicion.

El mail lleva el detalle completo —que venta, de quien, cuando la cobro— y no
solo el total. Un "debes $112.000" a secas obliga a la corista a reconstruir de
memoria de donde sale, y en esa reconstruccion aparecen las discusiones. Con el
detalle enfrente, o esta de acuerdo o senala exactamente cual fila esta mal.
*/
func ComposeReminderEmail(data ReminderEmailData) Message {
	esc := html.EscapeString

	// --- Version texto plano -------------------------------------------------
	var textB strings.Builder
	fmt.Fprintf(&textB, "Hola %s:\n\n", data.Name)
	fmt.Fprintf(&textB, "Segun Acapelius tenes %s cobrados de la %s que todavia no rendiste.\n\n",
		Money(data.DebtCents), data.SeasonName)
	if len(data.Sales) > 0 {
		fmt.Fprintf(&textB, "De donde sale:\n")
		for _, s := range data.Sales {
			fmt.Fprintf(&textB, "  %-22s %-18s %s  (%s)\n",
				s.BuyerName, s.FunctionName, Money(s.PaidCents), s.PaidAt.Format("02/01"))
		}
		fmt.Fprintf(&textB, "\n  Total: %s\n", Money(data.DebtCents))
	}
	fmt.Fprintf(&textB, "\nSi algo no coincide, avisale a %s.\n", data.SenderName)

	// --- Version HTML --------------------------------------------------------
	var b strings.Builder
	fmt.Fprintf(&b, `<div style="margin:0;padding:24px 12px;background:%s;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`, brandCream)
	fmt.Fprintf(&b, `<div style="max-width:520px;margin:0 auto">`)
	fmt.Fprintf(&b, `<div style="background:%s;border-radius:16px 16px 0 0;padding:22px 24px;text-align:center">`, brandBlue)
	fmt.Fprintf(&b, `<img src="%s/email-logo.png" alt="Acapelius" width="200" style="max-width:60%%;height:auto">`, data.BaseURL)
	fmt.Fprintf(&b, `</div>`)

	fmt.Fprintf(&b, `<div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;color:%s">`, brandInk)
	fmt.Fprintf(&b, `<h1 style="margin:0 0 14px;font-size:22px">Hola %s:</h1>`, esc(data.Name))
	fmt.Fprintf(&b, `<p style="margin:0 0 18px">Tenes <strong>%s</strong> cobrados de la %s que todavia no rendiste.</p>`,
		Money(data.DebtCents), esc(data.SeasonName))

	if len(data.Sales) > 0 {
		fmt.Fprintf(&b, `<table style="width:100%%;border-collapse:collapse;font-size:14px;margin:0 0 18px">`)
		fmt.Fprintf(&b, `<tr><th align="left" style="padding:6px 0;border-bottom:2px solid %s;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#888">De quien</th>`, brandCream)
		fmt.Fprintf(&b, `<th align="right" style="padding:6px 0;border-bottom:2px solid %s;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#888">Cobraste</th></tr>`, brandCream)
		for _, s := range data.Sales {
			fmt.Fprintf(&b, `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>%s</strong><br><span style="color:#888;font-size:12px">%s · %s</span></td>`,
				esc(s.BuyerName), esc(s.FunctionName), s.PaidAt.Format("02/01"))
			fmt.Fprintf(&b, `<td align="right" style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap"><strong>%s</strong></td></tr>`,
				Money(s.PaidCents))
		}
		fmt.Fprintf(&b, `<tr><td style="padding:10px 0"><strong>Total a rendir</strong></td>`)
		fmt.Fprintf(&b, `<td align="right" style="padding:10px 0"><strong style="font-size:17px">%s</strong></td></tr>`, Money(data.DebtCents))
		fmt.Fprintf(&b, `</table>`)
	}

	fmt.Fprintf(&b, `<p style="margin:0;text-align:center;color:#888;font-size:12px">Si algo no coincide, avisale a %s.</p>`, esc(data.SenderName))
	fmt.Fprintf(&b, `</div></div></div>`)

	return Message{
		To:      data.Email,
		Subject: fmt.Sprintf("Rendicion pendiente: %s", Money(data.DebtCents)),
		HTML:    b.String(),
		Text:    textB.String(),
	}
}

// Money formatea centavos como "$112.000". Vive aca porque el email no puede
// pedirle el formato al frontend.
func Money(cents int64) string {
	pesos := cents / 100
	signo := ""
	if pesos < 0 {
		signo = "-"
		pesos = -pesos
	}
	s := strconv.FormatInt(pesos, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return signo + "$" + b.String()
}
