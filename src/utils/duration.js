/**
 * Parses a human duration string ("15m", "30d", "12h", "45s", "500ms") into
 * milliseconds. Used to keep JWT expiry config and DB session expiry in sync.
 */
const UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(input) {
  if (typeof input === 'number') return input;
  const match = /^(\d+)\s*(ms|s|m|h|d|w)$/.exec(String(input).trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

export default parseDurationToMs;
