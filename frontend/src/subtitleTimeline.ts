function seconds(value: string): number {
  return value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
function timestamp(value: number): string {
  const millis = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(millis / 3600000)).padStart(2, '0')}:${String(Math.floor(millis / 60000) % 60).padStart(2, '0')}:${String(Math.floor(millis / 1000) % 60).padStart(2, '0')}.${String(millis % 1000).padStart(3, '0')}`;
}

// Subtitle files use the original movie timeline; rebuilt streams start at zero.
// Drop expired cues and clamp overlapping cues, preserving IDs and cue settings.
export function toWebVtt(raw: string, extension: string, delay = 0, offset = 0): string {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (extension.toLowerCase() === '.srt') text = text.replace(/(\d+:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  if (!/^\s*WEBVTT(?:\s|$)/i.test(text)) text = `WEBVTT\n\n${text}`;
  const time = '((?:\\d+:)?\\d{2}:\\d{2}[.,]\\d{3})';
  const timing = new RegExp(`^${time}\\s+-->\\s+${time}(.*)$`);
  return text.split(/\n\s*\n/).flatMap(block => {
    if (/^\s*(?:WEBVTT\b|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) return [block];
    const lines = block.split('\n');
    const index = lines.findIndex(line => timing.test(line));
    if (index < 0) return [block];
    const match = lines[index].match(timing)!;
    const start = seconds(match[1]) + delay - offset;
    const end = seconds(match[2]) + delay - offset;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= Math.max(0, start)) return [];
    lines[index] = `${timestamp(start)} --> ${timestamp(end)}${match[3]}`;
    return [lines.join('\n')];
  }).join('\n\n');
}
