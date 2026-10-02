export const MAIN_WINDOW_SIZE = { width: 1440, height: 900 };
export const MAIN_WINDOW_MINIMUM = { width: 720, height: 520 };

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))
    && bounds.width > 0 && bounds.height > 0;
}

export function minimumWindowSize(workArea) {
  return {
    minWidth: Math.min(MAIN_WINDOW_MINIMUM.width, workArea.width),
    minHeight: Math.min(MAIN_WINDOW_MINIMUM.height, workArea.height)
  };
}

// Use the display with the most overlap, or the closest display when a saved
// monitor has been disconnected. Coordinates may legitimately be negative.
export function restoreWindowState(saved, displays, primaryDisplay) {
  const areas = displays.map((display) => display.workArea);
  const fallback = primaryDisplay.workArea;
  const bounds = validBounds(saved?.bounds) ? saved.bounds : null;
  let workArea = fallback;
  if (bounds && areas.length) {
    const overlap = (area) => Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x))
      * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    const distance = (area) => Math.hypot(bounds.x + bounds.width / 2 - (area.x + area.width / 2), bounds.y + bounds.height / 2 - (area.y + area.height / 2));
    workArea = [...areas].sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b))[0];
  }
  const minimum = minimumWindowSize(workArea);
  const width = Math.round(Math.min(workArea.width, Math.max(minimum.minWidth, bounds?.width || MAIN_WINDOW_SIZE.width)));
  const height = Math.round(Math.min(workArea.height, Math.max(minimum.minHeight, bounds?.height || MAIN_WINDOW_SIZE.height)));
  const x = bounds?.x ?? workArea.x + (workArea.width - width) / 2;
  const y = bounds?.y ?? workArea.y + (workArea.height - height) / 2;
  return {
    bounds: {
      x: Math.round(Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))),
      y: Math.round(Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))),
      width, height
    },
    ...minimum,
    maximized: Boolean(bounds && saved.maximized === true)
  };
}

export function trayWindowBounds(anchor, workArea) {
  const margin = Math.min(8, workArea.width / 4, workArea.height / 4);
  const width = Math.max(1, Math.floor(Math.min(420, workArea.width - margin * 2)));
  const height = Math.max(1, Math.floor(Math.min(640, workArea.height - margin * 2)));
  const below = Math.round(anchor.y + anchor.height + 6);
  const preferredY = below + height <= workArea.y + workArea.height - margin ? below : anchor.y - height - 6;
  return {
    x: Math.round(Math.max(workArea.x + margin, Math.min(anchor.x + anchor.width / 2 - width / 2, workArea.x + workArea.width - width - margin))),
    y: Math.round(Math.max(workArea.y + margin, Math.min(preferredY, workArea.y + workArea.height - height - margin))),
    width, height
  };
}
