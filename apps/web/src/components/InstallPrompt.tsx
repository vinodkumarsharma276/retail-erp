import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISSED_KEY = 'retailerp:pwa-install-dismissed-at';
const DISMISS_DAYS = 7;

function isDismissedRecently() {
  const value = localStorage.getItem(DISMISSED_KEY);
  if (!value) return false;
  const dismissedAt = Number(value);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const isIos = useMemo(() => /iphone|ipad|ipod/i.test(window.navigator.userAgent), []);

  useEffect(() => {
    setDismissed(isDismissedRecently() || isStandalone());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;
  if (!installEvent && !isIos) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    dismiss();
  };

  return (
    <div className="border-b bg-primary/10 px-3 py-2 text-sm text-foreground sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            {isIos
              ? 'Install RetailERP: tap Share, then Add to Home Screen.'
              : 'Install RetailERP for faster access and app-like browsing.'}
          </p>
        </div>
        <div className="flex gap-2 self-end sm:self-auto">
          {installEvent && <Button size="sm" onClick={install}>Install</Button>}
          <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Dismiss install prompt">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}