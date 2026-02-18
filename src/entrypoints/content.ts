import { type FaveData, CLICK_PROTECTIONS } from '@/types';
import { getOptions, unpackSet } from '@/lib/storage';
import { parseStorylets, shiftHandler } from '@/lib/storylets';
import { parseCards } from '@/lib/cards';
import { isMobile, LONG_PRESS_MS, MOVE_THRESHOLD, PROTECT_INTERVAL_MS } from '@/lib/platform';
import '@/styles/content.css';

export default defineContentScript({
  matches: ['*://*.fallenlondon.com/*'],
  runAt: 'document_end',

  main(ctx) {
    const version = browser.runtime.getManifest().version;

    let faveData: FaveData = {
      branch_faves: new Set(),
      branch_avoids: new Set(),
      storylet_faves: new Set(),
      storylet_avoids: new Set(),
      card_faves: new Set(),
      card_avoids: new Set(),
      options: {
        branch_reorder_mode: 'branch_reorder_active',
        switch_mode: 'click_through',
        click_protection: 'off',
      },
    };

    let wrapObserver: MutationObserver | null = null;
    let mainObserver: MutationObserver | null = null;
    // Element identity, not just presence — React can replace #main
    // in a single mutation batch, which a boolean flag would miss.
    let observedMain: Element | null = null;

    // Debounce flag to coalesce rapid MutationObserver callbacks
    let parseScheduled = false;

    // Observer config — needs childList for detecting new storylets/branches
    // added by React, plus attribute changes for data-branch-id etc.
    const MAIN_OBSERVER_CONFIG: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-branch-id', 'data-event-id', 'disabled'],
    };

    async function loadData(): Promise<void> {
      const data = await getOptions();

      faveData = {
        branch_faves: unpackSet(data, 'branch_faves'),
        branch_avoids: unpackSet(data, 'branch_avoids'),
        storylet_faves: unpackSet(data, 'storylet_faves'),
        storylet_avoids: unpackSet(data, 'storylet_avoids'),
        card_faves: unpackSet(data, 'card_faves'),
        card_avoids: unpackSet(data, 'card_avoids'),
        options: {
          branch_reorder_mode:
            (data.branch_reorder_mode as FaveData['options']['branch_reorder_mode']) ??
            'branch_reorder_active',
          switch_mode: (data.switch_mode as FaveData['options']['switch_mode']) ?? 'click_through',
          click_protection:
            typeof data.click_protection === 'string' &&
            CLICK_PROTECTIONS.includes(
              data.click_protection as FaveData['options']['click_protection'],
            )
              ? (data.click_protection as FaveData['options']['click_protection'])
              : 'off',
        },
      };
    }

    // Pause/resume observers around our own DOM modifications to avoid
    // infinite re-parse loops. The original code used MutationSummary which
    // filtered out irrelevant childList changes; raw MutationObserver doesn't.
    function doParse(reorder: boolean): void {
      if (mainObserver) {
        mainObserver.disconnect();
      }

      parseStorylets(faveData, reorder);
      parseCards(faveData);

      const mainEl = document.getElementById('main');

      if (mainEl && mainObserver) {
        mainObserver.observe(mainEl, MAIN_OBSERVER_CONFIG);
      }
    }

    function scheduleParse(): void {
      if (parseScheduled) {
        return;
      }

      parseScheduled = true;
      requestAnimationFrame(() => {
        parseScheduled = false;

        if (ctx.isInvalid) {
          return;
        }

        doParse(true);
      });
    }

    function startMainObserver(mainEl: Element): void {
      if (mainObserver) {
        mainObserver.disconnect();
      }

      observedMain = mainEl;

      mainObserver = new MutationObserver(() => {
        scheduleParse();
      });

      mainObserver.observe(mainEl, MAIN_OBSERVER_CONFIG);

      doParse(true);
    }

    async function startWrapObserver(): Promise<void> {
      const root = document.getElementById('root') ?? document.body;

      wrapObserver = new MutationObserver(async () => {
        const mainEl = document.getElementById('main');

        if (mainEl && mainEl !== observedMain) {
          // #main appeared or was replaced by React — (re)initialize
          await loadData();
          startMainObserver(mainEl);
        } else if (!mainEl && observedMain) {
          // #main removed — clean up
          observedMain = null;

          if (mainObserver) {
            mainObserver.disconnect();
          }
        }
      });

      wrapObserver.observe(root, {
        childList: true,
        subtree: true,
      });

      // Handle re-inject after extension update
      const mainEl = document.getElementById('main');

      if (mainEl) {
        await loadData();
        startMainObserver(mainEl);
      }
    }

    function protectAvoids(e: MouseEvent): void {
      if (faveData.options.click_protection !== 'confirm') {
        return;
      }

      const target = e.target as HTMLElement;

      if (!target) {
        return;
      }

      const button = target.closest<HTMLElement>(
        '.storylet_avoid .button--go, .button_avoid, .card_avoid .hand__card, .card_avoid .button--margin',
      );

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

        ctx.setTimeout(() => {
          button.classList.remove('button-protected');
          confirmText.remove();
        }, PROTECT_INTERVAL_MS);

        button.dataset.protectTimestamp = String(now);
      }
    }

    async function onStorageChange(
      _changes: Record<string, Browser.storage.StorageChange>,
      area: string,
    ): Promise<void> {
      if (area === 'local') {
        await loadData();
        doParse(false);
      }
    }

    ctx.onInvalidated(() => {
      console.log(`Fallen London Favourites ${version} content script invalidated`);

      if (wrapObserver) {
        wrapObserver.disconnect();
      }

      if (mainObserver) {
        mainObserver.disconnect();
      }

      browser.storage.onChanged.removeListener(onStorageChange);
    });

    console.log(`Fallen London Favourites ${version} injected`);

    browser.storage.onChanged.addListener(onStorageChange);

    ctx.addEventListener(window, 'keydown', shiftHandler);
    ctx.addEventListener(window, 'keypress', shiftHandler);
    ctx.addEventListener(window, 'keyup', shiftHandler);

    ctx.addEventListener(document, 'click', protectAvoids, { capture: true });

    if (isMobile()) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let startX = 0;
      let startY = 0;

      ctx.addEventListener(
        document,
        'touchstart',
        ((e: TouchEvent) => {
          const touch = e.touches[0];

          if (!touch) {
            return;
          }

          startX = touch.clientX;
          startY = touch.clientY;

          // pointer-events: none means the touch target is behind the button,
          // so we find .pf-disabled elements by hit-testing their bounding rects
          let disabled: HTMLElement | null = null;

          for (const el of document.querySelectorAll<HTMLElement>('#main .pf-disabled')) {
            const rect = el.getBoundingClientRect();

            if (
              touch.clientX >= rect.left &&
              touch.clientX <= rect.right &&
              touch.clientY >= rect.top &&
              touch.clientY <= rect.bottom
            ) {
              disabled = el;
              break;
            }
          }

          if (!disabled) {
            return;
          }

          timer = setTimeout(() => {
            disabled.style.pointerEvents = 'auto';
            disabled.click();
            setTimeout(() => {
              disabled.style.pointerEvents = '';
            }, PROTECT_INTERVAL_MS);
          }, LONG_PRESS_MS);
        }) as EventListener,
        { passive: true },
      );

      ctx.addEventListener(
        document,
        'touchmove',
        ((e: TouchEvent) => {
          if (!timer) {
            return;
          }

          const touch = e.touches[0];

          if (!touch) {
            return;
          }

          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;

          if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
            clearTimeout(timer);
            timer = null;
          }
        }) as EventListener,
        { passive: true },
      );

      ctx.addEventListener(document, 'touchend', () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      });

      ctx.addEventListener(document, 'touchcancel', () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      });
    }

    startWrapObserver();
  },
});
