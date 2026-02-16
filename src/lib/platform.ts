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

export function attachLongPressHandler(
  button: HTMLInputElement | HTMLButtonElement,
  onShortPress: () => void,
  onLongPress: () => void,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  button.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      longPressed = false;
      timer = setTimeout(() => {
        longPressed = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    { passive: false },
  );

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
