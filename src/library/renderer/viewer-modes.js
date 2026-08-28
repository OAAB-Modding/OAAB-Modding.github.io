export function isEditorMarkerName(name) {
  return String(name || '').toLowerCase().includes('editormarker');
}

export function cameraDirectionForView(view = 'default') {
  return view === 'front' ? [0, 0, 1] : [1, 0.72, 1];
}

export function thumbnailViewForRecord(record = {}) {
  const raw = record.raw || record;
  return String(raw?.data?.part || raw?.part || '').toLowerCase() === 'head'
    ? 'front'
    : '';
}

export function isViewerObjectVisible(userData = {}, {
  markersVisible = true,
  collisionVisible = false,
} = {}) {
  return !userData.hidden
    && (!userData.marker || markersVisible)
    && (!userData.collision || collisionVisible);
}
