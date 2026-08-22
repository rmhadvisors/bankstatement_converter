// Rebuilds visual text lines directly from OCR word bounding boxes, instead of trusting the OCR
// engine's own line grouping. OCR.space's "isTable" reflow mode can order a scanned table's words
// column-major instead of row-major on a noisy/skewed scan (documented misbehavior already noted
// elsewhere in this codebase), which silently scrambles reading order before a single line of
// parsing code ever runs. Reconstructing lines ourselves -- sort every word by Y, then by X
// within the same visual row -- reproduces the page's natural reading order regardless of what
// order the OCR engine emitted words in.

// Two words are considered to be on the same visual row if their vertical centers are within
// this many pixels of each other. Derived from typical word heights in a 300dpi scan of a
// standard statement table; a fixed tolerance is simpler and safer than trying to infer it from
// font size, which OCR word boxes don't reliably expose.
const ROW_BAND_PX = 8;

// words: [{ x, y, text }], x/y in the OCR engine's pixel coordinate space (y increasing downward,
// as image coordinates do -- unlike PDF space, which increases upward).
function reconstructLinesFromWords(words) {
  const usable = words.filter((word) => Number.isFinite(word.x) && Number.isFinite(word.y) && word.text);
  if (usable.length === 0) return [];

  const sortedByY = [...usable].sort((a, b) => a.y - b.y);

  const rows = [];
  for (const word of sortedByY) {
    let row = rows.find((entry) => Math.abs(entry.y - word.y) <= ROW_BAND_PX);
    if (!row) {
      row = { y: word.y, words: [] };
      rows.push(row);
    }
    row.words.push(word);
    // Recenter the row's Y as more words join it, so a row's band tracks its true average
    // position rather than staying pinned to whichever word happened to start it.
    row.y = (row.y * (row.words.length - 1) + word.y) / row.words.length;
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => {
      // Preserve any extra fields the caller attached to a word (e.g. an "OCR correction was
      // applied" flag) onto its item in the reconstructed line, rather than just x/text.
      const items = [...row.words].sort((a, b) => a.x - b.x);
      return {
        y: row.y,
        text: items.map((item) => item.text).join(" "),
        items,
      };
    })
    .filter((line) => line.text);
}

export { reconstructLinesFromWords };
