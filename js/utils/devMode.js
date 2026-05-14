export function isDevMode() {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('dev=1');
}
