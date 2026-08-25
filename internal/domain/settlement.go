package domain

import "errors"

// Errores de rendiciones.
var (
	ErrSettlementAmountInvalid = errors.New("el monto de la rendicion tiene que ser mayor a cero")
	ErrSettlementMethodInvalid = errors.New("el metodo de la rendicion tiene que ser efectivo o transferencia")
	ErrUserNotFound            = errors.New("el usuario no existe")
)

// ValidateSettlement valida el registro de una rendicion. Los montos son
// libres (parciales) y pueden superar el saldo: la plata real manda, el
// sistema solo la registra (spec §4).
func ValidateSettlement(amountCents int64, method PaymentMethod) error {
	if amountCents <= 0 {
		return ErrSettlementAmountInvalid
	}
	if method != MethodCash && method != MethodTransfer {
		return ErrSettlementMethodInvalid
	}
	return nil
}

// SettlementBalance calcula el saldo a rendir: cobrado menos rendido. Puede
// ser negativo si la vendedora rindio de mas.
func SettlementBalance(collectedCents, settledCents int64) int64 {
	return collectedCents - settledCents
}
