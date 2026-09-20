import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, FileImage, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOcrStatusQuery, useScanRegisterMutation } from '../../hooks/useOcr';
import { useToastStore } from '../../stores/toast-store';
import { RegisterParseTable } from '../../components/RegisterParseTable';

export function RegisterScanPage() {
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.addToast);
  const ocrStatus = useOcrStatusQuery();
  const scanMutation = useScanRegisterMutation();
  const [fileName, setFileName] = useState('');

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (ocrStatus.data && !ocrStatus.data.enabled) {
      toast({ type: 'error', message: 'OCR scanning is not configured. Set OPENAI_API_KEY to enable register scanning.' });
      return;
    }
    setFileName(file.name);
    scanMutation.mutate(file, {
      onError: (error: any) => {
        toast({ type: 'error', message: error?.response?.data?.error ?? 'Register scan failed' });
      },
    });
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold">Scan Register Page</h1>
          <p className="text-sm text-muted-foreground">Preview extracted sale-register rows. This does not create sales yet.</p>
        </div>
      </div>

      <section className="rounded-lg border bg-card p-5">
        {ocrStatus.data && !ocrStatus.data.enabled && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            OCR scanning is not configured yet. Add OPENAI_API_KEY and set OCR_PROVIDER=openai to enable parsing.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-5 text-sm font-medium hover:border-primary hover:text-primary">
            <Camera className="h-4 w-4" /> Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-5 text-sm font-medium hover:border-primary hover:text-primary">
            <FileImage className="h-4 w-4" /> Upload image or PDF
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>
        </div>
        {fileName && <p className="mt-3 text-xs text-muted-foreground">Selected: {fileName}</p>}
        {scanMutation.isPending && (
          <div className="mt-4 flex items-center gap-2 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading register page...
          </div>
        )}
        {scanMutation.isError && (
          <div className={cn('mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive')}>
            Could not parse this page. Try a clearer, well-lit photo.
          </div>
        )}
      </section>

      {scanMutation.data && <RegisterParseTable result={scanMutation.data} />}
    </div>
  );
}