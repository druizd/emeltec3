# Organiza archivos flat de raw_backup/<id_serial>/ en subcarpeta 2026-W20/
# Ejecutar en la VM Azure como azureuser, desde el directorio que contiene raw_backup/
# Uso: .\organize_w20.ps1 -RawBackupDir "C:\ruta\a\raw_backup"

param(
    [string]$RawBackupDir = ".\data\raw_backup"
)

$weekDir = "2026-W20"

Get-ChildItem $RawBackupDir -Directory | ForEach-Object {
    $serialDir = $_.FullName
    $targetDir = Join-Path $serialDir $weekDir

    $csvFiles = Get-ChildItem $serialDir -File -Filter "*.csv" -ErrorAction SilentlyContinue

    if ($csvFiles.Count -eq 0) {
        return
    }

    Write-Host "[$($_.Name)] $($csvFiles.Count) archivos -> $weekDir\"

    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

    foreach ($f in $csvFiles) {
        Move-Item $f.FullName (Join-Path $targetDir $f.Name) -Force
    }

    Write-Host "[$($_.Name)] movidos OK"
}

Write-Host "Listo. Verifica raw_backup y luego reinicia csvprocessor para que el archiver zip W20."
