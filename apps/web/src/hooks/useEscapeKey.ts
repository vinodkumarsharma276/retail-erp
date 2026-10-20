import { useEffect, useRef } from 'react';

/**
 * Escape closes whatever is on top.
 *
 * Every layer that sits over the page — a dialog, a drawer, a dropdown, a
 * suggestion list — hands its close function to this one stack while it is
 * open. A single keydown listener then closes the topmost layer only, so a
 * dropdown opened inside a dialog closes by itself and leaves the dialog
 * standing.
 *
 * Before this, each overlay had to remember to listen for Escape on its own.
 * Most of them never did, so Escape did nothing across most of the app; the
 * few that did listen all fired at once when they were stacked.
 */
type CloseRef = { current: () => void };

const stack: CloseRef[] = [];

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;

  const top = stack[stack.length - 1];
  if (!top) return;

  // Keep the browser and any outer handler out of it: this keypress has been
  // spent on closing the top layer.
  event.preventDefault();
  event.stopPropagation();
  top.current();
}

/**
 * Close this layer when Escape is pressed, as long as nothing is layered over
 * it. `isOpen` false means the layer is not on screen and is not registered.
 */
export function useEscapeKey(isOpen: boolean, onEscape: () => void) {
  // The close function lives in a ref so that a re-render with a fresh closure
  // does not re-register the layer and steal the top spot from a layer that
  // opened above it.
  const close = useRef(onEscape);
  useEffect(() => {
    close.current = onEscape;
  });

  useEffect(() => {
    if (!isOpen) return;

    stack.push(close);
    if (stack.length === 1) document.addEventListener('keydown', handleKeyDown);

    return () => {
      const at = stack.lastIndexOf(close);
      if (at !== -1) stack.splice(at, 1);
      if (stack.length === 0) document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);
}

/**
 * Whether anything is layered over the page. A screen's own single-key
 * shortcuts check this so they stay quiet while a dialog has the user's
 * attention.
 */
export function isOverlayOpen() {
  return stack.length > 0;
}
