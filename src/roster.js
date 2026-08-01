export function parseRosterText(value) {
  const lines = String(value ?? "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const numbered = lines
    .map(parseNumberedLine)
    .filter(Boolean);

  if (numbered.length > 0) return numbered;

  if (lines.length === 1) {
    return lines[0]
      .split(/[，,；;|\t]+/)
      .map(cleanRosterName)
      .filter(Boolean);
  }

  return lines
    .map((line) => cleanRosterName(line.replace(/^[-•·]\s*/, "")))
    .filter(Boolean);
}

function parseNumberedLine(line) {
  const match = line.match(
    /^\s*(?:\d{1,3}\s*(?:[、.．,，:：)）-]|\s)\s*|[（(]\d{1,3}[)）]\s*)(.+?)\s*$/,
  );
  return match ? cleanRosterName(match[1]) : "";
}

function cleanRosterName(value) {
  return value.trim().replace(/[，,；;]+$/, "").trim();
}
