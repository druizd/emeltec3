package filemanager

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

var weekDirRe = regexp.MustCompile(`^(\d{4})-W(\d{2})$`)
var weekZipRe = regexp.MustCompile(`^(\d{4})-W(\d{2})\.zip$`)

type weekEntry struct {
	path string
	name string
}

// RunArchiver recorre cada id_serial en backupRootDir y:
// 1. Comprime carpetas de semanas pasadas en YYYY-WNN.zip
// 2. Agrupa ZIPs semanales de meses cerrados en YYYY-MM.zip
func RunArchiver(backupRootDir string) error {
	entries, err := os.ReadDir(backupRootDir)
	if err != nil {
		return fmt.Errorf("archiver: no se pudo leer [%s]: %w", backupRootDir, err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if err := archiveSerialDir(filepath.Join(backupRootDir, entry.Name())); err != nil {
			_ = err
		}
	}
	return nil
}

func archiveSerialDir(dir string) error {
	now := time.Now()
	currentYear, currentWeek := now.ISOWeek()
	currentMonth := int(now.Month())
	currentMonthYear := now.Year()

	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	// Paso 1: comprimir carpetas de semanas pasadas en YYYY-WNN.zip
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		m := weekDirRe.FindStringSubmatch(entry.Name())
		if m == nil {
			continue
		}
		year, _ := strconv.Atoi(m[1])
		week, _ := strconv.Atoi(m[2])

		if year == currentYear && week == currentWeek {
			continue
		}

		weekDir := filepath.Join(dir, entry.Name())
		zipPath := weekDir + ".zip"

		if _, err := os.Stat(zipPath); err == nil {
			os.RemoveAll(weekDir)
			continue
		}

		if err := zipDir(weekDir, zipPath); err == nil {
			os.RemoveAll(weekDir)
		}
	}

	// Paso 2: agrupar ZIPs semanales de meses cerrados en YYYY-MM.zip
	entries, err = os.ReadDir(dir)
	if err != nil {
		return err
	}

	monthMap := make(map[string][]weekEntry)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		m := weekZipRe.FindStringSubmatch(entry.Name())
		if m == nil {
			continue
		}
		year, _ := strconv.Atoi(m[1])
		week, _ := strconv.Atoi(m[2])

		month := isoWeekMonth(year, week)

		if year == currentMonthYear && int(month) == currentMonth {
			continue
		}

		key := fmt.Sprintf("%d-%02d", year, int(month))
		monthMap[key] = append(monthMap[key], weekEntry{
			path: filepath.Join(dir, entry.Name()),
			name: entry.Name(),
		})
	}

	for monthKey, weeks := range monthMap {
		monthZip := filepath.Join(dir, monthKey+".zip")
		if _, err := os.Stat(monthZip); err == nil {
			for _, w := range weeks {
				os.Remove(w.path)
			}
			continue
		}
		if err := zipEntries(weeks, monthZip); err != nil {
			continue
		}
		for _, w := range weeks {
			os.Remove(w.path)
		}
	}

	return nil
}

// isoWeekMonth devuelve el mes al que pertenece una semana ISO.
// Usa el jueves de esa semana (regla ISO 8601).
func isoWeekMonth(year, week int) time.Month {
	jan4 := time.Date(year, 1, 4, 0, 0, 0, 0, time.UTC)
	wd := int(jan4.Weekday())
	if wd == 0 {
		wd = 7
	}
	mondayW1 := jan4.AddDate(0, 0, -(wd - 1))
	thursday := mondayW1.AddDate(0, 0, (week-1)*7+3)
	return thursday.Month()
}

// zipDir comprime todos los archivos de srcDir en destZip.
func zipDir(srcDir, destZip string) error {
	zf, err := os.Create(destZip)
	if err != nil {
		return err
	}
	defer zf.Close()

	w := zip.NewWriter(zf)
	defer w.Close()

	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		fw, err := w.Create(rel)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(fw, f)
		return err
	})
}

// zipEntries empaqueta archivos existentes (ZIPs semanales) dentro de un ZIP mensual.
func zipEntries(entries []weekEntry, destZip string) error {
	zf, err := os.Create(destZip)
	if err != nil {
		return err
	}
	defer zf.Close()

	w := zip.NewWriter(zf)
	defer w.Close()

	for _, e := range entries {
		fw, err := w.Create(e.name)
		if err != nil {
			return err
		}
		f, err := os.Open(e.path)
		if err != nil {
			return err
		}
		_, err = io.Copy(fw, f)
		f.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
