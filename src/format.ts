/**
 * Same rule the original widget used: today shows a time, anything older shows
 * a date. Locale and zone are the reader's, which is right for a widget that
 * only ever shows a reader their own reports.
 *
 * Shared by the report row and the replies under it so a thread cannot end up
 * stamping its times differently from the report it hangs off.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
