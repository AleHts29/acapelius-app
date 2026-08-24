package domain

import (
	"errors"
	"strings"
)

// PaymentStatus es el estado del pago del comprador a la vendedora.
type PaymentStatus string

const (
	PaymentPending PaymentStatus = "pending"
	PaymentPaid    PaymentStatus = "paid"
)

// PaymentMethod es como pago el comprador.
type PaymentMethod string

const (
	MethodCash     PaymentMethod = "cash"
	MethodTransfer PaymentMethod = "transfer"
)

// TicketStatus es el estado de una entrada.
type TicketStatus string

const (
	TicketIssued    TicketStatus = "issued"
	TicketCheckedIn TicketStatus = "checked_in"
	TicketVoid      TicketStatus = "void"
)

// Errores de ventas y tickets.
var (
	ErrBuyerNameRequired    = errors.New("el nombre del comprador es obligatorio")
	ErrQuantityInvalid      = errors.New("la cantidad tiene que ser mayor a cero")
	ErrCapacityExceeded     = errors.New("no queda cupo suficiente en esta funcion")
	ErrSaleNotFound         = errors.New("la venta no existe")
	ErrTicketNotFound       = errors.New("la entrada no existe")
	ErrSaleVoided           = errors.New("la venta esta anulada")
	ErrTicketCheckedIn      = errors.New("la entrada ya tiene ingreso registrado y no se puede anular")
	ErrPaymentMethodMissing = errors.New("falta el metodo de pago (efectivo o transferencia)")
	ErrPaymentMethodInvalid = errors.New("el metodo de pago no es valido")
	ErrPaymentStatusInvalid = errors.New("el estado de pago no es valido")
	ErrCompHasNoPayment     = errors.New("una cortesia no lleva pago")
	ErrBuyerEmailMissing    = errors.New("esta venta no tiene email cargado")
	ErrNotYourSale          = errors.New("esta venta no es tuya")
)

// ValidateNewSale valida el alta de una venta. El email es opcional; si viene,
// tiene que ser valido.
func ValidateNewSale(buyerName, buyerEmail string, quantity int32) error {
	if strings.TrimSpace(buyerName) == "" {
		return ErrBuyerNameRequired
	}
	if quantity <= 0 {
		return ErrQuantityInvalid
	}
	if strings.TrimSpace(buyerEmail) != "" {
		if err := ValidateEmail(buyerEmail); err != nil {
			return err
		}
	}
	return nil
}

// SaleAmount calcula el monto congelado de la venta: precio vigente por
// cantidad, o cero para una cortesia.
func SaleAmount(priceCents int64, quantity int32, isComp bool) int64 {
	if isComp {
		return 0
	}
	return priceCents * int64(quantity)
}

// FitsCapacity decide si una venta nueva entra en el cupo de la funcion.
func FitsCapacity(capacity int32, activeTickets int64, quantity int32) bool {
	return activeTickets+int64(quantity) <= int64(capacity)
}

// ValidatePaymentChange valida un cambio de estado de pago. Devuelve el metodo
// a persistir: el elegido cuando pasa a paid, nil cuando vuelve a pending.
func ValidatePaymentChange(isComp bool, status PaymentStatus, method PaymentMethod) (*string, error) {
	if isComp {
		return nil, ErrCompHasNoPayment
	}
	switch status {
	case PaymentPaid:
		switch method {
		case MethodCash, MethodTransfer:
			s := string(method)
			return &s, nil
		case "":
			return nil, ErrPaymentMethodMissing
		default:
			return nil, ErrPaymentMethodInvalid
		}
	case PaymentPending:
		// Volver a pendiente borra el metodo: no hubo pago.
		return nil, nil
	default:
		return nil, ErrPaymentStatusInvalid
	}
}
