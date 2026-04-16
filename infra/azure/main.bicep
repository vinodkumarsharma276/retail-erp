// =============================================================================
// RetailERP — Azure Infrastructure (Bicep)
//
// Provisions the cheapest viable architecture:
//   - App Service Plan B1 (Linux)       ~$13/month
//   - App Service (Node 22, Docker)     (included in plan)
//   - PostgreSQL Flexible Server B1ms   ~$12/month (burstable, 32 GB)
//   - Static Web App (Free tier)        $0/month
//   - Storage Account (LRS, Hot)        ~$0.50/month (minimal usage)
//   - Key Vault (Standard)              ~$0.03/key/month
//
// Estimated total: ~$26/month
//
// Usage:
//   az deployment group create \
//     --resource-group <rg-name> \
//     --template-file infra/azure/main.bicep \
//     --parameters dbAdminPassword='<strong-password>'
// =============================================================================

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment name (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'prod'

@description('PostgreSQL administrator login name')
param dbAdminLogin string = 'retailerp'

@secure()
@description('PostgreSQL administrator password')
param dbAdminPassword string

@description('Name prefix for all resources')
param namePrefix string = 'retailerp'

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var suffix = '${namePrefix}-${environment}'
var appServicePlanName = 'plan-${suffix}'
var appServiceName = 'api-${suffix}'
var staticWebAppName = 'web-${suffix}'
var postgresServerName = 'db-${suffix}'
var storageAccountName = replace('st${namePrefix}${environment}', '-', '')
var keyVaultName = 'kv-${suffix}'
var databaseName = 'retailerp'

// ---------------------------------------------------------------------------
// App Service Plan — B1 Basic (Linux)
// Cost: ~$13/month (1 core, 1.75 GB RAM)
// ---------------------------------------------------------------------------

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  properties: {
    reserved: true // Required for Linux
  }
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
}

// ---------------------------------------------------------------------------
// App Service — Node.js 22 API (Docker container)
// Cost: Included in App Service Plan
// ---------------------------------------------------------------------------

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: false // B1 supports alwaysOn but we disable to save CPU
      ftpsState: 'Disabled'
      http20Enabled: true
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'API_PORT'
          value: '3001'
        }
        {
          name: 'API_HOST'
          value: '0.0.0.0'
        }
        {
          name: 'WEBSITES_PORT'
          value: '3001'
        }
        {
          name: 'DATABASE_URL'
          value: 'postgresql://${dbAdminLogin}:${dbAdminPassword}@${postgresServer.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_NAME'
          value: 'uploads'
        }
        {
          name: 'CORS_ORIGIN'
          value: 'https://${staticWebApp.properties.defaultHostname}'
        }
        // JWT_SECRET and JWT_REFRESH_SECRET should be set manually or via Key Vault
        // reference after deployment:
        //   az webapp config appsettings set --name <app> --resource-group <rg> \
        //     --settings JWT_SECRET=@Microsoft.KeyVault(VaultName=<kv>;SecretName=jwt-secret)
      ]
      healthCheckPath: '/health'
    }
    httpsOnly: true
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL Flexible Server — Burstable B1ms
// Cost: ~$12/month (1 vCore, 2 GB RAM, 32 GB storage)
// ---------------------------------------------------------------------------

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: dbAdminLogin
    administratorLoginPassword: dbAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled' // Keep costs low
    }
    highAvailability: {
      mode: 'Disabled' // No HA to save costs
    }
  }
}

// PostgreSQL database
resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow Azure services to access PostgreSQL (needed for App Service)
resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ---------------------------------------------------------------------------
// Static Web App — Free tier
// Cost: $0/month (includes custom domains, SSL, global CDN)
// ---------------------------------------------------------------------------

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    buildProperties: {
      appLocation: 'apps/web'
      outputLocation: 'dist'
    }
  }
}

// ---------------------------------------------------------------------------
// Storage Account — LRS Hot (cheapest)
// Cost: ~$0.50/month for minimal usage (invoices, photos)
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS' // Locally redundant — cheapest option
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Blob container for uploads
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'uploads'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// Key Vault — Standard tier
// Cost: ~$0.03/10,000 operations (negligible)
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output appServiceUrl string = 'https://${appService.properties.defaultHostName}'
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output staticWebAppDeploymentToken string = staticWebApp.listSecrets().properties.apiKey
output postgresServerFqdn string = postgresServer.properties.fullyQualifiedDomainName
output storageAccountName string = storageAccount.name
output keyVaultName string = keyVault.name
