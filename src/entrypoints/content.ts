import type { FaveData } from '@/types';
import { getOptions, unpackSet } from '@/lib/storage';
import { parseStorylets, fillClickHandlers, shiftHandler } from '@/lib/storylets';
import { parseCards } from '@/lib/cards';
import { isMobile, LONG_PRESS_MS } from '@/lib/platform';
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
        block_action: false,
        protectInterval: 5000,
      },
    };

    let wrapObserver: MutationObserver | null = null;
    let mainObserver: MutationObserver | null = null;

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
          block_action: data.block_action === true,
          protectInterval: 5000,
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

      fillClickHandlers();
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

      mainObserver = new MutationObserver(() => {
        scheduleParse();
      });

      mainObserver.observe(mainEl, MAIN_OBSERVER_CONFIG);

      doParse(true);
    }

    async function startWrapObserver(): Promise<void> {
      const root = document.getElementById('root') ?? document.body;

      // Track whether #main exists to only react when it appears/disappears,
      // not on every childList change (our toggle buttons, reorder markers, etc.)
      let mainPresent = !!document.getElementById('main');

      wrapObserver = new MutationObserver(async () => {
        const mainEl = document.getElementById('main');
        const nowPresent = !!mainEl;

        if (nowPresent && !mainPresent) {
          // #main just appeared — initialize
          mainPresent = true;
          await loadData();
          startMainObserver(mainEl!);
        } else if (!nowPresent && mainPresent) {
          // #main removed — clean up
          mainPresent = false;

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
      if (mainPresent) {
        await loadData();
        startMainObserver(document.getElementById('main')!);
      }
    }

    function protectAvoids(e: MouseEvent): void {
      if (e.metaKey || e.ctrlKey) {
        return;
      }

      const target = e.target as HTMLElement;

      if (!target) {
        return;
      }

      const isAvoidedBranch = target.matches('.storylet_avoid .button--go span, .button_avoid');

      if (!isAvoidedBranch) {
        return;
      }

      const now = Date.now();
      const lastTimestamp = parseInt(target.dataset.protectTimestamp ?? '0', 10);

      if (
        !target.dataset.protectTimestamp ||
        now - lastTimestamp >= faveData.options.protectInterval
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();

        const confirmText = document.createElement('span');

        confirmText.className = 'protect-confirm';
        confirmText.textContent = 'SURE?';
        target.appendChild(confirmText);
        target.classList.add('button-protected');

        ctx.setTimeout(() => {
          target.classList.remove('button-protected');
          confirmText.remove();
        }, faveData.options.protectInterval);

        target.dataset.protectTimestamp = String(now);
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
      console.log(`Playing Favourites ${version} content script invalidated`);

      if (wrapObserver) {
        wrapObserver.disconnect();
      }

      if (mainObserver) {
        mainObserver.disconnect();
      }

      browser.storage.onChanged.removeListener(onStorageChange);
    });

    console.log(`Playing Favourites ${version} injected`);

    browser.storage.onChanged.addListener(onStorageChange);

    ctx.addEventListener(window, 'keydown', shiftHandler);
    ctx.addEventListener(window, 'keypress', shiftHandler);
    ctx.addEventListener(window, 'keyup', shiftHandler);

    ctx.addEventListener(document, 'click', protectAvoids, { capture: true });

    if (isMobile()) {
      let timer: ReturnType<typeof setTimeout> | null = null;

      ctx.addEventListener(
        document,
        'touchstart',
        ((e: TouchEvent) => {
          const target = e.target as HTMLElement;

          if (!target?.closest('.pf-disabled')) {
            return;
          }

          timer = setTimeout(() => {
            const disabled = target.closest('.pf-disabled') as HTMLElement;

            if (disabled) {
              disabled.style.pointerEvents = 'auto';
              disabled.click();
              setTimeout(() => {
                disabled.style.pointerEvents = '';
              }, faveData.options.protectInterval);
            }
          }, LONG_PRESS_MS);
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
