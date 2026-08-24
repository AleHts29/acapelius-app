// Package mail define el envio de emails con drivers intercambiables:
// "log" para desarrollo (escribe a stdout) y "resend" para produccion.
package mail

import "context"

// Attachment es un adjunto en memoria (los PNG de los QR).
type Attachment struct {
	Filename    string
	ContentType string
	Content     []byte
}

// Message es un email listo para mandar.
type Message struct {
	To          string
	Subject     string
	HTML        string
	Text        string
	Attachments []Attachment
}

// Driver es lo que un transporte tiene que saber hacer.
type Driver interface {
	// Send entrega el mensaje. Un error significa que NO salio.
	Send(ctx context.Context, msg Message) error
	// Name identifica al driver en logs y registros.
	Name() string
}
