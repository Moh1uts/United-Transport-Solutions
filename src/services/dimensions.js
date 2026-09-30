// src/services/dimensions.js
//
// "Smart dimensions": when a client lists several boxes for the same
// quote, boxes that share the exact same L x l x H get collapsed into one
// line shown as "x2", "x3", etc. instead of repeating the same dimensions
// over and over. Used anywhere multi-box dimensions are displayed
// (dashboard client detail, list views, reports).
//
// A box can carry its own `count` (the website's "x" quantity field, next
// to each package row, so a client with 3 identical boxes fills in one row
// and sets count=3 instead of pasting the same dimensions three times).
// Several boxes can still share the exact same size as separate entries too
// (e.g. one imported from an older quote, one freshly added) - their counts
// are summed together into the same group either way.

/**
 * @param {Array<{longueur:number, largeur:number, hauteur:number, count?:number}>} boxes
 * @returns {Array<{longueur:number, largeur:number, hauteur:number, count:number}>}
 *   One entry per distinct box size, in first-seen order, with `count` set
 *   to the total number of boxes of that exact size (summed across every
 *   matching entry's own count, each defaulting to 1 if unset).
 */
function groupDimensions(boxes) {
  if (!Array.isArray(boxes)) return [];
  const order = [];
  const byKey = new Map();
  for (const box of boxes) {
    if (!box || !box.longueur || !box.largeur || !box.hauteur) continue;
    const key = `${box.longueur}x${box.largeur}x${box.hauteur}`;
    const n = Number.isFinite(box.count) && box.count > 0 ? Math.round(box.count) : 1;
    if (!byKey.has(key)) {
      const entry = { longueur: box.longueur, largeur: box.largeur, hauteur: box.hauteur, count: 0 };
      byKey.set(key, entry);
      order.push(entry);
    }
    byKey.get(key).count += n;
  }
  return order;
}

/** One human-readable line per distinct box size, e.g. "40 x 30 x 20 cm x3". */
function formatDimensionGroups(boxes) {
  return groupDimensions(boxes).map(
    (g) => `${g.longueur} x ${g.largeur} x ${g.hauteur} cm${g.count > 1 ? ` x${g.count}` : ''}`
  );
}

module.exports = { groupDimensions, formatDimensionGroups };
