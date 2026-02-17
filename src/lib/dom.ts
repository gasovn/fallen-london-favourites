export function queryLast(parent: Element, selector: string): HTMLElement | null {
  const all = parent.querySelectorAll<HTMLElement>(selector);

  return all.length > 0 ? all[all.length - 1] : null;
}
