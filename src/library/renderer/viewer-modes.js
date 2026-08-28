export function isEditorMarkerName(name) {
  return String(name || '').toLowerCase().includes('editormarker');
}

export function isViewerObjectVisible(userData = {}, {
  markersVisible = true,
  collisionVisible = false,
} = {}) {
  return !userData.hidden
    && (!userData.marker || markersVisible)
    && (!userData.collision || collisionVisible);
}
