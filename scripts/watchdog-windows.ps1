# scripts/watchdog-windows.ps1 — Emeltec watchdog: detecta caída total de la VM Linux
# Corre en la VM Windows Azure (misma que ftpprocessor). Task Scheduler cada 1-2 min:
#   schtasks /Create /TN "Emeltec Watchdog" /TR "powershell -File C:\ruta\watchdog-windows.ps1" /SC MINUTE /MO 2 /RU SYSTEM

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile    = Join-Path $ScriptDir "watchdog-windows.env"
$StateDir   = "C:\ProgramData\emeltec-watchdog"
$StateFile  = Join-Path $StateDir "state.txt"
$LogFile    = Join-Path $StateDir "watchdog.log"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Host $line
}

function Read-EnvFile($path) {
    $vars = @{}
    if (-not (Test-Path $path)) { return $vars }
    foreach ($line in Get-Content $path) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $parts = $t -split "=", 2
        if ($parts.Count -eq 2) { $vars[$parts[0].Trim()] = $parts[1].Trim() }
    }
    return $vars
}

$cfg = Read-EnvFile $EnvFile

$RESEND_API_KEY = $cfg["RESEND_API_KEY"]
$RESEND_FROM    = if ($cfg["RESEND_FROM"]) { $cfg["RESEND_FROM"] } else { "Emeltec Cloud <noreply@emeltec.cl>" }
$TARGET_IP      = if ($cfg["TARGET_IP"])   { $cfg["TARGET_IP"] }   else { "145.190.8.19" }
$TO_EMAILS      = if ($cfg["TO_EMAILS"])   { $cfg["TO_EMAILS"] -split "," | ForEach-Object { $_.Trim() } } else { @("mcid@emeltec.cl") }

# ── State ────────────────────────────────────────────────────────────────────
function Get-State {
    if (Test-Path $StateFile) { return (Get-Content $StateFile -Raw).Trim() }
    return "ok"
}
function Set-State($s) { Set-Content -Path $StateFile -Value $s -Encoding utf8 -NoNewline }

# ── Email (Resend) ──────────────────────────────────────────────────────────
function Send-Alert($subject, $bg, $icon, $title, $bodyHtml, $textBody) {
    $ts = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    $html = @"
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0"
       style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;max-width:580px;">
  <tr>
    <td style="background:$bg;padding:20px 32px;">
      <span style="font-size:20px;font-weight:700;color:#fff;">$icon $title</span>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 32px;">
      $bodyHtml
    </td>
  </tr>
  <tr>
    <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:12px 32px;
               font-size:11px;color:#94A3B8;text-align:center;">
      Emeltec Cloud &mdash; Watchdog Windows &mdash; $ts
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
"@

    if ([string]::IsNullOrWhiteSpace($RESEND_API_KEY)) {
        Write-Log "WARN: RESEND_API_KEY vacío — simulando: $subject"
        return
    }

    foreach ($email in $TO_EMAILS) {
        $payload = @{
            from    = $RESEND_FROM
            to      = $email
            subject = $subject
            text    = $textBody
            html    = $html
        } | ConvertTo-Json -Depth 4

        try {
            $resp = Invoke-RestMethod -Method Post -Uri "https://api.resend.com/emails" `
                -Headers @{ Authorization = "Bearer $RESEND_API_KEY" } `
                -ContentType "application/json" -Body $payload
            Write-Log "Email OK -> $email [$subject]"
        } catch {
            Write-Log "Email ERROR -> $email [$subject] - $($_.Exception.Message)"
        }
    }
}

# ── Check ────────────────────────────────────────────────────────────────────
function Test-LinuxUp {
    $ping = Test-Connection -ComputerName $TARGET_IP -Count 1 -TimeoutSeconds 2 -Quiet -ErrorAction SilentlyContinue
    $p443  = (Test-NetConnection -ComputerName $TARGET_IP -Port 443  -WarningAction SilentlyContinue).TcpTestSucceeded
    $p50061 = (Test-NetConnection -ComputerName $TARGET_IP -Port 50061 -WarningAction SilentlyContinue).TcpTestSucceeded

    Write-Log "Check: ping=$ping tcp443=$p443 tcp50061=$p50061"
    return ($ping -or $p443 -or $p50061)
}

# ── Main ─────────────────────────────────────────────────────────────────────
try {
    $prev = Get-State
    $up = Test-LinuxUp

    if (-not $up) {
        if ($prev -eq "down") {
            Write-Log "SKIP (ya alertado: down)"
        } else {
            Set-State "down"
            $rows = "<table width='100%' cellpadding='0' cellspacing='0' style='border-top:1px solid #E2E8F0;padding-top:12px;'>
              <tr><td style='padding:7px 0;font-size:12px;color:#64748B;width:40%;'><strong>Servidor</strong></td><td style='padding:7px 0;font-size:13px;color:#1E293B;'>$TARGET_IP</td></tr>
              <tr><td style='padding:7px 0;font-size:12px;color:#64748B;'><strong>Ping / 443 / 50061</strong></td><td style='padding:7px 0;font-size:13px;color:#1E293B;'>Sin respuesta en ninguno</td></tr>
            </table>
            <p style='margin:16px 0 0;padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;font-size:12px;color:#DC2626;'>
              La VM Linux no responde. monitor.sh no puede correr (vive dentro de esa VM). Verificar Azure Portal y reiniciar la VM si es necesario.
            </p>"
            $textBody = "VM Linux ($TARGET_IP) sin respuesta a ping, puerto 443 ni puerto 50061. $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')"
            Send-Alert "🔴 [CAÍDO] VM Linux — sin respuesta" "#dc2626" "🔴" "VM Linux sin respuesta" $rows $textBody
        }
    } else {
        if ($prev -eq "down") {
            Set-State "ok"
            $rows = "<table width='100%' cellpadding='0' cellspacing='0' style='border-top:1px solid #E2E8F0;padding-top:12px;'>
              <tr><td style='padding:7px 0;font-size:12px;color:#64748B;width:40%;'><strong>Servidor</strong></td><td style='padding:7px 0;font-size:13px;color:#1E293B;'>$TARGET_IP</td></tr>
              <tr><td style='padding:7px 0;font-size:12px;color:#64748B;'><strong>Recuperado</strong></td><td style='padding:7px 0;font-size:13px;color:#1E293B;'>$(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')</td></tr>
            </table>"
            $textBody = "VM Linux ($TARGET_IP) recuperada, responde de nuevo. $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')"
            Send-Alert "✅ [RECUPERADO] VM Linux — responde de nuevo" "#16a34a" "✅" "VM Linux recuperada" $rows $textBody
        } else {
            Set-State "ok"
            Write-Log "OK: VM Linux responde"
        }
    }
} catch {
    Write-Log "ERROR FATAL en watchdog: $_"
    exit 1
}
