# Runbook Fase 0 — Rotación de secretos y purga de historia de Git

> **Atención:** estos pasos los ejecuta el equipo Emeltec, no la herramienta de auditoría. Implican acceso a paneles externos y un `git push --force` que **reescribe la historia compartida** del repositorio. Coordina con TODO el equipo antes de empezar (todos deberán re-clonar).
>
> Relacionado: hallazgos **EMT-C04** y **EMT-C05** del informe.

## Resumen

Los siguientes secretos fueron empujados a `origin/main` y deben considerarse **comprometidos**:

| Secreto | Acción |
|---------|--------|
| `JWT_SECRET` (auth-api + main-api) | Rotar — invalida todas las sesiones |
| `DGA_ENCRYPTION_KEY` | Rotar + re-cifrar datos sellados con la clave antigua |
| `RESEND_API_KEY` | Revocar y regenerar en el panel de Resend |
| `INTERNAL_API_KEY` | Rotar (mismo valor en ambas APIs) |
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | Rotar |
| `Infra2026Secure!` / `Admin2026!` (infra-db) | Rotar (ya parametrizados en HEAD) |

Y estos archivos con datos deben salir de la historia:

- `historico_dga_OB-0601-292.csv` (datos regulatorios reales DGA)
- `.dga_res_2170.txt` (higiene)
- `.env`, `auth-api/.env`, `main-api/.env` (ya fuera de HEAD, pero presentes en historia)

---

## Paso 1 — Rotar PRIMERO (antes de purgar)

Rotar antes de purgar: aunque la purga elimine los blobs, los secretos ya fueron clonados/cacheados por terceros y pipelines. La rotación es lo que realmente corta el riesgo.

### 1.1 Generar nuevos valores

```bash
# JWT_SECRET (256 bits) — MISMO valor en auth-api y main-api
openssl rand -hex 32

# INTERNAL_API_KEY — MISMO valor en auth-api y main-api
openssl rand -hex 32

# DGA_ENCRYPTION_KEY (256 bits)
openssl rand -hex 32

# Passwords de BD / Redis
openssl rand -base64 24
```

### 1.2 Resend

1. Panel de Resend → API Keys → **revocar** la clave `re_…` filtrada.
2. Crear una nueva y guardarla en el gestor de secretos (no en el repo).

### 1.3 DGA_ENCRYPTION_KEY (cuidado: requiere re-cifrado)

Si hay credenciales/payloads DGA cifrados en BD con la clave antigua, necesitas:

1. Descifrar con la clave antigua.
2. Re-cifrar con la nueva.
3. Recién entonces retirar la clave antigua.

> Si no se hace el re-cifrado, los datos sellados quedarán ilegibles. Verifica qué columnas/datos usan esta clave antes de rotar.

### 1.4 Aplicar los nuevos valores

- Actualizar los `.env` reales en la VM (NO versionados).
- Actualizar el gestor de secretos / GitHub Actions secrets.
- Reiniciar los servicios. La rotación de `JWT_SECRET` cerrará todas las sesiones activas (comportamiento esperado: los usuarios vuelven a iniciar sesión).

---

## Paso 2 — Sacar de HEAD lo que aún se rastrea

```bash
cd /d/github/emeltec3
git rm --cached historico_dga_OB-0601-292.csv .dga_res_2170.txt
git commit -m "chore(security): dejar de versionar datos DGA y dump regulatorio"
```

Mover los datos a almacenamiento seguro fuera del repo si se necesitan como referencia.

---

## Paso 3 — Reforzar `.gitignore`

Añadir (ver EMT-L08):

```gitignore
# Datos y dumps
*.csv
historico_*
*.dump
*.sql.dump
*.bak
backup*
.dga_*.txt

# Material criptográfico
*.pem
*.key
*.crt
*.p12
*.pfx
*.keystore
```

> Si hay CSVs legítimos que SÍ deben versionarse (fixtures de test), exclúyelos con `!ruta/al/fixture.csv`.

---

## Paso 4 — Purgar la historia (git-filter-repo)

> **Punto de no retorno.** Hacer un backup del repo antes (`git clone --mirror`). Avisar a todo el equipo.

### 4.1 Instalar git-filter-repo

```bash
pip install git-filter-repo
# o: brew install git-filter-repo
```

### 4.2 Backup espejo

```bash
cd ..
git clone --mirror emeltec3 emeltec3-backup.git
cd emeltec3
```

### 4.3 Purgar archivos sensibles de TODA la historia

```bash
git filter-repo --invert-paths \
  --path .env \
  --path auth-api/.env \
  --path main-api/.env \
  --path historico_dga_OB-0601-292.csv \
  --path .dga_res_2170.txt
```

> `git filter-repo` elimina el remoto `origin` por seguridad. Hay que volver a añadirlo.

### 4.4 Re-vincular y forzar el push

```bash
git remote add origin <URL-del-repo>
git push origin --force --all
git push origin --force --tags
```

### 4.5 Limpiar otras ramas remotas

La auditoría detectó los secretos también en ramas como `Nicolas-super`, `dylan-super`, `feat/*`. Tras el filter-repo (que procesa `--all`), forzar el push de todas y **borrar ramas obsoletas** que ya no se usen.

---

## Paso 5 — Después de la purga

1. **Todo el equipo re-clona** desde cero. Los clones viejos contienen los secretos y, si alguien hace push, los reintroduce.
2. Invalidar/re-ejecutar los runners de CI que tengan el repo cacheado.
3. Si el repositorio estuvo **público** en algún momento, asumir que los secretos fueron indexados por terceros (motores de búsqueda de secretos escanean GitHub). La rotación del Paso 1 es lo único que mitiga esto.
4. Considerar GitHub **Secret Scanning** + **Push Protection** para prevenir reincidencia.

---

## Verificación final

```bash
# No debe devolver nada:
git log --all -S "super_secret_dev_key_12345" --oneline
git log --all --oneline -- historico_dga_OB-0601-292.csv
git ls-files | grep -E '(^|/)\.env$'
```

Si los tres comandos vuelven vacíos y los secretos fueron rotados, la Fase 0 está completa.
