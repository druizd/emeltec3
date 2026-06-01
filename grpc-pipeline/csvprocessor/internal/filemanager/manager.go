package filemanager

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func EnsureDirectories(dirs ...string) error {
	for _, dir := range dirs {
		if strings.TrimSpace(dir) == "" {
			return fmt.Errorf("directorio vacio en configuracion")
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("no se pudo crear el directorio [%s]: %w", dir, err)
		}
	}
	return nil
}

func ListInputFiles(inputDir string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(inputDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext == ".csv" || ext == ".log" || ext == ".txt" {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer el directorio [%s]: %w", inputDir, err)
	}

	sort.Strings(files)
	return files, nil
}

func ExtractSerialIDFromFile(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("no se pudo abrir el archivo [%s]: %w", filePath, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if line == "" || line == "[Data]" {
			continue
		}
		if strings.EqualFold(line, "Tagname,TimeStamp,Value,DataQuality") ||
			strings.EqualFold(line, "Tagname;TimeStamp;Value;DataQuality") {
			continue
		}

		parts := strings.SplitN(line, ",", 2)
		if len(parts) < 1 {
			continue
		}

		tagname := strings.TrimSpace(parts[0])
		if tagname == "" {
			continue
		}

		idSerial, err := parseSerialIDFromTagname(tagname)
		if err == nil && idSerial != "" {
			return idSerial, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("error leyendo el archivo [%s]: %w", filePath, err)
	}

	return "", fmt.Errorf("no se pudo extraer id_serial desde [%s]", filePath)
}

func CopyToBackupBySerial(sourcePath, backupRootDir, idSerial string) error {
	if strings.TrimSpace(idSerial) == "" {
		return fmt.Errorf("id_serial vacio para backup")
	}

	year, week := time.Now().ISOWeek()
	targetDir := filepath.Join(backupRootDir, idSerial, fmt.Sprintf("%d-W%02d", year, week))

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("no se pudo crear el directorio backup [%s]: %w", targetDir, err)
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("no se pudo abrir el archivo origen [%s]: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	targetPath := filepath.Join(targetDir, filepath.Base(sourcePath))

	targetFile, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("no se pudo crear el archivo backup [%s]: %w", targetPath, err)
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return fmt.Errorf("no se pudo copiar el archivo a backup [%s]: %w", targetPath, err)
	}

	return nil
}

func MoveToProcessed(sourcePath, processedDir string) error {
	targetPath := filepath.Join(processedDir, filepath.Base(sourcePath))
	return moveFile(sourcePath, targetPath)
}

func MoveToFailed(sourcePath, failedDir string) error {
	targetPath := filepath.Join(failedDir, filepath.Base(sourcePath))
	return moveFile(sourcePath, targetPath)
}

func MoveToFailedFromRoot(sourcePath, inputDir, failedDir string) error {
	relativePath, err := filepath.Rel(inputDir, sourcePath)
	if err != nil || strings.HasPrefix(relativePath, "..") || filepath.IsAbs(relativePath) {
		return MoveToFailed(sourcePath, failedDir)
	}

	targetPath := filepath.Join(failedDir, relativePath)
	return moveFile(sourcePath, targetPath)
}

func IsInsideDir(rootDir, filePath string) bool {
	relativePath, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		return false
	}
	return relativePath != "." &&
		!strings.HasPrefix(relativePath, "..") &&
		!filepath.IsAbs(relativePath)
}

func moveFile(sourcePath, targetPath string) error {
	if _, err := os.Stat(targetPath); err == nil {
		if err := os.Remove(targetPath); err != nil {
			return fmt.Errorf("no se pudo reemplazar el archivo destino [%s]: %w", targetPath, err)
		}
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("no se pudo crear directorio destino [%s]: %w", filepath.Dir(targetPath), err)
	}

	if err := os.Rename(sourcePath, targetPath); err == nil {
		return nil
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("no se pudo abrir el archivo origen [%s]: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	targetFile, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("no se pudo crear el archivo destino [%s]: %w", targetPath, err)
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return fmt.Errorf("no se pudo copiar el archivo hacia [%s]: %w", targetPath, err)
	}

	if err := os.Remove(sourcePath); err != nil {
		return fmt.Errorf("no se pudo eliminar el archivo origen [%s]: %w", sourcePath, err)
	}

	return nil
}

func DeleteFile(filePath string) {
	_ = os.Remove(filePath)
}

func parseSerialIDFromTagname(tag string) (string, error) {
	lastDot := strings.LastIndex(tag, ".")
	if lastDot == -1 {
		return "", fmt.Errorf("tagname invalido: %s", tag)
	}

	left := tag[:lastDot]
	idSerial := strings.Split(left, "--")[0]
	idSerial = strings.TrimSpace(idSerial)

	if idSerial == "" {
		return "", fmt.Errorf("id_serial vacio en tagname: %s", tag)
	}

	return idSerial, nil
}
