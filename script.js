'use strict';
(() => {
  const W = 330, H = 420;
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const $ = id => document.getElementById(id);
  const products = [0, 1].map(() => ({ image: null, filename: '', src: '', crop: null, quantity: 1, scale: 1, dx: 0, dy: 0 }));
  const state = { layout: 'auto', showPlus: true, trim: true, showCount: false, selectedLayout: 'side', hits: [], drag: null };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hasBoth = () => products.every(p => p.image);

  // Crops only empty/very light exterior pixels. No source image pixels are modified.
  function findVisibleBounds(image) {
    const tmp = document.createElement('canvas');
    const maxDimension = 700;
    const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    tmp.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    tmp.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const c = tmp.getContext('2d', { willReadFrequently: true });
    c.drawImage(image, 0, 0, tmp.width, tmp.height);
    const { data } = c.getImageData(0, 0, tmp.width, tmp.height);
    let minX = tmp.width, minY = tmp.height, maxX = -1, maxY = -1;
    for (let y = 0; y < tmp.height; y++) {
      for (let x = 0; x < tmp.width; x++) {
        const i = (y * tmp.width + x) * 4;
        const a = data[i + 3];
        const dark = Math.min(data[i], data[i + 1], data[i + 2]);
        // Slightly conservative: pixels close to white are treated as surrounding margin.
        if (a > 24 && dark < 245) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
    const inset = 2;
    minX = Math.max(0, minX - inset); minY = Math.max(0, minY - inset);
    maxX = Math.min(tmp.width - 1, maxX + inset); maxY = Math.min(tmp.height - 1, maxY + inset);
    const x = Math.floor(minX / ratio), y = Math.floor(minY / ratio);
    const r = Math.min(image.naturalWidth, Math.ceil((maxX + 1) / ratio));
    const b = Math.min(image.naturalHeight, Math.ceil((maxY + 1) / ratio));
    return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
  }
  function sourceRect(p) {
    return state.trim ? p.crop : { x: 0, y: 0, w: p.image.naturalWidth, h: p.image.naturalHeight };
  }
  function slots(layout) {
    if (layout === 'side') return [
      { x: 16, y: 24, w: 131, h: 372 },
      { x: 183, y: 24, w: 131, h: 372 }
    ];
    return [
      { x: 18, y: 18, w: 294, h: 166 },
      { x: 18, y: 236, w: 294, h: 166 }
    ];
  }
  function itemGeometry(p, slot, ignoreScale = false) {
    const crop = sourceRect(p), n = p.quantity;
    const aspect = crop.w / crop.h;
    let chosen = null;
    for (let cols = 1; cols <= Math.min(8, n); cols++) {
      const rows = Math.ceil(n / cols);
      const gutter = n > 1 ? 5 : 0;
      const cw = (slot.w - (cols - 1) * gutter) / cols;
      const ch = (slot.h - (rows - 1) * gutter) / rows;
      if (cw <= 0 || ch <= 0) continue;
      const fitW = Math.min(cw, ch * aspect);
      const fitH = fitW / aspect;
      const itemArea = fitW * fitH;
      const score = itemArea * n * (1 - 0.008 * Math.abs(cols - rows));
      if (!chosen || score > chosen.score) chosen = { cols, rows, gutter, cw, ch, fitW, fitH, score };
    }
    if (!chosen) return { rects: [], score: 0 };
    const factor = ignoreScale ? 1 : p.scale;
    let dw = chosen.fitW * 0.94 * factor;
    let dh = chosen.fitH * 0.94 * factor;
    // Restrict enlargement to the slot so products do not collide with one another.
    const maxFactor = Math.min(chosen.cw / dw, chosen.ch / dh, 1);
    dw *= maxFactor; dh *= maxFactor;
    const groupW = chosen.cols * chosen.cw + (chosen.cols - 1) * chosen.gutter;
    const groupH = chosen.rows * chosen.ch + (chosen.rows - 1) * chosen.gutter;
    const baseX = slot.x + (slot.w - groupW) / 2;
    const baseY = slot.y + (slot.h - groupH) / 2;
    const rects = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / chosen.cols);
      const rowCount = Math.min(chosen.cols, n - row * chosen.cols);
      const column = i % chosen.cols;
      const rowW = rowCount * chosen.cw + (rowCount - 1) * chosen.gutter;
      const rowOffset = (groupW - rowW) / 2;
      rects.push({
        x: baseX + rowOffset + column * (chosen.cw + chosen.gutter) + (chosen.cw - dw) / 2 + p.dx,
        y: baseY + row * (chosen.ch + chosen.gutter) + (chosen.ch - dh) / 2 + p.dy,
        w: dw, h: dh
      });
    }
    return { rects, score: chosen.score, area: dw * dh * n };
  }
  function decideLayout() {
    if (state.layout !== 'auto') return state.layout;
    if (!hasBoth()) return 'side';
    const calc = layout => {
      const slot = slots(layout);
      const g = products.map((p, i) => itemGeometry(p, slot[i], true));
      const areas = g.map(x => x.area || 0);
      // Reward total visible product area, gently penalize one tiny member.
      return areas[0] + areas[1] + Math.min(areas[0], areas[1]) * 0.25;
    };
    return calc('side') >= calc('stack') ? 'side' : 'stack';
  }
  function drawBlank() {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b3bdc5';
    ctx.textAlign = 'center'; ctx.font = '13px sans-serif';
    ctx.fillText('商品画像を2枚選択してください', W / 2, H / 2);
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    state.hits = [];
    if (!hasBoth()) { drawBlank(); $('download').disabled = true; $('layout-status').textContent = '画像を2枚選択してください'; return; }
    const layout = decideLayout(); state.selectedLayout = layout;
    const slot = slots(layout);
    products.forEach((p, index) => {
      const crop = sourceRect(p);
      const geometry = itemGeometry(p, slot[index]);
      for (const rect of geometry.rects) {
        ctx.drawImage(p.image, crop.x, crop.y, crop.w, crop.h, rect.x, rect.y, rect.w, rect.h);
        state.hits.push({ ...rect, index });
      }
      if (state.showCount && p.quantity > 1) {
        ctx.fillStyle = '#525b64';ctx.font = 'bold 16px sans-serif';ctx.textAlign = 'right';
        ctx.fillText(`×${p.quantity}`, slot[index].x + slot[index].w - 2, slot[index].y + slot[index].h - 4);
      }
    });
    if (state.showPlus) {
      ctx.fillStyle = '#555b61';ctx.font = 'normal 28px Arial, sans-serif';ctx.textBaseline = 'middle';ctx.textAlign = 'center';
      if (layout === 'side') ctx.fillText('+', W / 2, H / 2);
      else ctx.fillText('+', W / 2, H / 2);
      ctx.textBaseline = 'alphabetic';
    }
    $('download').disabled = false;
    $('layout-status').textContent = `現在の配置：${layout === 'side' ? '左右' : '上下'}（${state.layout === 'auto' ? '自動選択' : '手動指定'}）`;
  }
  function update(message) { render(); if (message) $('message').textContent = message; }
  function resetTransforms() {
    products.forEach((p, i) => { p.dx = 0; p.dy = 0; p.scale = 1; $(`scale-${i}`).value = 100; $(`scale-value-${i}`).textContent = '100%'; });
    update('位置とサイズをリセットしました。');
  }
  async function loadFile(index, file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { $('message').textContent = '画像ファイルを選択してください。'; return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      if (!img.naturalWidth || !img.naturalHeight) throw Error('画像サイズを取得できません');
      const p = products[index];
      p.image = img; p.filename = file.name; p.crop = findVisibleBounds(img); p.dx = 0; p.dy = 0; p.scale = 1;
      $(`scale-${index}`).value = 100; $(`scale-value-${index}`).textContent = '100%';
      const thumb = $(`thumb-${index}`); thumb.src = url; thumb.hidden = false;
      $(`placeholder-${index}`).hidden = true;
      $(`filename-${index}`).textContent = `${file.name} · ${img.naturalWidth} × ${img.naturalHeight}`;
      if (p.src) URL.revokeObjectURL(p.src);
      p.src = url;
      update(hasBoth() ? '画像をドラッグして位置を微調整できます。' : 'もう1枚の商品画像を選択してください。');
    } catch (err) {
      URL.revokeObjectURL(url);
      $('message').textContent = `画像を読み込めませんでした：${err.message}`;
    }
  }
  [0, 1].forEach(i => {
    $(`file-${i}`).addEventListener('change', e => loadFile(i, e.target.files[0]));
    const drop = $(`drop-${i}`);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('dragover');
      if (e.dataTransfer.files.length) loadFile(i, e.dataTransfer.files[0]);
    });
    $(`quantity-${i}`).addEventListener('input', e => {
      const n = parseInt(e.target.value, 10);
      if (!Number.isFinite(n)) return;
      products[i].quantity = clamp(n, 1, 24); update();
    });
    $(`quantity-${i}`).addEventListener('change', e => { e.target.value = products[i].quantity; });
    $(`scale-${i}`).addEventListener('input', e => {
      products[i].scale = Number(e.target.value) / 100;
      $(`scale-value-${i}`).textContent = `${e.target.value}%`;
      update();
    });
  });
  document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => {
    state.layout = b.dataset.layout;
    document.querySelectorAll('[data-layout]').forEach(el => { const active = el === b; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', String(active)); });
    products.forEach(p => { p.dx = 0; p.dy = 0; });
    update();
  }));
  [['show-plus', 'showPlus'], ['trim-whitespace', 'trim'], ['show-count', 'showCount']].forEach(([id, key]) => {
    $(id).addEventListener('change', e => { state[key] = e.target.checked; update(); });
  });
  $('reset-position').addEventListener('click', resetTransforms);
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * W / rect.width, y: (e.clientY - rect.top) * H / rect.height };
  }
  canvas.addEventListener('pointerdown', e => {
    if (!hasBoth()) return;
    const pos = canvasPoint(e);
    const hit = [...state.hits].reverse().find(r => pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h);
    if (!hit) return;
    state.drag = { index: hit.index, x: pos.x, y: pos.y, dx: products[hit.index].dx, dy: products[hit.index].dy };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!state.drag) return;
    const pos = canvasPoint(e), p = products[state.drag.index];
    p.dx = clamp(state.drag.dx + pos.x - state.drag.x, -90, 90);
    p.dy = clamp(state.drag.dy + pos.y - state.drag.y, -90, 90);
    // Keep the entire group's rendered extent on the canvas.
    const s = slots(state.selectedLayout)[state.drag.index];
    p.dx = clamp(p.dx, -s.x + 5, W - (s.x + s.w) - 5);
    p.dy = clamp(p.dy, -s.y + 5, H - (s.y + s.h) - 5);
    render();
  });
  const endDrag = () => { state.drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);canvas.addEventListener('pointercancel', endDrag);
  $('download').addEventListener('click', () => {
    if (!hasBoth()) return;
    render();
    canvas.toBlob(blob => {
      if (!blob) { $('message').textContent = 'PNGの書き出しに失敗しました。'; return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');a.href = url;a.download = 'REVO_set_330x420.png';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      $('message').textContent = '330×420pxのPNGファイルを書き出しました。';
    }, 'image/png');
  });
  drawBlank();
})();
