/**
 * Paleta contrastada para que cada clase sea distinguible a simple vista.
 * Orden pensado para alternar tonos fríos/cálidos.
 */
export const CLASS_COLOR_PALETTE = [
  '#e11d48',
  '#059669',
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#0d9488',
  '#ca8a04',
  '#db2777',
  '#4f46e5',
  '#16a34a',
  '#ea580c',
  '#0891b2',
  '#9333ea',
  '#b45309',
  '#be123c',
  '#15803d',
] as const

export function normalizeHex(hex: string): string {
  const h = hex.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  if (/^#[0-9a-f]{6}$/.test(h)) return h
  return h
}

/** Elige el primer color de la paleta que no esté ya usado (comparación normalizada). */
export function pickDistinctColor(existingHexes: string[]): string {
  const used = new Set(existingHexes.map((x) => normalizeHex(x)))
  for (const c of CLASS_COLOR_PALETTE) {
    if (!used.has(c)) return c
  }
  // Muchas clases: rotar la paleta para seguir diferenciando
  return CLASS_COLOR_PALETTE[existingHexes.length % CLASS_COLOR_PALETTE.length]
}

/** Color de trazo/relleno para una anotación: clase conocida o fallback por id. */
export function colorForLabelClass(
  classId: number,
  classes: { id: number; color_hex: string }[],
): string {
  const c = classes.find((x) => x.id === classId)
  const raw = c?.color_hex?.trim()
  if (raw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    return normalizeHex(raw)
  }
  const i = Math.abs(classId) % CLASS_COLOR_PALETTE.length
  return CLASS_COLOR_PALETTE[i]
}
