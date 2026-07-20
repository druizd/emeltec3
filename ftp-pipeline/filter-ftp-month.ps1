param(
    [Parameter(Mandatory)][string]$InputFile,
    [string]$OutputFile = "",
    [int]$Year  = 2026,
    [int]$Month = 5,
    [switch]$RequireAllSensors
)

if ($OutputFile -eq "") {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($InputFile)
    $dir  = [System.IO.Path]::GetDirectoryName($InputFile)
    $OutputFile = Join-Path $dir ("{0}_filtered_{1:D4}{2:D2}.csv" -f $base, $Year, $Month)
}

function Get-RowMeta($line) {
    $t = $line.Trim()
    if ($t -eq "" -or $t[0] -lt '0' -or $t[0] -gt '9') { return $null }
    $sep = if ($t.Contains("`t")) { "`t" } elseif ($t.Contains(";")) { ";" } else { "," }
    $parts = $t -split [regex]::Escape($sep)
    if ($parts.Count -lt 6) { return $null }
    $dp = $parts[0].Trim() -split '[/\-]'
    if ($dp.Count -ne 3) { return $null }
    $y = if ($dp[0].Length -eq 4) { [int]$dp[0] } else { [int]$dp[2] }
    $m = [int]$dp[1]
    return @{
        Year    = $y
        Month   = $m
        Quality = $parts[5].Trim()
        Sensor  = $parts[2].Trim()
        Key     = "$($parts[0].Trim())|$($parts[1].Trim())"
        Line    = $line
    }
}

# Pass 1 — collect valid lines and detect sensor count per timestamp
$candidates = [System.Collections.Generic.List[hashtable]]::new()
$tsensors   = @{}  # key -> set of sensor names

foreach ($line in [System.IO.File]::ReadLines($InputFile, [System.Text.Encoding]::UTF8)) {
    $row = Get-RowMeta $line
    if ($null -eq $row) { continue }
    if ($row.Year -ne $Year -or $row.Month -ne $Month) { continue }
    if ($row.Quality -ne 'G') { continue }
    if ($row.Sensor -eq 'FREESPACE') { continue }
    $candidates.Add($row)
    if (-not $tsensors.ContainsKey($row.Key)) { $tsensors[$row.Key] = [System.Collections.Generic.HashSet[string]]::new() }
    [void]$tsensors[$row.Key].Add($row.Sensor)
}

# Determine expected sensor count (max seen across all timestamps)
$expectedCount = 0
foreach ($s in $tsensors.Values) { if ($s.Count -gt $expectedCount) { $expectedCount = $s.Count } }

Write-Host "Sensors detected: $expectedCount | Timestamps: $($tsensors.Count)"

# Pass 2 — write only rows that meet the filter
$writer  = [System.IO.StreamWriter]::new($OutputFile, $false, [System.Text.Encoding]::UTF8)
$kept    = 0
$skipped = 0

foreach ($row in $candidates) {
    $include = $true
    if ($RequireAllSensors -and $tsensors[$row.Key].Count -lt $expectedCount) {
        $include = $false
    }
    if ($include) { $writer.WriteLine($row.Line); $kept++ } else { $skipped++ }
}

$writer.Close()

Write-Host "Done. Kept: $kept | Skipped: $skipped"
Write-Host "Output: $OutputFile"
