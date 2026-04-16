#!/usr/bin/env bash
# =============================================================================
# RetailERP — Azure Deployment Script
#
# Prerequisites:
#   - Azure CLI installed (az --version)
#   - Docker installed (for API image build)
#   - Logged in to Azure (script will prompt if not)
#
# Usage:
#   chmod +x infra/azure/deploy.sh
#   ./infra/azure/deploy.sh
#
# Environment variables (optional overrides):
#   RESOURCE_GROUP   — default: rg-retailerp-prod
#   LOCATION         — default: centralindia (cheapest for India-based users)
#   ENVIRONMENT      — default: prod
#   DB_ADMIN_LOGIN   — default: retailerp
#   DB_ADMIN_PASS    — prompted if not set
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-retailerp-prod}"
LOCATION="${LOCATION:-centralindia}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
NAME_PREFIX="${NAME_PREFIX:-retailerp}"
DB_ADMIN_LOGIN="${DB_ADMIN_LOGIN:-retailerp}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BICEP_FILE="$SCRIPT_DIR/main.bicep"

API_APP_NAME="api-${NAME_PREFIX}-${ENVIRONMENT}"
STATIC_WEB_APP_NAME="web-${NAME_PREFIX}-${ENVIRONMENT}"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Azure Login Check
# ---------------------------------------------------------------------------

info "Checking Azure CLI login status..."
if ! az account show &>/dev/null; then
  warn "Not logged in to Azure CLI. Launching login..."
  az login
fi

SUBSCRIPTION=$(az account show --query name -o tsv)
info "Using subscription: $SUBSCRIPTION"

# ---------------------------------------------------------------------------
# 2. Prompt for DB password if not set
# ---------------------------------------------------------------------------

if [ -z "${DB_ADMIN_PASS:-}" ]; then
  echo -n "Enter PostgreSQL admin password (min 8 chars, mixed case + digit): "
  read -rs DB_ADMIN_PASS
  echo
  if [ ${#DB_ADMIN_PASS} -lt 8 ]; then
    error "Password must be at least 8 characters."
  fi
fi

# ---------------------------------------------------------------------------
# 3. Create Resource Group
# ---------------------------------------------------------------------------

info "Creating resource group: $RESOURCE_GROUP in $LOCATION..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# ---------------------------------------------------------------------------
# 4. Deploy Bicep Template
# ---------------------------------------------------------------------------

info "Deploying Bicep infrastructure template..."
DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$BICEP_FILE" \
  --parameters \
    environment="$ENVIRONMENT" \
    namePrefix="$NAME_PREFIX" \
    dbAdminLogin="$DB_ADMIN_LOGIN" \
    dbAdminPassword="$DB_ADMIN_PASS" \
    location="$LOCATION" \
  --query 'properties.outputs' \
  --output json)

# Parse outputs
APP_SERVICE_URL=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['appServiceUrl']['value'])" 2>/dev/null || echo "")
STATIC_WEB_APP_URL=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['staticWebAppUrl']['value'])" 2>/dev/null || echo "")
POSTGRES_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['postgresServerFqdn']['value'])" 2>/dev/null || echo "")
STORAGE_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['storageAccountName']['value'])" 2>/dev/null || echo "")
KV_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['keyVaultName']['value'])" 2>/dev/null || echo "")

info "Infrastructure deployed successfully!"
info "  App Service URL:     $APP_SERVICE_URL"
info "  Static Web App URL:  $STATIC_WEB_APP_URL"
info "  PostgreSQL FQDN:     $POSTGRES_FQDN"
info "  Storage Account:     $STORAGE_NAME"
info "  Key Vault:           $KV_NAME"

# ---------------------------------------------------------------------------
# 5. Store Secrets in Key Vault
# ---------------------------------------------------------------------------

info "Generating JWT secrets and storing in Key Vault..."

JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)

# Grant current user Key Vault secrets access
CURRENT_USER_OID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || echo "")
if [ -n "$CURRENT_USER_OID" ]; then
  az role assignment create \
    --role "Key Vault Secrets Officer" \
    --assignee "$CURRENT_USER_OID" \
    --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KV_NAME" \
    --output none 2>/dev/null || warn "Role assignment may already exist."
fi

az keyvault secret set --vault-name "$KV_NAME" --name "jwt-secret" --value "$JWT_SECRET" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "jwt-refresh-secret" --value "$JWT_REFRESH_SECRET" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "db-admin-password" --value "$DB_ADMIN_PASS" --output none

info "Secrets stored in Key Vault."

# ---------------------------------------------------------------------------
# 6. Configure App Service Settings
# ---------------------------------------------------------------------------

info "Configuring App Service application settings..."

# Enable system-assigned managed identity for Key Vault access
az webapp identity assign \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output none

# Set app settings (JWT secrets via Key Vault references)
az webapp config appsettings set \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    JWT_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=jwt-secret)" \
    JWT_REFRESH_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=jwt-refresh-secret)" \
  --output none

# Grant the App Service managed identity access to Key Vault secrets
APP_IDENTITY=$(az webapp identity show \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId -o tsv)

az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee "$APP_IDENTITY" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KV_NAME" \
  --output none

info "App Service configured with Key Vault references."

# ---------------------------------------------------------------------------
# 7. Build and Deploy API via Zip Deploy
# ---------------------------------------------------------------------------

info "Building API for deployment..."

cd "$REPO_ROOT"

# Install dependencies and build
npm ci
npm run db:generate --workspace=apps/api
npx turbo build --filter=@retailerp/api

# Create a deployment package
DEPLOY_DIR=$(mktemp -d)
cp -r apps/api/dist "$DEPLOY_DIR/"
cp -r apps/api/prisma "$DEPLOY_DIR/"
cp apps/api/package.json "$DEPLOY_DIR/"
cp package.json "$DEPLOY_DIR/package-root.json"

# Install production deps in the deploy dir
cd "$DEPLOY_DIR"
cp package-root.json package.json
npm install --omit=dev 2>/dev/null || true

# Create zip
ZIP_FILE="/tmp/retailerp-api-deploy.zip"
cd "$DEPLOY_DIR"
zip -r "$ZIP_FILE" . -x "*.map" > /dev/null

info "Deploying API to App Service via zip deploy..."
az webapp deploy \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$ZIP_FILE" \
  --type zip \
  --output none

# Cleanup
rm -rf "$DEPLOY_DIR" "$ZIP_FILE"

info "API deployed!"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------

echo ""
echo "============================================================================="
echo -e "${GREEN}RetailERP Deployment Complete!${NC}"
echo "============================================================================="
echo ""
echo "  API:           $APP_SERVICE_URL"
echo "  Web Frontend:  $STATIC_WEB_APP_URL"
echo "  PostgreSQL:    $POSTGRES_FQDN"
echo "  Key Vault:     $KV_NAME"
echo ""
echo "Next steps:"
echo "  1. Set up GitHub Actions secrets for CI/CD (see .github/workflows/ci.yml)"
echo "  2. Configure custom domain (optional) via Azure Portal"
echo "  3. Run the seed script against production DB if needed"
echo "  4. Deploy the web frontend via Static Web Apps CLI or GitHub Actions"
echo ""
echo "  To deploy the web app manually:"
echo "    cd apps/web && npm run build"
echo "    npx @azure/static-web-apps-cli deploy dist \\"
echo "      --deployment-token <from-azure-portal>"
echo "============================================================================="
