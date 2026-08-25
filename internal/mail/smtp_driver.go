package mail

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"
)

// SMTPDriver manda emails por SMTP con STARTTLS. Pensado para Gmail
// (smtp.gmail.com:587 + app password), pero sirve para cualquier SMTP comun.
type SMTPDriver struct {
	host     string
	port     int
	username string
	password string
	from     string // "Nombre <direccion@dominio>"
}

// NewSMTPDriver crea el driver. Con Gmail, `from` tiene que usar la misma
// direccion de la cuenta (`username`): Gmail reescribe cualquier otra.
func NewSMTPDriver(host string, port int, username, password, from string) *SMTPDriver {
	return &SMTPDriver{host: host, port: port, username: username, password: password, from: from}
}

func (d *SMTPDriver) Name() string { return "smtp" }

// fromAddress extrae la direccion pelada de EMAIL_FROM para el sobre SMTP.
func fromAddress(from string) (string, error) {
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return "", fmt.Errorf("EMAIL_FROM invalido (%q): %w", from, err)
	}
	return addr.Address, nil
}

func (d *SMTPDriver) Send(ctx context.Context, msg Message) error {
	envelopeFrom, err := fromAddress(d.from)
	if err != nil {
		return err
	}
	raw, err := BuildMIME(d.from, msg)
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(d.host, fmt.Sprintf("%d", d.port))
	conn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("conectar a %s: %w", addr, err)
	}
	// Deadline global para toda la conversacion SMTP: un server colgado no
	// puede dejar colgado el request que disparo el envio.
	deadline := time.Now().Add(30 * time.Second)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	_ = conn.SetDeadline(deadline)

	client, err := smtp.NewClient(conn, d.host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("handshake SMTP: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); !ok {
		return fmt.Errorf("el servidor %s no ofrece STARTTLS; no se manda la password en claro", d.host)
	}
	if err := client.StartTLS(&tls.Config{ServerName: d.host}); err != nil {
		return fmt.Errorf("STARTTLS: %w", err)
	}
	if err := client.Auth(smtp.PlainAuth("", d.username, d.password, d.host)); err != nil {
		return fmt.Errorf("autenticacion SMTP (¿app password correcta?): %w", err)
	}

	if err := client.Mail(envelopeFrom); err != nil {
		return fmt.Errorf("MAIL FROM: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("escribir el mensaje: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("cerrar el mensaje: %w", err)
	}
	return client.Quit()
}

// BuildMIME serializa un Message como email MIME completo:
//
//	multipart/mixed
//	├── multipart/alternative
//	│   ├── text/plain  (quoted-printable)
//	│   └── text/html   (quoted-printable)
//	└── un adjunto base64 por QR
//
// Exportada para poder testear la serializacion sin un servidor SMTP.
func BuildMIME(from string, msg Message) ([]byte, error) {
	var buf strings.Builder

	mixed := multipart.NewWriter(&buf)

	// Cabeceras. El asunto lleva tildes y guiones largos: Q-encoding.
	fmt.Fprintf(&buf, "From: %s\r\n", from)
	fmt.Fprintf(&buf, "To: %s\r\n", msg.To)
	fmt.Fprintf(&buf, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject))
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: multipart/mixed; boundary=%q\r\n", mixed.Boundary())
	fmt.Fprintf(&buf, "\r\n")

	// Cuerpo: texto y HTML como alternativas. El boundary tiene que estar en
	// la cabecera del part antes de poder escribirlo, de ahi el writer
	// descartable que solo aporta un boundary aleatorio.
	altBoundary := multipart.NewWriter(io.Discard).Boundary()
	altPart, err := mixed.CreatePart(textproto.MIMEHeader{
		"Content-Type": {fmt.Sprintf("multipart/alternative; boundary=%q", altBoundary)},
	})
	if err != nil {
		return nil, err
	}
	altWriter := multipart.NewWriter(altPart)
	if err := altWriter.SetBoundary(altBoundary); err != nil {
		return nil, err
	}
	for _, part := range []struct{ contentType, body string }{
		{"text/plain; charset=utf-8", msg.Text},
		{"text/html; charset=utf-8", msg.HTML},
	} {
		if part.body == "" {
			continue
		}
		w, err := altWriter.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.contentType},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(w)
		if _, err := qp.Write([]byte(part.body)); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
	}
	if err := altWriter.Close(); err != nil {
		return nil, err
	}

	// Adjuntos (los PNG de los QR), base64 partido en lineas de 76.
	for _, a := range msg.Attachments {
		w, err := mixed.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {a.ContentType},
			"Content-Transfer-Encoding": {"base64"},
			"Content-Disposition":       {fmt.Sprintf("attachment; filename=%q", a.Filename)},
		})
		if err != nil {
			return nil, err
		}
		encoded := base64.StdEncoding.EncodeToString(a.Content)
		for len(encoded) > 0 {
			line := encoded
			if len(line) > 76 {
				line = line[:76]
			}
			if _, err := fmt.Fprintf(w, "%s\r\n", line); err != nil {
				return nil, err
			}
			encoded = encoded[len(line):]
		}
	}

	if err := mixed.Close(); err != nil {
		return nil, err
	}
	return []byte(buf.String()), nil
}
