export const THUMBNAIL_ORIENTATION_RENDER_SIZE = 128;
export const THUMBNAIL_FLIP_COVERAGE_RATIO = 1.75;
export const THUMBNAIL_FLIP_COVERAGE_DELTA = 0.08;

export function isEditorMarkerName(name) {
  return String(name || '').toLowerCase().includes('editormarker');
}

export function cameraDirectionForView(view = 'default') {
  return view === 'front' ? [0, 0, 1] : [1, 0.72, 1];
}

export function cameraDistanceScaleForView(view = 'default') {
  return view === 'front' ? 0.9 : 1;
}

export function cameraFrameMarginForView(view = 'default') {
  return view === 'front' ? 1.25 : 1;
}

export function thumbnailViewForRecord(record = {}) {
  const raw = record.raw || record;
  return String(raw?.data?.part || raw?.part || '').toLowerCase() === 'head'
    ? 'front'
    : '';
}

export function thumbnailOrientationFromCoverage(currentCoverage, flippedCoverage) {
  const current = normalizedCoverage(currentCoverage);
  const flipped = normalizedCoverage(flippedCoverage);
  const ratio = current > 0
    ? flipped / current
    : (flipped > 0 ? Number.POSITIVE_INFINITY : 1);
  const thumbnailFlip180 = flipped >= current * THUMBNAIL_FLIP_COVERAGE_RATIO
    && flipped - current >= THUMBNAIL_FLIP_COVERAGE_DELTA;

  return {
    currentCoverage: current,
    flippedCoverage: flipped,
    coverageRatio: ratio,
    thumbnailFlip180,
    thumbnailRotationY: thumbnailFlip180 ? 180 : 0,
  };
}

export function isViewerObjectVisible(userData = {}, {
  markersVisible = true,
  collisionVisible = false,
} = {}) {
  return !userData.hidden
    && (!userData.marker || markersVisible)
    && (!userData.collision || collisionVisible);
}

function normalizedCoverage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
