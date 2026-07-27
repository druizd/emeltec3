# Azure infrastructure — versioned definitions

Archivos JSON con la configuración de Azure que debe vivir en git, no solo en el Portal.

## Archivos

| Archivo | Recurso | Cuándo aplicar |
|---|---|---|
| `lifecycle-policy.json` | Storage Account → Blob lifecycle management | Cuando cambia la política de retención o de tiering de los backups |

## Aplicar / actualizar

Requiere `az` CLI logueado en la subscription correcta y el nombre exacto del Storage Account (variable `STORAGE_ACCOUNT`).

### Lifecycle policy

```bash
# Ver la policy actual en Azure
az storage account management-policy show \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --output json > /tmp/current-policy.json

# Diff contra la versión de git
diff <(jq -S . /tmp/current-policy.json) <(jq -S '{policy: {rules: .rules}}' deployment/azure/lifecycle-policy.json)

# Aplicar la versión versionada
az storage account management-policy create \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --policy @deployment/azure/lifecycle-policy.json
```

## Convención

- Siempre editar el JSON versionado primero.
- Correr `az ... management-policy create` para publicar.
- Nunca editar la policy desde Portal sin actualizar el archivo — deriva silenciosa.
- Diff antes de aplicar. Si Azure tiene cambios que no están en git, investigar antes de sobreescribir.
