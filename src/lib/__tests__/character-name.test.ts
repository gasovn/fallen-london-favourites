// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { readCharacterName } from '../character-name';

// Markup as rendered by the live Story page: the player's own profile link sits
// in the accessible sidebar, outside #main.
function page(own: string | null, inMain = ''): void {
  const welcome = own
    ? `<h1 class="welcome"><span>Welcome, <a href="/profile/${own}">x</a></span></h1>`
    : '';

  document.body.innerHTML = `<div id="root">
    <div id="accessible-sidebar" class="accessible-sidebar u-visually-hidden">${welcome}</div>
    <div id="main">${inMain}</div>
  </div>`;
}

describe('readCharacterName', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the name from the sidebar profile link', () => {
    page('Jane');

    expect(readCharacterName()).toBe('Jane');
  });

  it('decodes an encoded name', () => {
    page('Lady%20Mary');

    expect(readCharacterName()).toBe('Lady Mary');
  });

  it("ignores another player's profile link inside #main", () => {
    page('Jane', '<a href="/profile/Stranger">Stranger</a>');

    expect(readCharacterName()).toBe('Jane');
  });

  it('returns null when only a foreign profile link is present', () => {
    page(null, '<a href="/profile/Stranger">Stranger</a>');

    expect(readCharacterName()).toBeNull();
  });

  it('returns null for a malformed encoding', () => {
    page('%E0%A4%A');

    expect(readCharacterName()).toBeNull();
  });
});
