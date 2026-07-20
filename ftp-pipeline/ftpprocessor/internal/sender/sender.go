package sender

import (
	"context"
	"fmt"
	"strings"

	"ftpprocessor/internal/model"
	pb "ftpprocessor/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func SendRecords(ctx context.Context, grpcAddress, filename string, records []model.TelemetryRecord) (*model.SendRecordsResponse, error) {
	conn, err := grpc.NewClient(normalizeAddress(grpcAddress), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	client := pb.NewLogIngestionClient(conn)
	req := &pb.SendRecordsRequest{
		Filename: filename,
		Records:  make([]*pb.TelemetryRecord, 0, len(records)),
	}
	for _, record := range records {
		req.Records = append(req.Records, &pb.TelemetryRecord{
			IdSerial: record.IDSerial,
			Fecha:    record.Fecha,
			Hora:     record.Hora,
			Data:     record.Data,
		})
	}

	resp, err := client.SendRecords(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("gRPC SendRecords: %w", err)
	}

	return &model.SendRecordsResponse{
		OK:         resp.Ok,
		Inserted:   int(resp.Inserted),
		Duplicates: int(resp.Duplicates),
		Message:    resp.Message,
	}, nil
}

func normalizeAddress(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "http://")
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimRight(value, "/")
	return value
}
