/** Screen-space distance before an Alt gesture chooses a facing. */
export const ROTATION_DRAG_PIXELS = 12;

/**
 * Choose the cardinal edge/facing pointed to by an Alt drag on the build plane.
 * Rotation order is North, West, South, East, matching building geometry.
 */
export function placementRotation(
  startRotation: number,
  worldX: number,
  worldZ: number,
  screenDistance: number,
): number {
  if (screenDistance < ROTATION_DRAG_PIXELS) return startRotation;
  if (Math.abs(worldX) > Math.abs(worldZ)) return worldX < 0 ? 1 : 3;
  return worldZ < 0 ? 0 : 2;
}
