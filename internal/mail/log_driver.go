package mail

import (
	"context"
	"fmt"
	"io"
)

// LogDriver escribe el email a un io.Writer (stdout en desarrollo) en vez de
// mandarlo. Cumple el criterio de aceptacion de "ver el email en el log".
type LogDriver struct {
	out io.Writer
}

// NewLogDriver crea el driver de desarrollo.
func NewLogDriver(out io.Writer) *LogDriver {
	return &LogDriver{out: out}
}

func (d *LogDriver) Name() string { return "log" }

func (d *LogDriver) Send(_ context.Context, msg Message) error {
	fmt.Fprintf(d.out, "\n========== EMAIL (driver log) ==========\n")
	fmt.Fprintf(d.out, "Para:    %s\n", msg.To)
	fmt.Fprintf(d.out, "Asunto:  %s\n", msg.Subject)
	for _, a := range msg.Attachments {
		fmt.Fprintf(d.out, "Adjunto: %s (%s, %d bytes)\n", a.Filename, a.ContentType, len(a.Content))
	}
	fmt.Fprintf(d.out, "----------------------------------------\n%s\n", msg.Text)
	fmt.Fprintf(d.out, "========================================\n\n")
	return nil
}
