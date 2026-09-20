import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Search,
  X,
  ChevronDown,
  Package,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useProductSearchQuery, useProductDetailQuery } from '../../hooks/useProducts';
import { useShopsQuery } from '../../hooks/useAuth';
import { useInitiateTransferMutation } from '../../hooks/useTransfers';
import { useShopStore } from '../../stores/shop-store';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR } from '@retailerp/shared-utils';
import type { Product } from '@retailerp/shared-types';

// Standard Indian GST slabs used to snap an inferred rate
const GST_SLABS = [0, 5, 12, 18, 28];

/** Infer GST rate (%) from the product's purchase invoice; default 18%. */
function inferGstRate(product: Product | null): number {
  if (!product) return 18;
  const purchase = (product as any).purchase;
  if (!purchase) return 18;
  const totalAmt = Number(purchase.totalAmount) || 0;
  const discAmt = Number(purchase.discountAmount) || 0;
  const gstAmt = Number(purchase.gstAmount) || 0;
  const base = totalAmt - discAmt;
  if (base <= 0 || gstAmt <= 0) return 18;
  const rawRate = (gstAmt / base) * 100;
  return GST_SLABS.reduce((prev, curr) =>
    Math.abs(curr - rawRate) < Math.abs(prev - rawRate) ? curr : prev,
  );
}

export function TransferCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledProductId = searchParams.get('productId') ?? undefined;
  const currentShopId = useShopStore((s) => s.currentShopId);

  // -----------------------------------------------------------------------
  // Pre-fill product from URL param
  // -----------------------------------------------------------------------
  const prefilledProductQuery = useProductDetailQuery(prefilledProductId);

  // Product search state
  const [productSearchText, setProductSearchText] = useState('');
  const debouncedProductSearch = useDebounce(productSearchText, 300);
  const productSearchQuery = useProductSearchQuery(debouncedProductSearch);
  const productResults = (productSearchQuery.data ?? []).filter(
    (p) => p.status === 'in_stock',
  );
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // When the prefilled product loads, auto-select it
  useEffect(() => {
    if (prefilledProductQuery.data && !selectedProduct) {
      setSelectedProduct(prefilledProductQuery.data);
    }
  }, [prefilledProductQuery.data, selectedProduct]);

  // -----------------------------------------------------------------------
  // Destination shop
  // -----------------------------------------------------------------------
  const { data: shops } = useShopsQuery();
  const destinationShops = (shops ?? []).filter(
    (s) => s.id !== currentShopId,
  );
  const [selectedShopId, setSelectedShopId] = useState('');

  // -----------------------------------------------------------------------
  // Transfer details
  // -----------------------------------------------------------------------
  const [transferPrice, setTransferPrice] = useState('');
  const [gstAmount, setGstAmount] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');

  /**
   * Apply default Transfer Price + GST Amount based on the chosen product.
   *
   * - Transfer Price = Dealer Price (purchase price) + ₹1 — the "internal
   *   transfer" convention so the receiving shop's DP is just barely above
   *   what we paid, keeping margins visible without inflating cost.
   * - GST Amount = inclusive GST on transfer price using the rate inferred
   *   from the product's purchase invoice (defaults to 18%).
   */
  const applyProductDefaults = (product: Product) => {
    const dp = Number(product.purchasePrice) || 0;
    const tPrice = dp + 1;
    setTransferPrice(tPrice ? tPrice.toFixed(2) : '');

    const rate = inferGstRate(product);
    const gst =
      rate > 0
        ? Math.round((tPrice * rate) / (100 + rate) * 100) / 100
        : 0;
    setGstAmount(gst ? gst.toFixed(2) : '');

    // Invoice number is auto-generated server-side
    setInvoiceNumber('');
  };

  // When the prefilled product loads (or selectedProduct changes through any
  // path), apply defaults automatically. This handles both the URL ?productId
  // entry and direct selection from the search dropdown.
  useEffect(() => {
    if (selectedProduct) {
      applyProductDefaults(selectedProduct);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------
  const initiateMutation = useInitiateTransferMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !selectedShopId) return;

    initiateMutation.mutate(
      {
        productId: selectedProduct.id,
        toShopId: selectedShopId,
        transferPrice: transferPrice ? Number(transferPrice) : undefined,
        gstAmount: gstAmount ? Number(gstAmount) : undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          navigate('/transfers', { replace: true });
        },
      },
    );
  };

  const canSubmit = !!selectedProduct && !!selectedShopId;

  const errorMessage = initiateMutation.error
    ? (initiateMutation.error as any)?.response?.data?.error ??
      (initiateMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-display">New Transfer</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* =============================================================== */}
        {/* STEP 1: PRODUCT SEARCH */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Step 1: Select Product
          </h2>

          {selectedProduct ? (
            /* Step 2: Product info card (read-only) */
            <div className="rounded-md border-2 border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-lg">
                    {selectedProduct.brand} {selectedProduct.modelNumber}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                    {selectedProduct.serialNumber && (
                      <span className="font-mono text-xs">
                        SN: {selectedProduct.serialNumber}
                      </span>
                    )}
                    <StatusBadge status={selectedProduct.status} />
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm">
                    <span>
                      MRP: <span className="font-medium">{formatINR(selectedProduct.mrp)}</span>
                    </span>
                    <span>
                      Selling Price:{' '}
                      <span className="font-semibold text-primary">
                        {formatINR(selectedProduct.sellingPrice)}
                      </span>
                    </span>
                    <span>
                      Purchase Price:{' '}
                      <span className="font-medium">{formatINR(selectedProduct.purchasePrice)}</span>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setProductSearchText('');
                    setTransferPrice('');
                    setGstAmount('');
                    setInvoiceNumber('');
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Search for an in-stock product to transfer. Type at least 3
                characters.
              </p>
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearchText}
                  onChange={(e) => {
                    setProductSearchText(e.target.value);
                    setShowProductDropdown(true);
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  placeholder="Search by brand, model, or serial number..."
                  className={cn(
                    'w-full rounded-md border bg-field pl-9 pr-8 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
                {productSearchText && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductSearchText('');
                      setShowProductDropdown(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {/* Dropdown */}
                {showProductDropdown && debouncedProductSearch.length >= 3 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg max-h-60 overflow-y-auto">
                    {productSearchQuery.isLoading ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </div>
                    ) : productResults.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        No in-stock products found.
                      </p>
                    ) : (
                      productResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            setSelectedProduct(product);
                            setProductSearchText('');
                            setShowProductDropdown(false);
                            // Defaults (transfer price + GST + invoice) are
                            // applied by the useEffect that watches
                            // selectedProduct.id, so the same logic runs
                            // whether the product comes from the dropdown
                            // or from a prefilled URL ?productId param.
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">
                                {product.brand} {product.modelNumber}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {product.serialNumber && (
                                  <span className="font-mono">
                                    SN: {product.serialNumber}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="text-right">
                              <StatusBadge status={product.status} />
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatINR(product.sellingPrice)}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* =============================================================== */}
        {/* STEP 3: DESTINATION SHOP */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Step 2: Destination Shop
          </h2>

          <div className="max-w-sm">
            <label
              htmlFor="toShopId"
              className="block text-sm font-medium mb-1.5"
            >
              Transfer To <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <select
                id="toShopId"
                value={selectedShopId}
                onChange={(e) => setSelectedShopId(e.target.value)}
                className={cn(
                  'w-full appearance-none rounded-md border bg-field px-3 py-2.5 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="">Select destination shop...</option>
                {destinationShops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name} ({shop.code})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* STEP 4: TRANSFER DETAILS */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Step 3: Transfer Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Transfer Price */}
            <div>
              <label
                htmlFor="transferPrice"
                className="block text-sm font-medium mb-1.5"
              >
                Transfer Price
              </label>
              <input
                id="transferPrice"
                type="number"
                step="0.01"
                value={transferPrice}
                onChange={(e) => setTransferPrice(e.target.value)}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-filled as Dealer Price + ₹1. Becomes the DP at the destination shop.
              </p>
            </div>

            {/* GST Amount */}
            <div>
              <label
                htmlFor="gstAmount"
                className="block text-sm font-medium mb-1.5"
              >
                GST Amount
              </label>
              <input
                id="gstAmount"
                type="number"
                step="0.01"
                value={gstAmount}
                onChange={(e) => setGstAmount(e.target.value)}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-computed from the product's purchase GST rate.
              </p>
            </div>

            {/* Invoice Number — auto-generated on the server */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1.5">
                Invoice Number
              </label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
                <span className="text-muted-foreground italic">
                  Auto-generated
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  TRF-&lt;FROM&gt;-&lt;TO&gt;-YYYYMMDD-NNNN
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Format: <code className="font-mono">TRF-{'{'}from-shop-code{'}'}-{'{'}to-shop-code{'}'}-{'{'}date{'}'}-{'{'}sequence{'}'}</code>
                — e.g. <code className="font-mono">TRF-VE-NE-20260503-0007</code>.
              </p>
            </div>
          </div>

          {/* Notes */}
          <div className="mt-4">
            <label
              htmlFor="notes"
              className="block text-sm font-medium mb-1.5"
            >
              Notes
            </label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this transfer..."
              className={cn(
                'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </section>

        {/* =============================================================== */}
        {/* ERROR */}
        {/* =============================================================== */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        {/* =============================================================== */}
        {/* FOOTER */}
        {/* =============================================================== */}
        <div className="flex items-center justify-between pt-4 border-t">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={!canSubmit || initiateMutation.isPending}
            className={cn(
              'flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-base font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {initiateMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Initiating...
              </>
            ) : (
              <>
                <ArrowRightLeft className="h-5 w-5" />
                Initiate Transfer
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
