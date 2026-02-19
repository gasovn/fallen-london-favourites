import type { ClickProtection } from '@/types';
import { PROTECT_INTERVAL_MS } from './platform';

const CONFIRM_SELECTOR =
  '.storylet_avoid .button--go, .button_avoid, .card_avoid .hand__card, .card_avoid .button--margin';

export function protectAvoidClick(
  e: MouseEvent,
  clickProtection: ClickProtection,
  scheduleCleanup: (fn: () => void, ms: number) => void,
): void {
  if (clickProtection !== 'confirm') {
    return;
  }

  const target = e.target as HTMLElement;

  if (!target) {
    return;
  }

  const button = target.closest<HTMLElement>(CONFIRM_SELECTOR);

  if (!button) {
    return;
  }

  const now = Date.now();
  const lastTimestamp = parseInt(button.dataset.protectTimestamp ?? '0', 10);

  if (!button.dataset.protectTimestamp || now - lastTimestamp >= PROTECT_INTERVAL_MS) {
    e.stopImmediatePropagation();
    e.preventDefault();

    const confirmText = document.createElement('span');

    confirmText.className = 'protect-confirm';
    confirmText.textContent = 'SURE?';
    button.appendChild(confirmText);
    button.classList.add('button-protected');

    scheduleCleanup(() => {
      button.classList.remove('button-protected');
      confirmText.remove();
    }, PROTECT_INTERVAL_MS);

    button.dataset.protectTimestamp = String(now);
  }
}
