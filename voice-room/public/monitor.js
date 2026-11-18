export function createMonitor(canvas) {
  const ctx = canvas.getContext('2d');
  let level = 0;
  function draw() {
    if (!ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.translate(width / 2, height / 2);
    const scale = Math.min(width / 410, height / 200);
    ctx.scale(scale, scale);
    // Contours expand with the measured microphone level; silence is stationary.
    for (let ring = 0; ring < 21; ring++) {
      ctx.beginPath();
      for (let point = 0; point <= 220; point++) {
        const angle = point * Math.PI * 2 / 220;
        const warp = 1 + .10 * Math.sin(3 * angle + ring * .12) + .075 * Math.cos(5 * angle - ring * .10);
        const x = Math.cos(angle) * (42 + ring * 6.3 + level * 8) * warp;
        const y = Math.sin(angle) * (32 + ring * 2.9 + level * 6) * warp + x * .16;
        if (point) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(181,219,149,' + (.63 - ring * .016) + ')';
      ctx.lineWidth = .8;
      ctx.stroke();
    }
  }
  new ResizeObserver(draw).observe(canvas);
  return value => { level = Math.max(0, Math.min(1, Number(value) / 100 || 0)); draw(); };
}
