package parser

import (
	"encoding/json"
	"testing"

	"ftpprocessor/internal/ftpreader"
)

func TestBuildTelemetryRecordsFTP(t *testing.T) {
	rows := []ftpreader.RawRow{
		{Date: "06-05-2026", Time: "11:26:00", Name: "Flujo Insta", Value: "0,0", Unit: "l/s", Quality: "G"},
		{Date: "06-05-2026", Time: "11:26:00", Name: "Totalizado", Value: "4915200", Unit: "M3", Quality: "G"},
		{Date: "06-05-2026", Time: "11:26:00", Name: "Nivel Freat", Value: "17,3", Unit: "m", Quality: "G"},
		{Date: "06-05-2026", Time: "11:26:00", Name: "FREESPACE", Value: "100,000", Unit: "mb", Quality: "G"},
		{Date: "06-05-2026", Time: "11:27:00", Name: "Nivel Freat", Value: "-999,0", Unit: "m", Quality: "B"},
	}

	records, err := BuildTelemetryRecords("REGADIO_log_20260506_20260602.csv", rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	if records[0].IDSerial != "REGADIO" {
		t.Fatalf("id_serial = %s", records[0].IDSerial)
	}
	if records[0].Fecha != "2026-05-06" || records[0].Hora != "11:26:00" {
		t.Fatalf("timestamp = %s %s", records[0].Fecha, records[0].Hora)
	}

	var data map[string]float64
	if err := json.Unmarshal([]byte(records[0].Data), &data); err != nil {
		t.Fatal(err)
	}
	if _, exists := data["FREESPACE"]; exists {
		t.Fatal("FREESPACE should be skipped")
	}
	if data["Nivel Freat"] != 17.3 {
		t.Fatalf("Nivel Freat = %v", data["Nivel Freat"])
	}
}
