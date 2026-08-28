export async function captureTransparentPng({
  scene,
  renderer,
  grid,
  axes,
  controls,
  camera,
  canvas,
}) {
  const oldBackground = scene.background;
  const oldClearAlpha = renderer.getClearAlpha();
  const oldGridVisible = grid.visible;
  const oldAxesVisible = axes.visible;
  try {
    // Export only the rendered asset. Grid/axes are viewport helpers, and a
    // null scene background plus a zero clear alpha preserves transparency.
    scene.background = null;
    renderer.setClearAlpha(0);
    grid.visible = false;
    axes.visible = false;
    controls.update();
    renderer.render(scene, camera);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('Unable to encode PNG')),
        'image/png',
      );
    });
  } finally {
    scene.background = oldBackground;
    renderer.setClearAlpha(oldClearAlpha);
    grid.visible = oldGridVisible;
    axes.visible = oldAxesVisible;
    renderer.render(scene, camera);
  }
}
