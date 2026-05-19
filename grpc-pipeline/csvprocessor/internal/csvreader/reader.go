package csvreader

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// RawRow representa una fila cruda del archivo log/CSV.
type RawRow struct {
	Tagname     string // Columna Tagname.
	TimeStamp   string // Columna TimeStamp.
	Value       string // Columna Value.
	DataQuality string // Columna DataQuality.
}

// ReadRows abre un archivo de texto y devuelve las filas útiles ya separadas.
// Ignora:
// - líneas vacías
// - la línea [Data]
// - el encabezado Tagname,TimeStamp,Value,DataQuality (con coma o punto y coma)
func ReadRows(filePath string) ([]RawRow, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	rows := make([]RawRow, 0)
	sep := ","

	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if line == "" || line == "[Data]" {
			continue
		}

		if strings.EqualFold(line, "Tagname,TimeStamp,Value,DataQuality") {
			sep = ","
			continue
		}
		if strings.EqualFold(line, "Tagname;TimeStamp;Value;DataQuality") {
			sep = ";"
			continue
		}

		parts := strings.SplitN(line, sep, 4)
		if len(parts) != 4 {
			return nil, fmt.Errorf("línea inválida: %s", line)
		}

		rows = append(rows, RawRow{
			Tagname:     strings.TrimSpace(parts[0]),
			TimeStamp:   strings.TrimSpace(parts[1]),
			Value:       strings.TrimSpace(parts[2]),
			DataQuality: strings.TrimSpace(parts[3]),
		})
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return rows, nil
}
