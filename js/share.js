// Wordle-style share text: spoiler-light (terrain per stroke, not the route).

export function buildShareText({ number, par, strokes, trail, resultName, streak, pickedUp }) {
  const score = pickedUp ? `✗ ${strokes}/${par}` : `${strokes}/${par}`;
  const lines = [
    `Paper Golf #${number} — ${resultName}`,
    `⛳ ${score} · ${trail.join('')}`,
  ];
  if (streak >= 2) lines.push(`🔥 ${streak}-day streak`);
  lines.push('https://golf.huffsters.com'); // full URL so chat apps auto-link it
  return lines.join('\n');
}

const onMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Desktop: straight to the clipboard (no OS share dialog). Phones: the native
// share sheet — the natural path into a text — with clipboard as fallback.
// Returns 'shared' | 'copied' | 'aborted' | 'failed' for button feedback.
export async function share(text) {
  if (onMobile() && navigator.share && navigator.canShare?.({ text })) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'aborted';
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
