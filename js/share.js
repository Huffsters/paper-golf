// Wordle-style share text: spoiler-light (terrain per stroke, not the route).

export function buildShareText({ number, par, strokes, trail, resultName, streak, pickedUp }) {
  const score = pickedUp ? `✗ ${strokes}/${par}` : `${strokes}/${par}`;
  const lines = [
    `Paper Golf #${number} — ${resultName}`,
    `⛳ ${score} · ${trail.join('')}`,
  ];
  if (streak >= 2) lines.push(`🔥 ${streak}-day streak`);
  lines.push('golf.huffsters.com');
  return lines.join('\n');
}

// Native share sheet where available (mobile), clipboard otherwise.
// Returns 'shared' | 'copied' | 'failed' so the button can give feedback.
export async function share(text) {
  if (navigator.share && navigator.canShare?.({ text })) {
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
