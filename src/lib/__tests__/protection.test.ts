// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { protectAvoidClick } from '../protection';
import { PROTECT_INTERVAL_MS } from '../platform';

function fireClick(target: HTMLElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'target', { value: target });
  vi.spyOn(event, 'stopImmediatePropagation');
  vi.spyOn(event, 'preventDefault');

  return event;
}

describe('protectAvoidClick', () => {
  let scheduleCleanup: ReturnType<typeof vi.fn<(fn: () => void, ms: number) => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    scheduleCleanup = vi.fn<(fn: () => void, ms: number) => void>();
  });

  describe('non-confirm modes', () => {
    it('does nothing when click_protection is "off"', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'off', scheduleCleanup);

      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('does nothing when click_protection is "shift"', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'shift', scheduleCleanup);

      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('confirm mode — storylet avoid', () => {
    it('intercepts first click on avoided storylet go button', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(target.querySelector('.protect-confirm')?.textContent).toBe('SURE?');
      expect(target.classList.contains('button-protected')).toBe(true);
      expect(target.dataset.protectTimestamp).toBeDefined();
    });

    it('lets second click through within interval', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;

      const first = fireClick(target);

      protectAvoidClick(first, 'confirm', scheduleCleanup);

      const second = fireClick(target);

      protectAvoidClick(second, 'confirm', scheduleCleanup);

      expect(second.stopImmediatePropagation).not.toHaveBeenCalled();
      expect(second.preventDefault).not.toHaveBeenCalled();
    });

    it('intercepts again after interval expires', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;

      const first = fireClick(target);

      protectAvoidClick(first, 'confirm', scheduleCleanup);

      // Simulate time passing beyond the interval
      const pastTimestamp = Date.now() - PROTECT_INTERVAL_MS - 1;

      target.dataset.protectTimestamp = String(pastTimestamp);

      const second = fireClick(target);

      protectAvoidClick(second, 'confirm', scheduleCleanup);

      expect(second.stopImmediatePropagation).toHaveBeenCalled();
      expect(second.preventDefault).toHaveBeenCalled();
    });
  });

  describe('confirm mode — card avoid', () => {
    it('intercepts click on avoided card hand', () => {
      document.body.innerHTML = '<div class="card_avoid"><div class="hand__card">Card</div></div>';

      const target = document.querySelector<HTMLElement>('.hand__card')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('intercepts click on avoided card margin button', () => {
      document.body.innerHTML =
        '<div class="card_avoid"><button class="button--margin">Play</button></div>';

      const target = document.querySelector<HTMLElement>('.button--margin')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('intercepts click on button_avoid element', () => {
      document.body.innerHTML = '<button class="button_avoid">Discard</button>';

      const target = document.querySelector<HTMLElement>('.button_avoid')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).toHaveBeenCalled();
    });
  });

  describe('non-matching targets', () => {
    it('ignores click on non-avoided storylet', () => {
      document.body.innerHTML =
        '<div class="storylet_favourite"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });

    it('ignores click on non-avoided card', () => {
      document.body.innerHTML = '<div class="card_fave"><div class="hand__card">Card</div></div>';

      const target = document.querySelector<HTMLElement>('.hand__card')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });
  });

  describe('cleanup scheduling', () => {
    it('schedules cleanup with PROTECT_INTERVAL_MS', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), PROTECT_INTERVAL_MS);
    });

    it('cleanup removes button-protected class and SURE? text', () => {
      document.body.innerHTML =
        '<div class="storylet_avoid"><button class="button--go">Go</button></div>';

      const target = document.querySelector<HTMLElement>('.button--go')!;
      const event = fireClick(target);

      protectAvoidClick(event, 'confirm', scheduleCleanup);

      expect(target.classList.contains('button-protected')).toBe(true);
      expect(target.querySelector('.protect-confirm')).not.toBeNull();

      // Execute the scheduled cleanup
      const cleanupFn = scheduleCleanup.mock.calls[0][0];

      cleanupFn();

      expect(target.classList.contains('button-protected')).toBe(false);
      expect(target.querySelector('.protect-confirm')).toBeNull();
    });
  });
});
