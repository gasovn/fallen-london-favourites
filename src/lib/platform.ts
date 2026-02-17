declare global {
  interface NavigatorUAData {
    mobile: boolean;
  }
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

export const LONG_PRESS_MS = 500;

export function isMobile(): boolean {
  return navigator.userAgentData?.mobile ?? /Android|Mobile/i.test(navigator.userAgent);
}

export const MOVE_THRESHOLD = 10;

export function attachLongPressHandler(
  button: HTMLInputElement | HTMLButtonElement,
  onShortPress: () => void,
  onLongPress: () => void,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;
  let startX = 0;
  let startY = 0;

  button.addEventListener(
    'touchstart',
    ((e: TouchEvent) => {
      e.preventDefault();
      longPressed = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      timer = setTimeout(() => {
        longPressed = true;
        onLongPress();
      }, LONG_PRESS_MS);
    }) as EventListener,
    { passive: false },
  );

  button.addEventListener('touchmove', ((e: TouchEvent) => {
    if (!timer) {
      return;
    }

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
      clearTimeout(timer);
      timer = null;
    }
  }) as EventListener);

  button.addEventListener('touchend', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (!longPressed) {
      onShortPress();
    }

    longPressed = false;
  });

  button.addEventListener('touchcancel', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    longPressed = false;
  });
}
