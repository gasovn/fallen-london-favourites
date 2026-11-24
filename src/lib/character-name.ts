/**
 * The character's display name, from the player's own `/profile/<Name>` link in
 * the accessible sidebar. Links inside #main can point at other players.
 * Display-only: profiles are keyed by CharacterId.
 */
export function readCharacterName(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const link = document.querySelector<HTMLAnchorElement>(
    '#accessible-sidebar a[href^="/profile/"]',
  );
  const href = link?.getAttribute('href');

  if (!href) {
    return null;
  }

  const encoded = href.slice('/profile/'.length).split(/[/?#]/)[0];

  if (!encoded) {
    return null;
  }

  try {
    const name = decodeURIComponent(encoded).trim();

    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
