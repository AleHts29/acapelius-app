// Command hashpw imprime el hash bcrypt de una contrasena. Herramienta de
// operacion: sirve para resetear la contrasena de un usuario por SQL cuando
// no hay otra via (ver docs/operations.md).
//
//	go run ./cmd/hashpw 'la-contrasena'
package main

import (
	"fmt"
	"os"

	"github.com/ale-hts/acapelius/internal/auth"
)

func main() {
	if len(os.Args) != 2 || os.Args[1] == "" {
		fmt.Fprintln(os.Stderr, "uso: hashpw <contrasena>")
		os.Exit(2)
	}
	hash, err := auth.HashPassword(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Println(hash)
}
