# Plan — Invoice Scanning for Purchases & Register-Entry Image Parsing

> Status: Proposed (ready for implementation)
> Owner: Engineering
> Last updated: 2026-04-25
> Scope: Two related capabilities
> 1. Auto-fill the **Add Purchase** form from a photo or PDF of a distributor invoice.
> 2. Extract structured-ish data from a **handwritten sale register** photo and present it for review (no auto-fill yet).

---

## 1. Goals

### 1.1 Invoice → Purchase form auto-fill

- User opens **Purchases → Add Purchase** and chooses **Scan Invoice**.
- User can either:
  - Take a photo with the phone camera (PWA or Expo native), **or**
  - Upload a JPG/PNG/HEIC image, **or**
  - Upload a PDF (single or multi-page).
- The system parses the document and pre-fills:
  1. **Distributor** — match by GSTIN first, then by company name. If no match exists, populate a "create distributor" sub-form with the parsed name, GSTIN, address, phone so the user can confirm and create.
  2. **Invoice metadata** — invoice number, invoice date, totals, GST type (IGST vs CGST+SGST).
  3. **Multiple line items** — each item gets brand, model number, MRP, dealer price (DP), selling price if present, per-line GST %, color, warranty, HSN/SAC, barcode if present.
  4. **Serial numbers per item** — a single line for "Model X · qty 5" with five serial numbers must produce **5 expanded purchase rows** when the user clicks Add Product, exactly as the current manual form does today via the textarea.
- User reviews the auto-filled form, edits anything wrong, then submits as a normal purchase.
- The form must never silently submit. The user is always the final approver.

### 1.2 Sale Register image → parsed preview

- User opens **Sales → Scan Register Page** (new entry point).
- User takes/uploads a photo of a register page (handwritten, multiple sale rows).
- System OCRs the page and returns a structured-ish list of rows: date, customer name, model, ledger number, amount, payment mode, etc. — best effort.
- We **do not** auto-fill the existing Sale form for now. We just **display** the parsed structure so the user can:
  - Verify quality of parsing.
  - Copy values manually into the Sale form.
  - Optionally export the parsed JSON for later batch ingestion.
- This becomes the foundation for a future "approve and import" path.

### 1.3 Non-goals (initial release)

- No fully automatic distributor creation without confirmation.
- No automatic purchase submission.
- No background batch processing of large PDF dumps.
- No bulk invoice queue UI; one invoice at a time.

---

## 2. Library / API choice

### 2.1 Why a multimodal LLM beats classical OCR for these inputs

Classical OCR (Tesseract, AWS Textract base, Google Vision text detection) returns flat text or basic key-value pairs. Indian retail electronics invoices have:

- Very irregular layouts across distributors (Samsung, LG, Bajaj, local distributors).
- Per-item serial number lists, often crammed below the model row, sometimes spilling over multiple lines, sometimes in a separate annex.
- Mixed numerics (MRP / DP / discount / scheme / net) where naming varies per distributor.
- Stamps, signatures, watermarks that confuse table detectors.

A **multimodal LLM with structured output (JSON schema)** is dramatically more reliable here than classical pipelines, and dramatically cheaper than a managed Document AI per-page price for our volume.

### 2.2 Recommendation

| Need | Choice | Why |
| --- | --- | --- |
| **Invoice extraction (image + PDF)** | **OpenAI `gpt-4o-mini` with `response_format: json_schema`** (Structured Outputs) | Best price/accuracy on free-form invoices with serial-number lists; ~$0.15/1M input tokens, single image is ~$0.005–$0.01 per call. Strict JSON schema means we never get malformed output. |
| **Fallback / tabular invoices** | **Azure AI Document Intelligence — `prebuilt-invoice` model** | When LLM extraction confidence is low, optionally call this for line-item rescue. Pluggable, off by default. |
| **Register handwriting** | **OpenAI `gpt-4o` (full, not mini) with JSON schema** | Handwriting-heavy. `gpt-4o` materially outperforms `gpt-4o-mini` on Indian handwritten register pages in early checks. Cost is acceptable since this is invoked ad-hoc. |
| **PDF rasterization (server)** | **`pdf-to-img`** (uses pdfjs under the hood, no native deps) | Converts each PDF page to a PNG buffer that we feed to the LLM. No Poppler / GraphicsMagick install needed on Windows or Linux. |
| **Digital-PDF text fast path** | **`pdfjs-dist`** | If the uploaded PDF is a real digital invoice (text layer present), we extract text directly and send `text + image` to the LLM together for a more accurate parse. |
| **File upload** | **`@fastify/multipart`** (already installed) | No new infra. |
| **Mobile camera** | PWA: `<input type="file" accept="image/*,application/pdf" capture="environment">`. Expo: `expo-image-picker` + `expo-document-picker`. | Reuses existing apps. PWA already works on iOS Safari and Android Chrome. |

> Note about the "unstructured" Python library: the user mentioned this. `unstructured.io` is great for partitioning structured PDFs/HTML/Word into elements, but it does not perform handwriting recognition and does not understand Indian GST invoices specifically. We will not adopt it. If we ever need digital-PDF chunking (e.g., for invoices that are clean text PDFs), we will use `pdfjs-dist` directly — same outcome, simpler stack, no Python runtime.

### 2.3 Why not the obvious alternatives

- **Tesseract.js / Google Vision OCR:** good text, terrible structure on these layouts. Would still need an LLM second pass, doubling latency and code.
- **AWS Textract AnalyzeExpense:** weak on Indian invoice formats and on serial-number lists.
- **Pure Azure Document Intelligence prebuilt-invoice:** decent for line items, but does not extract per-item serial numbers reliably and is more expensive than `gpt-4o-mini` per page.
- **Open-source vision models (Llama 3.2 Vision, Qwen2-VL):** fine, but self-hosting is cost-and-ops overhead we don't need today. We can swap providers later because the boundary is one service file.

### 2.4 Estimated cost

- Average invoice ≈ 1–2 pages, ~$0.005–$0.015/parse with `gpt-4o-mini`.
- Average register page ≈ 1 image, ~$0.02–$0.05/parse with `gpt-4o`.
- 4 shops × ~20 invoices/day × $0.015 ≈ **~$36/month** worst case. Negligible.

---

## 3. Architecture

```
┌──────────────────────┐    multipart upload    ┌──────────────────────────┐
│ Web (PurchaseCreate) │ ─────────────────────► │ POST /api/v1/ocr/invoice │
│ + Camera/File picker │                        │ POST /api/v1/ocr/register│
└──────────┬───────────┘                        └────────────┬─────────────┘
           │ parsed JSON (preview)                           │
           ▼                                                 ▼
   Review + Edit UI                                   ocr.service.ts
           │                                                 │
           ▼                                                 ├── 1. Validate file (size, mime, page count)
   Existing react-hook-form                                  ├── 2. If PDF → rasterize each page (pdf-to-img)
   submit → existing                                         ├── 3. Build prompt + JSON schema
   /purchases endpoint                                       ├── 4. Call LLM provider (OpenAI by default)
                                                             ├── 5. Post-process:
                                                             │     - normalize GST %
                                                             │     - split serial number lists
                                                             │     - fuzzy-match distributor by GSTIN/name
                                                             └── 6. Return parsed payload
```

The OCR module is **stateless and provider-pluggable**. No DB writes happen in the OCR module — actual creation goes through existing `purchases` and `distributors` modules, which already enforce shop scope, RBAC, validation, and uniqueness.

---

## 4. Backend design

New module: `apps/api/src/modules/ocr/`

### 4.1 Files

| File | Purpose |
| --- | --- |
| `ocr.routes.ts` | Registers `/ocr/invoice` and `/ocr/register-entry` under `/api/v1`. RBAC: same as Add Purchase / Add Sale. |
| `ocr.controller.ts` | Multipart parsing, file validation, calls service, sends standard `sendSuccess` / `sendError`. |
| `ocr.service.ts` | Orchestrates rasterization + provider call + post-processing. |
| `providers/openai-vision.provider.ts` | OpenAI Structured Outputs implementation. |
| `providers/azure-doc-intel.provider.ts` | Optional fallback; off by default. |
| `schemas/invoice.schema.ts` | JSON schema for invoice extraction (strict, used both for OpenAI Structured Outputs and Zod validation post-call). |
| `schemas/register.schema.ts` | JSON schema for register-entry extraction. |
| `utils/pdf.ts` | `rasterizePdfToImages(buffer): Promise<Buffer[]>` using `pdf-to-img`. Also `extractPdfText(buffer): Promise<string>` using `pdfjs-dist` (best-effort, returns empty string for scanned PDFs). |
| `utils/distributor-match.ts` | Matches parsed distributor info against the existing `distributor` table for the active shop scope. |
| `ocr.validation.ts` | Zod schemas for the responses we return to the client. |

### 4.2 Endpoints

#### `POST /api/v1/ocr/invoice`

- **Auth:** authenticated, RBAC permission `purchases.create` (the same gate as Add Purchase).
- **Body:** `multipart/form-data`
  - `file` — image (`image/jpeg`, `image/png`, `image/webp`, `image/heic`) or `application/pdf`. Max 15 MB. Max 8 PDF pages.
- **Response (200):**
  ```jsonc
  {
    "data": {
      "source": { "kind": "image" | "pdf", "pageCount": 1 },
      "invoice": {
        "number": "INV/2026/0431",
        "date": "2026-04-12",
        "supplierStateCode": "27",
        "buyerStateCode": "27",
        "totals": { "taxableAmount": 84500, "gstAmount": 15210, "netAmount": 99710 },
        "gstSplit": "CGST_SGST" | "IGST"
      },
      "distributor": {
        "parsed": {
          "companyName": "Acme Electronics Pvt Ltd",
          "gstNumber": "27AAACA1234A1ZB",
          "panNumber": "AAACA1234A",
          "address": "...",
          "phone": "..."
        },
        "match": { "id": "uuid-or-null", "matchedBy": "gst" | "name" | null, "confidence": 0.0 }
      },
      "items": [
        {
          "brand": "Samsung",
          "modelNumber": "UA55AU7700",
          "categoryHint": "TV",          // best-effort, used for category cascader prefill
          "hsnCode": "8528",
          "serialNumbers": ["SN1", "SN2", "SN3"],
          "quantity": 3,                 // == serialNumbers.length when serials present
          "mrp": 65990,
          "purchasePrice": 38500,        // dealer price
          "sellingPrice": null,
          "gstPercent": 18,
          "color": "Black",
          "warrantyMonths": 12,
          "barcode": null,
          "notes": null,
          "confidence": 0.0..1.0
        }
      ],
      "warnings": ["Could not read totals table on page 2"],
      "rawText": "...optional, for debugging in dev"
    }
  }
  ```

#### `POST /api/v1/ocr/register-entry`

- **Auth:** authenticated, RBAC permission `sales.create`.
- **Body:** `multipart/form-data` with single image (PDF allowed but rare).
- **Response (200):**
  ```jsonc
  {
    "data": {
      "rows": [
        {
          "rowIndex": 1,
          "date": "2026-04-09",
          "ledgerNumber": "LD-1029",
          "customerName": "...",
          "phone": "...",
          "modelNumber": "...",
          "amount": 45000,
          "paymentMode": "cash" | "upi" | "card" | "installment" | null,
          "remarks": "...",
          "confidence": 0.0..1.0
        }
      ],
      "warnings": [],
      "rawText": "best-effort full-page OCR text"
    }
  }
  ```

### 4.3 LLM call shape (OpenAI)

- Use `chat.completions` (or the new `responses` API) with:
  - `model: "gpt-4o-mini"` for invoices, `"gpt-4o"` for register pages (configurable via `OCR_INVOICE_MODEL`, `OCR_REGISTER_MODEL` env vars).
  - `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`.
  - System prompt: short, in English, mentions Indian GST format, asks the model to use `null` when unsure, asks to keep numeric strings in the original currency, and asks to never invent serial numbers.
  - User content: one or more image parts (data URLs from PDF rasterization or the original upload), plus the extracted text layer if available, plus a short summary of known distributor names + GSTINs for the active shop scope (top 100 active) so the model can self-match.
- After we get JSON, validate with **Zod** against the same schema shape; reject and surface a clean error if anything is malformed. Strict mode at the OpenAI side makes this rare but we still defend.

### 4.4 Post-processing

- Normalize GST %: snap to nearest of `[0, 5, 12, 18, 28]`.
- Split serial numbers: if model returns a single string, split on whitespace/commas/newlines, dedupe, trim, drop empties.
- `quantity = serialNumbers.length || quantity || 1`.
- Distributor match (in `utils/distributor-match.ts`):
  1. Exact GSTIN match → highest confidence.
  2. Normalized name match (lowercase, strip punctuation, collapse whitespace) using Postgres `ILIKE` with `%` wrap → medium confidence.
  3. Otherwise return `match: null` and let UI offer "Create distributor with these details".
- Currency: numbers come back as plain numbers (rupees), no formatting.

### 4.5 Configuration

New env vars (with safe defaults; the feature is off if no key is configured):

```
OCR_PROVIDER=openai            # openai | azure | disabled
OPENAI_API_KEY=...
OCR_INVOICE_MODEL=gpt-4o-mini
OCR_REGISTER_MODEL=gpt-4o
OCR_MAX_FILE_MB=15
OCR_MAX_PDF_PAGES=8
AZURE_DOCINTEL_ENDPOINT=       # optional fallback
AZURE_DOCINTEL_KEY=
```

If `OCR_PROVIDER=disabled`, the routes return `503 Service Unavailable` with a clear message and the UI hides the Scan buttons. This keeps local dev and air-gapped envs healthy.

### 4.6 Security

- Multipart validated by mime + magic-byte sniff (we will not trust client mime alone).
- File buffer is **never persisted** in the default flow. We only forward bytes to the OCR provider, get back JSON, and discard. No new DB tables in this plan.
- Rate-limit `/ocr/*` per user: 30 req / 5 min using existing `@fastify/rate-limit`.
- Strip EXIF before sending images out (orientation-correct + privacy).
- All requests require authentication and pass through RBAC.

### 4.7 Errors

- 400: file too large, unsupported mime, password-protected PDF.
- 413: file rejected at gateway.
- 422: provider returned malformed JSON after retry.
- 502: provider unreachable / non-2xx.
- 503: feature disabled.

---

## 5. Frontend design (web)

### 5.1 Purchase scan flow (`apps/web/src/pages/purchases/PurchaseCreatePage.tsx`)

- Add a primary action **Scan Invoice** at the top of the page, next to the existing Step 1 / "Select Distributor" header. On mobile widths it appears as a sticky button.
- Clicking opens a new modal: `<ScanInvoiceDialog />`.
  - Two tabs: **Camera** (renders `<input type="file" accept="image/*" capture="environment">`), **Upload** (`accept="image/*,application/pdf"`).
  - On selection, immediately POST to `/ocr/invoice`, show a spinner with "Reading invoice…".
  - On response, show a **Review panel** with:
    - Distributor card: matched distributor (with link) **or** "Not found — create new" banner with editable fields.
    - Invoice metadata (number, date, totals).
    - Items table — one row per item, with serial-number chips. Inline-editable.
  - "Use these details" button → calls a new helper `applyInvoiceParse(parsed, formMethods)` that does the equivalent of the current manual form fill via `setValue` calls in [PurchaseCreatePage.tsx](apps/web/src/pages/purchases/PurchaseCreatePage.tsx). The dialog then closes and the user is on Step 2 (or whichever step is correct given the parsed payload).
  - "Cancel" simply discards the parse.
- We keep the existing manual flow fully intact. Scan is purely additive.

### 5.2 Distributor auto-create

- When `parsed.distributor.match` is null, the Review panel shows a "Create distributor" mini-form pre-filled with the parsed values. Confirming calls the existing `POST /distributors` endpoint and then assigns the new distributor as the selected one in the form. No special API needed.

### 5.3 Serial number handling on apply

- The existing form already supports a `serialNumbers` textarea where one serial per line expands into N rows on submit. The Apply step writes the array joined by `\n` into that textarea. No change to the submit pipeline — we keep the well-tested expansion logic in [PurchaseCreatePage](apps/web/src/pages/purchases/PurchaseCreatePage.tsx).

### 5.4 Register-entry preview (`apps/web/src/pages/sales/`)

- Add a new page route `/sales/scan-register` and a button **Scan Register Page** on the Sale list page.
- The page is a single screen:
  - File picker (camera + image + PDF).
  - On submit, POST to `/ocr/register-entry`.
  - Render a table of parsed rows with a download-as-CSV button.
  - No Sale form integration in this iteration. We make this clear in copy: "Preview only. Use these values to fill the Sale form manually."

### 5.5 Mobile (Expo)

- `apps/mobile` already targets the Employee role only. We will:
  - Add an **Invoice scan** entry on the Admin/Accountant flow once the web flow is stable, using `expo-image-picker` and `expo-document-picker`. Same backend endpoints.
  - Out of scope for the first PR: keep mobile additions minimal; PWA camera works on field phones today.

### 5.6 Components to add

| Component | Path |
| --- | --- |
| `ScanInvoiceDialog` | `apps/web/src/components/ScanInvoiceDialog.tsx` |
| `InvoiceParseReview` | `apps/web/src/components/InvoiceParseReview.tsx` |
| `RegisterParseTable` | `apps/web/src/components/RegisterParseTable.tsx` |
| `useScanInvoiceMutation` / `useScanRegisterMutation` | `apps/web/src/hooks/useOcr.ts` |
| `ocr-api.ts` | `apps/web/src/api/ocr-api.ts` |

No changes to existing form layout. We only add an entry point and a setter helper.

---

## 6. Data model

No schema changes are required for the first delivery.

Optional follow-up table (not part of the first PR), to support audit/improvement:

```prisma
model OcrParse {
  id          String   @id @default(cuid())
  shopId      String
  userId      String
  kind        OcrKind   // INVOICE | REGISTER
  fileMime    String
  pageCount   Int
  promptModel String
  rawJson     Json
  applied     Boolean   @default(false)
  appliedRefId String?  // purchaseId / saleId once accepted
  createdAt   DateTime  @default(now())
}
```

This lets us measure accuracy and retrain prompts later. Gated behind a feature flag.

---

## 7. Rollout

1. **PR 1 — backend module:** `/ocr/invoice` only, OpenAI provider, JSON schema, Zod validation, multipart, rate-limit, distributor matcher, unit tests for the matcher and post-processing. Feature flag default off.
2. **PR 2 — web invoice scan UI:** dialog, review panel, distributor auto-create, apply helper. Live behind the same feature flag.
3. **PR 3 — register-entry endpoint + preview UI:** `/ocr/register-entry`, new `Scan Register Page` page. CSV export.
4. **PR 4 — Optional Azure fallback** in the provider boundary, plus `OcrParse` audit table behind flag.
5. **PR 5 — Expo mobile entry points** for Admin/Accountant invoice scan.

Each PR is independently revertable. Manual entry continues to work throughout.

---

## 8. Testing

- Unit tests for `distributor-match.ts` (GST normalization, name fuzzing).
- Unit tests for serial-number splitter.
- Unit tests for GST snap normalizer.
- Snapshot tests against a small fixture set of redacted real invoices stored under `apps/api/test/fixtures/invoices/` (5–10 representative samples). Provider call mocked.
- One end-to-end smoke test that uploads a fixture image and asserts `items.length > 0`.

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| LLM hallucinates serial numbers | Strict JSON schema, system prompt forbids invention, post-validation that flags any serial that doesn't appear in the OCR text layer when available. |
| Scanned/blurry photos give bad parses | Show parsed confidence per field; require user confirmation; allow re-scan. |
| Provider outage | OCR module returns 502; UI shows "Scan unavailable, fall back to manual entry". Manual flow always works. |
| Cost runaway | Per-user rate limit, max file size, max PDF pages; OPS alert if spend > threshold. |
| Privacy: invoices contain GSTIN/PII | No persistence by default; egress only to chosen provider; admin can disable provider via `OCR_PROVIDER=disabled`. |
| Handwriting parse quality on register | We deliberately ship register parsing as **preview-only**; no auto-creation of sales until accuracy is validated. |

---

## 10. Out of scope (future work)

- Bulk invoice ingestion (folder watch / email forwarding).
- Auto-create sales from register pages.
- Smart category assignment using the same model (we currently set `categoryHint` only as a hint).
- Self-hosted vision model.
- Versioned prompt experiments / accuracy dashboards.
