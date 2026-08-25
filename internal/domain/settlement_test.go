package domain_test

import (
	"errors"
	"testing"

	"github.com/ale-hts/acapelius/internal/domain"
)

func TestValidateSettlement(t *testing.T) {
	t.Parallel()

	if err := domain.ValidateSettlement(500000, domain.MethodCash); err != nil {
		t.Fatalf("rendicion valida: %v", err)
	}
	if err := domain.ValidateSettlement(100, domain.MethodTransfer); err != nil {
		t.Fatalf("transferencia valida: %v", err)
	}
	if err := domain.ValidateSettlement(0, domain.MethodCash); !errors.Is(err, domain.ErrSettlementAmountInvalid) {
		t.Fatalf("monto cero: %v", err)
	}
	if err := domain.ValidateSettlement(-100, domain.MethodCash); !errors.Is(err, domain.ErrSettlementAmountInvalid) {
		t.Fatalf("monto negativo: %v", err)
	}
	if err := domain.ValidateSettlement(100, "bitcoin"); !errors.Is(err, domain.ErrSettlementMethodInvalid) {
		t.Fatalf("metodo invalido: %v", err)
	}
}

func TestSettlementBalance(t *testing.T) {
	t.Parallel()

	// Carolina cobro $24.000 y rindio $10.000: debe $14.000.
	if got := domain.SettlementBalance(2400000, 1000000); got != 1400000 {
		t.Fatalf("saldo = %d, se esperaba 1400000", got)
	}
	// Rindio de mas: saldo negativo, no se recorta (la plata real manda).
	if got := domain.SettlementBalance(1000000, 1200000); got != -200000 {
		t.Fatalf("saldo sobre-rendido = %d, se esperaba -200000", got)
	}
	if got := domain.SettlementBalance(0, 0); got != 0 {
		t.Fatalf("sin movimientos = %d", got)
	}
}
