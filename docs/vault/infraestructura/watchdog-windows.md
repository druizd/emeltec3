---
aliases: [watchdog, watchdog windows, vm linux caida, talon de aquiles]
tags: [vault/infrastructure]
---
|
# Watchdog Windows — watchdog-windows.ps1

← [[HOME]] | Ver también: [[monitor-alertas]] · [[arquitectura-general]] · [[incidente-2026-07-10-vm-caida]]

---

## Por qué existe

`monitor.sh` corre **dentro** de la VM Linux. Si la VM entera se cae (ver
[[incidente-2026-07-10-vm-caida]]), monitor.sh no puede correr y nadie se
entera hasta que alguien nota el sitio caído. Ese era el talón de Aquiles.

`watchdog-windows.ps1` corre en la **VM Windows Azure** (la misma que ya
corre `ftpprocessor` 24/7) y vigila desde afuera si la VM Linux responde.

---

## Qué hace

Cada corrida prueba conectividad a `145.190.8.19`:

- Ping ICMP
- TCP `:443` (nginx/HTTPS público)
- TCP `:50061` (ftpconsumer gRPC — el mismo puerto que usa `ftpprocessor`)

Se considera **caída** solo si los tres fallan (evita falsos positivos por
un firewall bloqueando un puerto puntual).

Igual que `monitor.sh`: guarda estado (`ok` / `down`) en
`C:\ProgramData\emeltec-watchdog\state.txt` y **solo manda email cuando el
estado cambia** (anti-spam).

---

## Instalación en la VM Windows Azure

```powershell
# 1. Copiar scripts/watchdog-windows.ps1 y watchdog-windows.env.example a la VM

# 2. Crear watchdog-windows.env (mismo directorio) con credenciales reales
copy watchdog-windows.env.example watchdog-windows.env
notepad watchdog-windows.env

# 3. Registrar tarea programada (cada 2 min)
schtasks /Create /TN "Emeltec Watchdog" /TR "powershell -File C:\ruta\watchdog-windows.ps1" /SC MINUTE /MO 2 /RU SYSTEM
```

Deploy manual, solo en ventana de fin de semana — igual que el resto de
Windows.

---

## Variables requeridas (`watchdog-windows.env`)

```env
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=Emeltec Cloud <noreply@emeltec.cl>
TARGET_IP=145.190.8.19
TO_EMAILS=mcid@emeltec.cl
```

Si `RESEND_API_KEY` está vacío, simula el envío y loguea el asunto (igual
que `monitor.sh`).

---

## Logs

`C:\ProgramData\emeltec-watchdog\watchdog.log`

```
[2026-07-30 09:00:00] Check: ping=True tcp443=True tcp50061=True
[2026-07-30 09:00:00] OK: VM Linux responde
[2026-07-30 09:05:00] Check: ping=False tcp443=False tcp50061=False
[2026-07-30 09:05:00] Email OK -> mcid@emeltec.cl [🔴 [CAÍDO] VM Linux — sin respuesta]
```

---

## Archivo en el repo

`scripts/watchdog-windows.ps1` — credenciales en `watchdog-windows.env`
(no versionado, ver `.gitignore`).
