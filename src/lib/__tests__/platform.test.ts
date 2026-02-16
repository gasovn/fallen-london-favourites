import { describe, it, expect, vi, afterEach } from 'vitest';
import { isMobile } from '../platform';

describe('isMobile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when userAgentData.mobile is true', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { mobile: true },
      userAgent: '',
    });
    expect(isMobile()).toBe(true);
  });

  it('returns false when userAgentData.mobile is false', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { mobile: false },
      userAgent: 'Android',
    });
    expect(isMobile()).toBe(false);
  });

  it('falls back to userAgent when userAgentData is undefined', () => {
    vi.stubGlobal('navigator', {
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0',
    });
    expect(isMobile()).toBe(true);
  });

  it('returns false for desktop userAgent without userAgentData', () => {
    vi.stubGlobal('navigator', {
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
    });
    expect(isMobile()).toBe(false);
  });
});
