# RetailERP — Production Deployment Evaluation

> Audience: solo operator launching tenant **Vinod Electronics** on a custom domain (assumed `retailerp.com`), with the platform admin at `admin.retailerp.com` and future tenants at `<slug>.retailerp.com`.
>
> Stack baseline (already in repo): Node 22 Fastify API + React 19 SPA + PostgreSQL 16 + Prisma; multi-tenant resolved by subdomain (`X-Tenant-Slug` header or `*.retailerp.com`).
>
> All Azure prices below are **Central India retail USD, fetched from the Azure Retail Prices API on 2026-04**. Monthly figures use `hourly × 730`. INR conversions use **1 USD ≈ ₹84** (replace with current rate if needed).

---

## TL;DR — Recommendation

**Go with Option A: single App Service B1 Linux container serving both the SPA and the API, in front of Azure Database for PostgreSQL Flexible Server B1ms.** Put Cloudflare (free plan) in front of the App Service for DNS + wildcard TLS on `*.retailerp.com` + DDoS + caching. This is the cheapest, simplest, and lowest-ops setup that meets the wildcard-subdomain SaaS requirement.

| Total Azure spend | **~$38/month** | **~₹3,200/month** |
| Cloudflare        | **$0**         | **₹0**            |
| Setup complexity  | Low — single Bicep, single deploy pipeline |
| Multi-tenant fit  | Native — wildcard TLS handled at Cloudflare, App Service accepts host header |

---

## Hard pricing snapshot (Central India, retail USD)

| Resource | SKU | $/hour | $/month (×730) | Notes |
|---|---|---:|---:|---|
| App Service Linux | **B1** (1 vCPU / 1.75 GB) | 0.018 | **$13.14** | Current Bicep default |
| App Service Linux | B2 (2 vCPU / 3.5 GB) | 0.036 | $26.28 | If B1 RAM is tight |
| App Service Linux | B3 (4 vCPU / 7 GB) | 0.072 | $52.56 | Overkill today |
| App Service Linux | S1 (1 vCPU / 1.75 GB + slots) | 0.088 | $64.24 | Slots ≠ worth 5× B1 yet |
| App Service Linux | P0v3 (1 vCPU / 4 GB) | 0.082 | $59.86 | Better-perf vCPU, only at scale |
| Postgres Flex | **B1ms** (1 vCPU / 2 GB) | 0.0245 | **$17.89** | Compute only |
| Postgres Flex | B2s (2 vCPU / 4 GB) | 0.098 | $71.54 | Skip until traffic warrants |
| Postgres Flex storage | 32 GB / 64 GB | 0.131/GB | $4.19 / $8.38 | Premium SSD v1 |
| Postgres Flex backup | 7-day default | free up to provisioned size | $0 | |
| Static Web Apps | Free | — | $0 | 2 custom domains, no wildcard |
| Static Web Apps | **Standard** | flat | **$9.00** | 5 custom domains free, +$0.10/extra |
| Static Web Apps | Standard + Front Door add-on | 0.024 | $17.52 | Required for wildcard TLS via Azure |
| Container Apps | Standard vCPU (active) | 0.000024/sec | varies | Free grant: 180K vCPU-sec/mo |
| Container Apps | Standard memory (active) | 0.000003/GB-sec | varies | Free grant: 360K GiB-sec/mo |
| Container Apps | Standard requests | 0.40 per 1M | ~$0 | Free grant: 2M req/mo |
| Storage (blob LRS hot) | Standard_LRS | — | <$1 | For uploads / OCR / bank statements |
| Key Vault Standard | Operations | $0.03 per 10K ops | <$1 | Secrets + JWT keys |
| Container Registry | Basic | flat | $5/mo | Only if you push prebuilt images |

> Compute Engine SKUs (Standard_B1ms / B2s) are Virtual Machine SKUs — they have the same names as Postgres burstable SKUs but are billed differently. Postgres Flex prices above are the database-specific meters.

---

## Option A — App Service B1 + Postgres B1ms + Cloudflare ⭐ recommended

**Architecture**

```
Cloudflare (free) -> admin.retailerp.com ----┐
Cloudflare (free) -> *.retailerp.com  -------+--> Azure App Service B1 Linux
                                                  │  • serves React SPA (static, gzip)
                                                  │  • Fastify API at /api/v1/*
                                                  └─► Azure Database for PostgreSQL Flex B1ms
                                                       (Premium SSD 32 GB, 7d backup)
                                              │
                                              └──► Azure Storage (blob) for OCR/uploads
                                              └──► Key Vault (JWT secrets, DB password)
```

**Why this works for the SaaS subdomain model:**
- Cloudflare DNS holds an `A` (or `CNAME`) for `*.retailerp.com` pointing at App Service.
- Cloudflare issues and rotates a wildcard cert at the edge — zero cost, zero ops.
- App Service receives traffic over HTTPS (Cloudflare → origin via Cloudflare-managed cert + App Service’s default `*.azurewebsites.net` cert, or Full mode with App Service Managed Certificate for the custom domain).
- The Fastify `tenantResolver` already reads the host header — no code change.

**Monthly cost**

| Line item | $ | ₹ (×84) |
|---|---:|---:|
| App Service B1 Linux | 13.14 | 1,104 |
| Postgres Flex B1ms compute | 17.89 | 1,503 |
| Postgres Flex storage 32 GB | 4.19 | 352 |
| Storage account (low usage) | 1.00 | 84 |
| Key Vault | 0.50 | 42 |
| Application Insights (basic ingestion) | 1.00 | 84 |
| Container Registry Basic (optional) | 5.00 | 420 |
| **Subtotal — minimal (no ACR)** | **~$37.72** | **~₹3,169** |
| **Subtotal — with ACR for prebuilt images** | **~$42.72** | **~₹3,589** |
| Cloudflare Free | 0.00 | 0 |

**Tradeoffs**
- + Cheapest cloud-managed option that meets wildcard subdomain requirement.
- + Single deploy unit. One pipeline. `prisma migrate deploy` already wired into `apps/api/Dockerfile`.
- + No need for SWA Standard or Front Door add-on ($17–27/mo savings).
- + Cloudflare gives free DDoS, caching, edge rules; can move to Cloudflare Workers later.
- − App Service B1 has **no auto-scale** and **shared cores**. Bursty CPU = slower responses. Acceptable for 4 shops; revisit at >50 concurrent users.
- − No deployment slots on B1. Use App Service’s "swap via deployment" or accept 30–60s downtime per deploy. If you want zero-downtime, jump to S1 (+$51/mo).
- − Cloudflare Free has 100 page rules / no SLA. Good enough for early SaaS.

**What to change in `infra/azure/main.bicep`**
- Keep B1 + B1ms (already there) — confirms baseline.
- Remove the Static Web App resource — you don’t need it.
- Add an output `appServiceHostName` and document Cloudflare CNAME setup.
- Set `CORS_ORIGIN` env to `https://admin.retailerp.com,https://*.retailerp.com` (the Fastify allowlist already supports comma-separated; for the wildcard tenant pattern, extend `isAllowedDevOrigin` style to allow `*.retailerp.com` in production — small code change).

---

## Option B — App Service B1 (API only) + Static Web Apps Standard (SPA)

**Architecture**

```
admin.retailerp.com ┐
*.retailerp.com     ├─► Azure Static Web Apps (Standard, $9/mo)
                    │     • serves React build
                    │     • proxies /api/* -> linked App Service
                    └─►  Azure App Service B1 Linux (API only)
                              └─► Postgres Flex B1ms
```

**Monthly cost**

| Line item | $ | ₹ |
|---|---:|---:|
| App Service B1 Linux (API) | 13.14 | 1,104 |
| Static Web Apps Standard | 9.00 | 756 |
| **Static Web Apps Front Door add-on (required for wildcard)** | **17.52** | **1,472** |
| Postgres Flex B1ms | 17.89 | 1,503 |
| Postgres Flex storage 32 GB | 4.19 | 352 |
| Storage + KV + AI | 2.50 | 210 |
| **Subtotal** | **~$64.24** | **~₹5,397** |

**Tradeoffs**
- + Cleaner separation of static frontend from API.
- + SWA gives global CDN, free preview environments per PR, built-in auth (unused here).
- − **$17.52/mo Front Door add-on is mandatory** for `*.retailerp.com` on SWA Standard. Without it, you can only add up to 5 named subdomains.
- − Almost 2× the cost of Option A for the same workload.
- − Two deploy pipelines (SWA + App Service) instead of one.

**Verdict:** Skip unless you specifically want Azure-native edge CDN and per-PR previews.

---

## Option C — Azure Container Apps (consumption, scale-to-zero)

**Architecture**

```
admin.retailerp.com ┐
*.retailerp.com     ├─► Azure Container Apps environment
                    │     • web: React build served by `serve`
                    │     • api: Fastify + Prisma
                    └─► Postgres Flex B1ms
```

**Monthly cost (always-on 0.25 vCPU / 0.5 GB per app)**

| Line item | $ | ₹ |
|---|---:|---:|
| API container active vCPU (after free grant) | ~11.45 | 962 |
| API container active memory (after free grant) | ~2.86 | 240 |
| Web container (similar) | ~14.31 | 1,202 |
| Postgres Flex B1ms + storage | 22.08 | 1,855 |
| Storage + KV + ACR | 7.50 | 630 |
| **Subtotal — both containers always on** | **~$58.20** | **~₹4,889** |
| **Subtotal — scale-to-zero, low traffic** | **~$32–35** | **~₹2,688–2,940** |

**Tradeoffs**
- + Scale-to-zero is genuinely cheap when idle.
- + KEDA-based autoscale handles real spikes.
- + Native managed certs on custom domains (wildcard requires Front Door, $35+/mo extra).
- − **Wildcard custom domain on Container Apps requires Azure Front Door (~$35/mo base + bandwidth + rules)** — kills the cost advantage for our SaaS model unless you use Cloudflare in front instead.
- − Cold starts at scale-to-zero hurt the first request after idle (1–3 s).
- − More moving parts than App Service.

**Verdict:** Worth it later (year 2+) when you have 20+ tenants and meaningful idle time. Not for launch.

---

## Option D — Single Linux VM (DIY)

**Architecture**: Standard_B2s VM running Docker Compose with API + web + Postgres + Caddy (wildcard Let’s Encrypt via DNS challenge).

**Monthly cost**

| Line item | $ | ₹ |
|---|---:|---:|
| VM Standard_B2s (Linux) | 32.70 | 2,747 |
| OS managed disk 32 GB Premium SSD | ~5 | 420 |
| Data disk for Postgres 64 GB | ~9 | 756 |
| Public IP + bandwidth | ~3 | 252 |
| Backup vault | ~5 | 420 |
| **Subtotal** | **~$55** | **~₹4,620** |

**Tradeoffs**
- + Total control. Caddy auto-issues a wildcard cert via Cloudflare DNS challenge for free.
- + No vendor lock-in.
- − You become the DBA, sysadmin, security patcher, backup verifier. **High operational burden.**
- − No managed Postgres backups, no point-in-time restore unless you script it.
- − Single point of failure. App Service has built-in restart-on-crash.

**Verdict:** Cheap-ish on paper, expensive in time. Don’t do this unless you enjoy 3am pages.

---

## Option E — Hybrid Cloudflare + App Service + external Postgres

Same as Option A but Postgres on a non-Azure provider (e.g. Neon free tier, Supabase free tier, or Aiven Hobbyist $25).

- Neon free: 0.5 GB storage, autopaused. Free → **$0**, total stack ~$15/mo. Risk: cold starts, data limit.
- Supabase free: 500 MB DB + 1 GB storage. Free → **$0**, total ~$15/mo. Risk: pause after 7d inactivity.
- Aiven Hobbyist Postgres: ~$25/mo, dedicated.

**Verdict:** Tempting for the first 3 months, but cross-cloud latency (Cloudflare/Azure → Neon US/EU) will hurt every API call from India. Skip unless you stay 100% on Cloudflare/Vercel and pick a region-close provider.

---

## Side-by-side

| Option | Monthly USD | Monthly INR | Wildcard subdomain | Ops effort | Recommendation |
|---|---:|---:|---|---|---|
| **A: App Service B1 + Postgres B1ms + Cloudflare** | **~$38** | **~₹3,200** | ✅ Cloudflare wildcard | Low | ⭐ **Pick this** |
| B: App Service + SWA Standard + Front Door | ~$64 | ~₹5,400 | ✅ via Front Door add-on | Low | Skip — pays 70% more for same |
| C: Container Apps consumption | ~$32–58 | ~₹2,700–4,900 | ⚠️ needs Front Door or Cloudflare | Medium | Re-evaluate at 20+ tenants |
| D: Single VM + Docker + Caddy | ~$55 | ~₹4,600 | ✅ Caddy wildcard | High | Avoid for solo operator |
| E: Cloudflare + App Service + external Postgres | ~$15–40 | ~₹1,300–3,400 | ✅ | Medium | Risky data residency / latency |

---

## Concrete next steps for Option A

1. **DNS**
   - Move `retailerp.com` nameservers to Cloudflare (free).
   - Create `A` record `@` → some landing page (or redirect to admin).
   - Create `CNAME` `*` → `<app-service-name>.azurewebsites.net`.
   - Create `CNAME` `admin` → `<app-service-name>.azurewebsites.net`.
   - Set Cloudflare SSL mode = **Full (strict)** once App Service has a managed cert; **Full** initially.

2. **Azure (modify `infra/azure/main.bicep`)**
   - Keep App Service B1, Postgres B1ms, Storage, Key Vault.
   - **Remove** the Static Web App resource.
   - Add custom domain bindings on the App Service for `admin.retailerp.com` and `vinodelectronics.retailerp.com` (Free App Service Managed Cert per host, up to 10 free; for `*.retailerp.com` you must bring your own wildcard cert, but with Cloudflare in front you don’t need it on App Service — Cloudflare’s edge cert is enough).
   - Set `CORS_ORIGIN` env to `https://admin.retailerp.com,https://vinodelectronics.retailerp.com` (extend pattern when you add tenants).
   - Set `TENANT_APEX_DOMAINS` env to `retailerp.com` (already the default).

3. **Backend changes**
   - Serve the built React SPA from Fastify (`@fastify/static`) — saves the SWA. One Docker image, one deploy.
   - Extend `apps/api/src/app.ts` CORS allowlist to accept `*.retailerp.com` in production (mirror what `isAllowedDevOrigin` does for `*.localhost`).
   - Confirm `tenantResolver` accepts subdomain on the production apex (it already does via `TENANT_APEX_DOMAINS`).

4. **Build & deploy**
   - Multi-stage Dockerfile already present in `apps/api/Dockerfile`. Add a stage that copies the `apps/web/dist` build into `/app/public` and serve it with `@fastify/static` from `/`.
   - Use **GitHub Actions** → build image → push to **ACR Basic ($5/mo)** OR **GitHub Container Registry (free for public; private free up to 500 MB)** → App Service pulls on deploy.
   - `prisma migrate deploy` already runs on container start.

5. **Onboard first tenant**
   - In the admin app (`admin.retailerp.com`), use the existing tenant onboarding page to create the **Vinod Electronics** tenant with slug `vinodelectronics`.
   - Cloudflare wildcard already covers `vinodelectronics.retailerp.com` — no DNS change needed per tenant.
   - First login: bootstrap admin credentials per the seed file.

6. **Observability**
   - Enable Application Insights (already in Bicep). ~$1/mo at our volume.
   - Enable App Service Diagnostic Logs → blob storage.

7. **Backups**
   - Postgres Flex automatic backup 7 days is free and on by default. Set retention to 14 days for ₹350/mo extra if compliance requires.

---

## When to upgrade (triggers)

| Trigger | Move to |
|---|---|
| CPU > 70% sustained on B1 | App Service B2 (+$13/mo) |
| Postgres connections > 50 or CPU > 70% | Postgres B2s (+$54/mo) |
| Need zero-downtime deploys | App Service S1 + slots (+$51/mo) |
| Need disaster recovery / second region | Add geo-redundant backup + standby (+$30-50/mo) |
| Tenant count > 20 with idle nights | Container Apps consumption (potential 30–50% savings) |
| Storage > 100 GB or unstructured files | Blob lifecycle policy + cool tier |

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cloudflare Free has no SLA | Acceptable for SaaS launch; upgrade to Cloudflare Pro ($25/mo) at 10+ tenants for advanced WAF + analytics |
| App Service B1 has no autoscale | Monitor with Application Insights; upgrade to S1 (slots) or P0v3 (better perf) when needed |
| Single region (Central India) | OK for India-only customer base. Add geo-restore + secondary region for cross-region DR later |
| Per-tenant data leakage | Already enforced via `shopScope` and `tenantResolver`; add tenant_id column-level RLS in Postgres for defence-in-depth |
| Secrets in env | Use Key Vault references in App Service config (already pattern in `deploy.sh`) |
| DB migrations failing on deploy | `prisma migrate deploy` runs on container start; failures keep old container alive. Consider a separate migration job before swap |

---

## Cost projection (Option A, growth)

| Stage | Tenants | Stack | Monthly USD | Monthly INR |
|---|---|---|---:|---:|
| Launch (today) | 1 (Vinod Electronics) | B1 + B1ms | $38 | ₹3,200 |
| Year 1 mid | 4 shops live | B1 + B1ms | $38 | ₹3,200 |
| Year 1 end | 4 shops + heavier OCR | B2 + B1ms + ACR | $56 | ₹4,700 |
| Year 2 | 10 tenants | B2 + B2s + ACR | $108 | ₹9,100 |
| Year 3 | 20+ tenants | P0v3 + B2s + Front Door | $150–200 | ₹12,600–16,800 |

---

*References*: Azure Retail Prices API (Central India, USD, fetched 2026-04). Cloudflare Free plan terms. App Service Free Managed Certificate documentation.
