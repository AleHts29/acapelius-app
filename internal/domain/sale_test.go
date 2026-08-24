package domain_test

import (
	"errors"
	"testing"

	"github.com/ale-hts/acapelius/internal/domain"
)

func TestValidateNewSale(t *testing.T) {
	t.Parallel()

	if err := domain.ValidateNewSale("Maria Dutra", "", 3); err != nil {
		t.Fatalf("venta sin email tendria que ser valida: %v", err)
	}
	if err := domain.ValidateNewSale("Maria Dutra", "maria@gmail.com", 1); err != nil {
		t.Fatalf("venta con email valido: %v", err)
	}
	if err := domain.ValidateNewSale("  ", "", 1); !errors.Is(err, domain.ErrBuyerNameRequired) {
		t.Fatalf("sin nombre: %v", err)
	}
	if err := domain.ValidateNewSale("Maria", "", 0); !errors.Is(err, domain.ErrQuantityInvalid) {
		t.Fatalf("cantidad cero: %v", err)
	}
	if err := domain.ValidateNewSale("Maria", "no-es-email", 1); !errors.Is(err, domain.ErrEmailInvalid) {
		t.Fatalf("email invalido: %v", err)
	}
}

func TestSaleAmount(t *testing.T) {
	t.Parallel()

	if got := domain.SaleAmount(800000, 3, false); got != 2400000 {
		t.Fatalf("3 entradas de $8000 = %d", got)
	}
	if got := domain.SaleAmount(800000, 2, true); got != 0 {
		t.Fatalf("una cortesia siempre vale 0, dio %d", got)
	}
}

func TestFitsCapacity(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		capacity int32
		active   int64
		quantity int32
		want     bool
	}{
		{"entra justo", 250, 247, 3, true},
		{"se pasa por una", 250, 248, 3, false},
		{"funcion vacia", 250, 0, 250, true},
		{"funcion llena", 250, 250, 1, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := domain.FitsCapacity(tc.capacity, tc.active, tc.quantity); got != tc.want {
				t.Fatalf("FitsCapacity(%d, %d, %d) = %v", tc.capacity, tc.active, tc.quantity, got)
			}
		})
	}
}

func TestValidatePaymentChange(t *testing.T) {
	t.Parallel()

	method, err := domain.ValidatePaymentChange(false, domain.PaymentPaid, domain.MethodCash)
	if err != nil || method == nil || *method != "cash" {
		t.Fatalf("paid+cash: method=%v err=%v", method, err)
	}

	method, err = domain.ValidatePaymentChange(false, domain.PaymentPending, "")
	if err != nil || method != nil {
		t.Fatalf("volver a pending borra el metodo: method=%v err=%v", method, err)
	}

	if _, err := domain.ValidatePaymentChange(false, domain.PaymentPaid, ""); !errors.Is(err, domain.ErrPaymentMethodMissing) {
		t.Fatalf("paid sin metodo: %v", err)
	}
	if _, err := domain.ValidatePaymentChange(false, domain.PaymentPaid, "bitcoin"); !errors.Is(err, domain.ErrPaymentMethodInvalid) {
		t.Fatalf("metodo invalido: %v", err)
	}
	if _, err := domain.ValidatePaymentChange(false, "quizas", ""); !errors.Is(err, domain.ErrPaymentStatusInvalid) {
		t.Fatalf("estado invalido: %v", err)
	}
	if _, err := domain.ValidatePaymentChange(true, domain.PaymentPaid, domain.MethodCash); !errors.Is(err, domain.ErrCompHasNoPayment) {
		t.Fatalf("cortesia con pago: %v", err)
	}
}
