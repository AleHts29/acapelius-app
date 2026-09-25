package db_test

import (
	"reflect"
	"testing"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
)

// Guardian del aislamiento (C17 §A.2): toda consulta generada por sqlc tiene
// que recibir organization_id, salvo las que estan en esta lista con su
// motivo. Si alguien agrega una consulta y se olvida del filtro, este test
// falla antes de que un handler la use.
//
// Dos formas de llevarlo: como campo OrganizationID del struct de parametros,
// o como unico parametro escalar (las de temporadas que solo filtran por
// organizacion).
var sinOrganizacion = map[string]string{
	// Publicas: no hay sesion y el codigo secreto identifica la venta.
	"GetPublicSale":         "pagina publica /e/{code}",
	"GetPublicTicket":       "pagina publica /t/{code}",
	"GetPublicTicketByCode": "QR publico /t/{code}.png",
	// Antes de la sesion, o para armarla.
	"ListUsersWithMembershipByEmail": "login: el email es unico por organizacion, se prueban todas",
	"GetUserWithMembership":          "carga de la sesion: la organizacion sale de la fila",
	"TouchUserLogin":                 "sella el login del usuario recien autenticado",
	"CountUsers":                     "arranque: ¿hay alguien cargado?",
	// Organizaciones en si.
	"GetOrganization":    "la organizacion es el tenant",
	"CreateOrganization": "alta de cuenta",
	"SlugExists":         "alta de cuenta",
	// Hijas de una venta ya resuelta con GetSale/SalesByIDs (acotados): las
	// entradas y los cobros no tienen dueño propio.
	"CreateTicket":                "sale_id recien creado en la misma transaccion",
	"ListTicketsBySale":           "sale_id de GetSale o de la pagina publica",
	"VoidTicketsOfSale":           "sale_id de GetSale",
	"CountTicketsBySaleAndStatus": "sale_id de GetSale",
	"RecordEmailSend":             "sale_id de GetSale",
	"ListEmailSendsBySale":        "sale_id de GetSale",
	"CreateSalePayment":           "sale_id de GetSale/SalesByIDs",
	"ListSalePayments":            "sale_id de GetSale",
	"DeleteSalePayment":           "sale_id de GetSale",
	"DeleteSalePayments":          "sale_id de GetSale",
	"RecalcSalePayment":           "sale_id de GetSale/SalesByIDs",
}

// escalarEsLaOrganizacion: consultas cuyo unico parametro es organization_id.
var escalarEsLaOrganizacion = map[string]bool{
	"ListSeasons": true, "DeactivateAllSeasons": true, "GetActiveSeason": true, "SeasonsOverview": true,
}

func TestTodaConsultaLlevaOrganizacion(t *testing.T) {
	tipo := reflect.TypeOf(&sqlcgen.Queries{})
	ctxTipo := reflect.TypeOf((*interface{ Done() <-chan struct{} })(nil)).Elem()
	vistas := 0
	for i := 0; i < tipo.NumMethod(); i++ {
		m := tipo.Method(i)
		if m.Name == "WithTx" {
			continue
		}
		vistas++
		if motivo, ok := sinOrganizacion[m.Name]; ok {
			t.Logf("%s: sin organizacion a proposito (%s)", m.Name, motivo)
			continue
		}
		// m.Type incluye el receptor: [receiver, ctx, params...]
		if m.Type.NumIn() < 3 {
			t.Errorf("%s no recibe parametros: no puede estar acotada a la organizacion", m.Name)
			continue
		}
		if !m.Type.In(1).Implements(ctxTipo) {
			t.Errorf("%s: el primer parametro tendria que ser el contexto", m.Name)
		}
		arg := m.Type.In(2)
		switch arg.Kind() {
		case reflect.Struct:
			if _, ok := arg.FieldByName("OrganizationID"); !ok {
				t.Errorf("%s: %s no tiene OrganizationID", m.Name, arg.Name())
			}
		case reflect.Int64:
			if !escalarEsLaOrganizacion[m.Name] {
				t.Errorf("%s recibe un int64 suelto que no es la organizacion", m.Name)
			}
		default:
			t.Errorf("%s recibe %s: no se sabe si esta acotada", m.Name, arg)
		}
	}
	if vistas < 90 {
		t.Fatalf("se esperaban ~100 consultas, se vieron %d: ¿cambio el paquete?", vistas)
	}
	for nombre := range sinOrganizacion {
		if _, ok := tipo.MethodByName(nombre); !ok {
			t.Errorf("la excepcion %q ya no existe: sacarla de la lista", nombre)
		}
	}
}
