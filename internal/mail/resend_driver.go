package mail

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// resendEndpoint es la API de envio de Resend.
const resendEndpoint = "https://api.resend.com/emails"

// ResendDriver manda emails via la API HTTP de Resend.
type ResendDriver struct {
	apiKey string
	from   string
	client *http.Client
}

// NewResendDriver crea el driver de produccion. `from` es EMAIL_FROM, con la
// forma "Nombre <direccion@dominio>".
func NewResendDriver(apiKey, from string) *ResendDriver {
	return &ResendDriver{
		apiKey: apiKey,
		from:   from,
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (d *ResendDriver) Name() string { return "resend" }

type resendAttachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"` // base64
}

type resendRequest struct {
	From        string             `json:"from"`
	To          []string           `json:"to"`
	Subject     string             `json:"subject"`
	HTML        string             `json:"html,omitempty"`
	Text        string             `json:"text,omitempty"`
	Attachments []resendAttachment `json:"attachments,omitempty"`
}

func (d *ResendDriver) Send(ctx context.Context, msg Message) error {
	payload := resendRequest{
		From:    d.from,
		To:      []string{msg.To},
		Subject: msg.Subject,
		HTML:    msg.HTML,
		Text:    msg.Text,
	}
	for _, a := range msg.Attachments {
		payload.Attachments = append(payload.Attachments, resendAttachment{
			Filename: a.Filename,
			Content:  base64.StdEncoding.EncodeToString(a.Content),
		})
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("serializar email: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("armar request a Resend: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+d.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("llamar a Resend: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("resend respondio %d: %s", resp.StatusCode, detail)
	}
	return nil
}
