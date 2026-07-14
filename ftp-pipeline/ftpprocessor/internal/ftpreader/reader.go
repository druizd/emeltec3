package ftpreader

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

type RawRow struct {
	Date    string
	Time    string
	Name    string
	Value   string
	Unit    string
	Quality string
}

func ReadRows(filePath string) ([]RawRow, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	rows := make([]RawRow, 0)
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\xef\xbb\xbf"))
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, ":") {
			continue
		}
		if len(line) == 0 || line[0] < '0' || line[0] > '9' {
			continue
		}

		var parts []string
		if strings.Contains(line, "\t") {
			parts = strings.Split(line, "\t")
		} else if strings.Contains(line, ";") {
			parts = strings.Split(line, ";")
		} else {
			parts = strings.Split(line, ",")
		}
		if len(parts) != 6 {
			return nil, fmt.Errorf("linea FTP invalida: %s", line)
		}

		rows = append(rows, RawRow{
			Date:    strings.TrimSpace(parts[0]),
			Time:    strings.TrimSpace(parts[1]),
			Name:    strings.TrimSpace(parts[2]),
			Value:   strings.TrimSpace(parts[3]),
			Unit:    strings.TrimSpace(parts[4]),
			Quality: strings.TrimSpace(parts[5]),
		})
	}

	return rows, scanner.Err()
}
