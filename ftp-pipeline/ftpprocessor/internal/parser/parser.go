package parser

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ftpprocessor/internal/ftpreader"
	"ftpprocessor/internal/model"
)

type groupedRecord struct {
	IDSerial string
	Fecha    string
	Hora     string
	Data     map[string]float64
}

func BuildTelemetryRecords(filename string, rows []ftpreader.RawRow) ([]model.TelemetryRecord, error) {
	idSerial, err := SerialFromFilename(filename)
	if err != nil {
		return nil, err
	}

	grouped := make(map[string]*groupedRecord)
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if shouldSkipName(name) || isSentinel(row.Value) {
			continue
		}

		fecha, hora, err := parseDateTime(row.Date, row.Time)
		if err != nil {
			return nil, err
		}

		value, err := parseDecimal(row.Value)
		if err != nil {
			return nil, fmt.Errorf("valor invalido [%s]: %w", row.Value, err)
		}

		key := idSerial + "|" + fecha + "|" + hora
		if _, exists := grouped[key]; !exists {
			grouped[key] = &groupedRecord{
				IDSerial: idSerial,
				Fecha:    fecha,
				Hora:     hora,
				Data:     make(map[string]float64),
			}
		}
		grouped[key].Data[name] = value
	}

	records := make([]model.TelemetryRecord, 0, len(grouped))
	for _, item := range grouped {
		dataJSON, err := json.Marshal(item.Data)
		if err != nil {
			return nil, err
		}
		records = append(records, model.TelemetryRecord{
			IDSerial: item.IDSerial,
			Fecha:    item.Fecha,
			Hora:     item.Hora,
			Data:     string(dataJSON),
		})
	}

	return records, nil
}

func ResolveSerial(serial string, aliases map[string]string) string {
	if id, ok := aliases[strings.ToUpper(serial)]; ok {
		return id
	}
	return serial
}

func EarliestDate(records []model.TelemetryRecord) time.Time {
	var earliest time.Time
	for _, r := range records {
		t, err := time.Parse("2006-01-02", r.Fecha)
		if err != nil {
			continue
		}
		if earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
	}
	if earliest.IsZero() {
		return time.Now()
	}
	return earliest
}

func SerialFromFilename(filename string) (string, error) {
	base := filepath.Base(filename)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	lower := strings.ToLower(name)

	if idx := strings.Index(lower, "_log_"); idx > 0 {
		name = name[:idx]
	} else {
		parts := strings.Split(name, "_")
		last := parts[len(parts)-1]
		if len(last) == 14 {
			if _, err := time.Parse("20060102150405", last); err == nil {
				name = strings.Join(parts[:len(parts)-1], "_")
			}
		}
	}

	serial := strings.TrimSpace(name)
	if serial == "" {
		return "", fmt.Errorf("id_serial vacio en archivo: %s", base)
	}
	return serial, nil
}

func shouldSkipName(name string) bool {
	return name == "" || strings.EqualFold(name, "FREESPACE")
}

func isSentinel(value string) bool {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, ",", "."))
	return normalized == "-999" || normalized == "-999.0" || normalized == "-999.000"
}

func parseDecimal(value string) (float64, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, ",", "."))
	return strconv.ParseFloat(normalized, 64)
}

func parseDateTime(dateValue, timeValue string) (string, string, error) {
	dateValue = strings.TrimSpace(dateValue)
	timeValue = strings.TrimSpace(timeValue)

	var parsedDate time.Time
	var err error
	for _, layout := range []string{"02-01-2006", "2006-01-02", "01/02/2006", "2006/01/02"} {
		parsedDate, err = time.Parse(layout, dateValue)
		if err == nil {
			break
		}
	}
	if err != nil {
		return "", "", fmt.Errorf("fecha invalida [%s]: %w", dateValue, err)
	}

	parsedTime, err := time.Parse("15:04:05", timeValue)
	if err != nil {
		return "", "", fmt.Errorf("hora invalida [%s]: %w", timeValue, err)
	}

	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		loc = time.FixedZone("America/Santiago", -4*60*60)
	}

	localDateTime := time.Date(
		parsedDate.Year(),
		parsedDate.Month(),
		parsedDate.Day(),
		parsedTime.Hour(),
		parsedTime.Minute(),
		parsedTime.Second(),
		0,
		loc,
	)

	utcDateTime := localDateTime.UTC()

	return utcDateTime.Format("2006-01-02"), utcDateTime.Format("15:04:05"), nil
}
