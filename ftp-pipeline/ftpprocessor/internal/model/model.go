package model

type TelemetryRecord struct {
	IDSerial string `json:"id_serial"`
	Fecha    string `json:"fecha"`
	Hora     string `json:"hora"`
	Data     string `json:"data"`
}

type SendRecordsRequest struct {
	Filename string            `json:"filename"`
	Records  []TelemetryRecord `json:"records"`
}

type SendRecordsResponse struct {
	OK         bool   `json:"ok"`
	Inserted   int    `json:"inserted"`
	Duplicates int    `json:"duplicates"`
	Message    string `json:"message"`
}
