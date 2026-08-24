package domain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/ale-hts/acapelius/internal/domain"
)

func TestValidateSeasonName(t *testing.T) {
	t.Parallel()

	if err := domain.ValidateSeasonName("Temporada 2026"); err != nil {
		t.Fatalf("nombre valido: %v", err)
	}
	for _, name := range []string{"", "   ", "\t\n"} {
		if err := domain.ValidateSeasonName(name); !errors.Is(err, domain.ErrSeasonNameRequired) {
			t.Fatalf("ValidateSeasonName(%q) = %v, se esperaba ErrSeasonNameRequired", name, err)
		}
	}
}

func TestValidateFunction(t *testing.T) {
	t.Parallel()

	starts := time.Date(2026, 12, 5, 20, 30, 0, 0, time.UTC)

	cases := []struct {
		name       string
		venue      string
		startsAt   time.Time
		capacity   int32
		priceCents int64
		want       error
	}{
		{"funcion valida", "Teatro Municipal", starts, 200, 500000, nil},
		{"precio cero permitido (a la gorra)", "Plaza", starts, 100, 0, nil},
		{"lugar vacio", "  ", starts, 200, 500000, domain.ErrVenueRequired},
		{"sin fecha", "Teatro", time.Time{}, 200, 500000, domain.ErrStartsAtRequired},
		{"cupo cero", "Teatro", starts, 0, 500000, domain.ErrCapacityInvalid},
		{"cupo negativo", "Teatro", starts, -5, 500000, domain.ErrCapacityInvalid},
		{"precio negativo", "Teatro", starts, 200, -1, domain.ErrPriceInvalid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := domain.ValidateFunction(tc.venue, tc.startsAt, tc.capacity, tc.priceCents)
			if !errors.Is(err, tc.want) {
				t.Fatalf("ValidateFunction = %v, se esperaba %v", err, tc.want)
			}
		})
	}
}

func TestNormalizeFunctionName(t *testing.T) {
	t.Parallel()

	if got := domain.NormalizeFunctionName("  Funcion de gala  "); got == nil || *got != "Funcion de gala" {
		t.Fatalf("se esperaba el nombre recortado, se obtuvo %v", got)
	}
	for _, name := range []string{"", "   "} {
		if got := domain.NormalizeFunctionName(name); got != nil {
			t.Fatalf("NormalizeFunctionName(%q) = %q, se esperaba nil", name, *got)
		}
	}
}
