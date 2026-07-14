param(
    [string]$SourceDir   = "C:\serverwin",
    [string]$OutputDir   = "C:\serverwin\split",
    [string]$DoneDir     = "C:\serverwin\done",
    [int]$PollSeconds    = 10,
    [int]$FilterYear     = 0,
    [int]$FilterMonth    = 0
)

$snNames = @{
    '25120112' = 'REGADIO'
    '25120225' = 'CASINO'
}

$nameToSn = @{}
foreach ($k in $snNames.Keys) { $nameToSn[$snNames[$k]] = $k }

function Get-DeviceFromFilename {
    param([string]$FileName)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName).ToUpper()
    foreach ($name in $nameToSn.Keys) {
        if ($base.StartsWith($name)) { return $name }
    }
    return $null
}

function Convert-Date {
    param([string]$D)
    $p = $D -split '[/\-]'
    if ($p.Count -ne 3) { return $D }
    if ($p[0].Length -eq 4) { return $p[1].PadLeft(2,'0') + '/' + $p[2].PadLeft(2,'0') + '/' + $p[0] }
    return $p[1].PadLeft(2,'0') + '/' + $p[0].PadLeft(2,'0') + '/' + $p[2]
}

function Convert-Time {
    param([string]$T)
    $p = $T -split ':'
    if ($p.Count -ne 3) { return $T }
    return $p[0].PadLeft(2,'0') + ':' + $p[1] + ':' + $p[2]
}

function Date-ToFilePart {
    param([string]$D)
    $p = $D -split '[/\-]'
    if ($p.Count -ne 3) { return $D -replace '[/\-]',''}
    if ($p[0].Length -eq 4) { return $p[0] + $p[1].PadLeft(2,'0') + $p[2].PadLeft(2,'0') }
    return $p[2] + $p[1].PadLeft(2,'0') + $p[0].PadLeft(2,'0')
}

function Extract-CompleteFtpCsv {
    param([string]$FilePath)

    $fileName   = [System.IO.Path]::GetFileName($FilePath)
    $deviceName = Get-DeviceFromFilename -FileName $fileName

    if (-not $deviceName) {
        Write-Warning ('No device resolved for ' + $fileName + ' — skipping')
        return 0
    }

    $sn = $nameToSn[$deviceName.ToUpper()]

    $requiredVars = @('Totalizado', 'Flujo Insta', 'Nivel Freat')

    # Read all data rows grouped by timestamp
    $groups     = [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]]::new()
    $groupVars  = [System.Collections.Generic.Dictionary[string, System.Collections.Generic.HashSet[string]]]::new()
    $groupOrder = [System.Collections.Generic.List[string]]::new()

    foreach ($rawLine in [System.IO.File]::ReadLines($FilePath)) {
        $line = $rawLine.Trim()
        if ($line -eq '') { continue }
        if ($line.StartsWith(':')) { continue }
        if ($line.Length -eq 0 -or $line[0] -lt '0' -or $line[0] -gt '9') { continue }

        $delim = if ($line.Contains(';')) { ';' } elseif ($line.Contains(',')) { ',' } else { "`t" }
        $parts = $line -split [regex]::Escape($delim)
        if ($parts.Count -lt 6) { continue }

        $date    = $parts[0].Trim()
        $time    = $parts[1].Trim()
        $varName = $parts[2].Trim()
        $status  = $parts[5].Trim()
        if ($FilterYear -gt 0 -or $FilterMonth -gt 0) {
            $dp = $date -split '[/\-]'
            $rowYear  = if ($dp[0].Length -eq 4) { [int]$dp[0] } else { [int]$dp[2] }
            $rowMonth = if ($dp[0].Length -eq 4) { [int]$dp[1] } else { [int]$dp[1] }
            if ($FilterYear  -gt 0 -and $rowYear  -ne $FilterYear)  { continue }
            if ($FilterMonth -gt 0 -and $rowMonth -ne $FilterMonth) { continue }
        }
        $rawVal  = $parts[3].Trim() -replace ',','.'
        if ($status -eq 'B') { continue }
        if ([double]::TryParse($rawVal, [ref]$null) -and [double]::Parse($rawVal) -lt 0) { continue }
        $key     = $date + '|' + $time

        if (-not $groups.ContainsKey($key)) {
            $groups[$key]    = [System.Collections.Generic.List[string]]::new()
            $groupVars[$key] = [System.Collections.Generic.HashSet[string]]::new()
            $groupOrder.Add($key)
        }

        $convDate  = Convert-Date $date
        $convTime  = Convert-Time $time
        $convValue = $parts[3].Trim() -replace ',','.'
        $outRow    = $convDate + ',' + $convTime + ',' + $varName + ',' + $convValue + ',' + $parts[4].Trim() + ',' + $parts[5].Trim()
        $groups[$key].Add($outRow)
        $groupVars[$key].Add($varName) | Out-Null
    }

    $created = 0
    foreach ($key in $groupOrder) {
        $rows = $groups[$key]

        # Only create file when exactly Totalizado + Flujo Insta + Nivel Freat are present
        $hasAll = $true
        foreach ($v in $requiredVars) {
            if (-not $groupVars[$key].Contains($v)) { $hasAll = $false; break }
        }
        if (-not $hasAll) { continue }

        $keyParts  = $key -split '\|'
        $datePart  = Date-ToFilePart $keyParts[0]
        $timePart  = (Convert-Time $keyParts[1]) -replace ':',''

        $outFileName = $deviceName + '_' + $datePart + $timePart + '.csv'
        $outPath     = Join-Path $OutputDir $outFileName

        $outLines = [System.Collections.Generic.List[string]]::new()
        foreach ($r in $rows) { $outLines.Add($r) }
        $outLines.Add(':YN ' + $deviceName + ' :YD ' + $timePart + ' :SN ' + $sn)

        [System.IO.File]::WriteAllLines($outPath, $outLines, [System.Text.UTF8Encoding]::new($false))
        $created++
    }

    return $created
}

foreach ($dir in @($DoneDir, $OutputDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

Write-Host ('ftp-extract | source: ' + $SourceDir + ' | output: ' + $OutputDir + ' | poll: ' + $PollSeconds + 's')

while ($true) {
    $files = Get-ChildItem -Path $SourceDir -Filter '*.csv' -File -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        Write-Host ('[' + (Get-Date).ToString('HH:mm:ss') + '] Processing: ' + $file.Name)
        try {
            $count = Extract-CompleteFtpCsv -FilePath $file.FullName
            Move-Item -Path $file.FullName -Destination (Join-Path $DoneDir $file.Name) -Force
            Write-Host ('  -> ' + $count + ' archivos creados')
        } catch {
            Write-Warning ('  Error: ' + $_)
        }
    }
    Start-Sleep -Seconds $PollSeconds
}
