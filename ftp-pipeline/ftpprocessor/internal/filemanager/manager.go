package filemanager

import (
	"archive/zip"
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
			return fmt.Errorf("crear directorio [%s]: %w", dir, err)
		}
	}
	return nil
}

func ListInputFiles(inputDir string) ([]string, error) {
	return listInputFiles(inputDir, 0)
}

func ListReadyInputFiles(inputDir string, minAge time.Duration) ([]string, error) {
	return listInputFiles(inputDir, minAge)
}

func listInputFiles(inputDir string, minAge time.Duration) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(inputDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext != ".csv" && ext != ".txt" && ext != ".log" && ext != ".ftp" {
			return nil
		}
		if minAge > 0 && !IsReady(path, minAge) {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("leer directorio [%s]: %w", inputDir, err)
	}
	sort.Strings(files)
	return files, nil
}

func IsReady(filePath string, minAge time.Duration) bool {
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return false
	}
	if time.Since(info.ModTime()) < minAge {
		return false
	}
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	return file.Close() == nil
}

func CopyToBackupBySerial(sourcePath, backupRootDir, idSerial string, referenceDate time.Time) error {
	year, week := referenceDate.ISOWeek()
	targetDir := filepath.Join(backupRootDir, idSerial, fmt.Sprintf("%d-W%02d", year, week))
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	targetFile, err := os.Create(filepath.Join(targetDir, filepath.Base(sourcePath)))
	if err != nil {
		return err
	}
	defer targetFile.Close()

	_, err = io.Copy(targetFile, sourceFile)
	return err
}

func MoveToFailedFromRoot(sourcePath, inputDir, failedDir string) error {
	relativePath, err := filepath.Rel(inputDir, sourcePath)
	if err != nil || strings.HasPrefix(relativePath, "..") || filepath.IsAbs(relativePath) {
		relativePath = filepath.Base(sourcePath)
	}
	return moveFile(sourcePath, filepath.Join(failedDir, relativePath))
}

func IsInsideDir(rootDir, filePath string) bool {
	relativePath, err := filepath.Rel(rootDir, filePath)
	return err == nil && relativePath != "." && !strings.HasPrefix(relativePath, "..") && !filepath.IsAbs(relativePath)
}

func DeleteFile(filePath string) {
	_ = os.Remove(filePath)
}

func moveFile(sourcePath, targetPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return err
	}
	if _, err := os.Stat(targetPath); err == nil {
		if err := os.Remove(targetPath); err != nil {
			return err
		}
	}
	if err := os.Rename(sourcePath, targetPath); err == nil {
		return nil
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	targetFile, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return err
	}
	return os.Remove(sourcePath)
}

func ListZipFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.ToLower(filepath.Ext(e.Name())) == ".zip" {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	return files, nil
}

func ExtractZip(zipPath, destDir string) (int, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return 0, err
	}
	defer r.Close()

	allowed := map[string]bool{".csv": true, ".txt": true, ".log": true, ".ftp": true}
	count := 0
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f.Name))
		if !allowed[ext] {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return count, err
		}
		destPath := filepath.Join(destDir, filepath.Base(f.Name))
		out, err := os.Create(destPath)
		if err != nil {
			rc.Close()
			return count, err
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return count, copyErr
		}
		count++
	}
	return count, nil
}
