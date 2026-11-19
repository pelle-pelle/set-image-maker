'use strict';
(() => {
  const W = 330, H = 420, MAX_TYPES = 12, MAX_QUANTITY = 24;
  const $ = id => document.getElementById(id);
  const canvas = $('preview'), ctx = canvas.getContext('2d');
  const groups = { purchase: [], service: [] };
  const state = { layout: 'auto', showPlus: true, trim: true, showCount: false, currentLayout: 'side', hits: [], drag: null, nextId: 1 };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const entries = () => [...groups.purchase, ...groups.service];
  const ready = () => groups.purchase.some(p => p.image) && groups.service.some(p => p.image);
  const toRect = p => state.trim && p.crop ? p.crop : { x: 0, y: 0, w: p.image.naturalWidth, h: p.image.naturalHeight };
  const escapeHTML = str => String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function visibleBounds(image) {
    // Only trims the exterior white / transparent field. Never modifies interior pixels.
    const tmp = document.createElement('canvas');
    const ratio = Math.min(1, 700 / Math.max(image.naturalWidth, image.naturalHeight));
    tmp.width = Math.max(1, Math.ceil(image.naturalWidth * ratio));
    tmp.height = Math.max(1, Math.ceil(image.naturalHeight * ratio));
    const c = tmp.getContext('2d', { willReadFrequently: true });
    c.drawImage(image, 0, 0, tmp.width, tmp.height);
    const pixels = c.getImageData(0, 0, tmp.width, tmp.height).data;
    let minX = tmp.width, minY = tmp.height, maxX = -1, maxY = -1;
    for (let y = 0; y < tmp.height; y++) {
      for (let x = 0; x < tmp.width; x++) {
        const i = (y * tmp.width + x) * 4;
        if (pixels[i+3] > 24 && Math.min(pixels[i], pixels[i+1], pixels[i+2]) < 245) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0) return {x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};
    const pad = 2;
    const x = Math.max(0, Math.floor((minX-pad) / ratio));
    const y = Math.max(0, Math.floor((minY-pad) / ratio));
    const right = Math.min(image.naturalWidth, Math.ceil((maxX+pad+1) / ratio));
    const bottom = Math.min(image.naturalHeight, Math.ceil((maxY+pad+1) / ratio));
    return { x, y, w: Math.max(1,right-x), h: Math.max(1,bottom-y) };
  }

  function buildEntry(group, product) {
    const element = document.createElement('article');
    element.className = 'product-entry'; element.dataset.productId = product.id;
    const index = groups[group].indexOf(product) + 1;
    element.innerHTML = `<div class="entry-top"><span class="entry-label">商品 ${index}</span><button class="remove-item" type="button" title="この商品を削除" aria-label="商品${index}を削除">×</button></div>
      <label class="dropzone"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="商品${index}の画像を選択"><img alt="商品画像" hidden><span class="placeholder"><span class="upload-icon">＋</span><strong>画像を選択</strong><small>クリック / ドロップ</small></span></label>
      <div class="filename">未選択</div><div class="quantity-row"><label>本数・個数</label><input class="qty" type="number" min="1" max="${MAX_QUANTITY}" inputmode="numeric" value="${product.quantity}" aria-label="商品${index}の本数"></div>
      <label class="range-label"><span>表示サイズ</span><output>100%</output></label><input class="range scale" type="range" min="40" max="160" value="100" step="5" aria-label="商品${index}のサイズ">`;
    const input = element.querySelector('input[type=file]');
    input.addEventListener('change', e => loadFile(product, e.target.files[0], element));
    const drop = element.querySelector('.dropzone');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); if (e.dataTransfer.files.length) loadFile(product, e.dataTransfer.files[0], element); });
    element.querySelector('.remove-item').addEventListener('click', () => removeProduct(group, product.id));
    element.querySelector('.qty').addEventListener('input', e => {
      const n = Number.parseInt(e.target.value, 10);
      if (Number.isFinite(n)) { product.quantity = clamp(n, 1, MAX_QUANTITY); render(); }
    });
    element.querySelector('.qty').addEventListener('change', e => { e.target.value = product.quantity; });
    element.querySelector('.scale').addEventListener('input', e => {
      product.scale = Number(e.target.value) / 100;
      element.querySelector('output').textContent = `${e.target.value}%`;
      render();
    });
    element.querySelector('.range-label').addEventListener('click', e => e.preventDefault());
    return element;
  }
  function refreshGroup(group) {
    const list = $(`${group}-list`);
    const items = groups[group];
    list.replaceChildren(...items.map(p => p.element));
    items.forEach((p, i) => {
      p.element.querySelector('.entry-label').textContent = `商品 ${i+1}`;
      p.element.querySelector('.remove-item').setAttribute('aria-label', `商品${i+1}を削除`);
    });
    const count = items.filter(p => p.image).length;
    $(`${group}-summary`).textContent = `${count}種類 / ${items.length}枠`;
    $(`add-${group}`).disabled = items.length >= MAX_TYPES;
  }
  function addProduct(group) {
    if (groups[group].length >= MAX_TYPES) return;
    const p = { id: state.nextId++, group, image:null, src:'', filename:'', crop:null, quantity:1, scale:1, dx:0, dy:0, element:null };
    groups[group].push(p);
    p.element = buildEntry(group, p);
    refreshGroup(group);render();
  }
  function removeProduct(group, id) {
    const i = groups[group].findIndex(p => p.id === id);
    if (i < 0) return;
    const [p] = groups[group].splice(i, 1);
    if (p.src) URL.revokeObjectURL(p.src);
    refreshGroup(group); render();
  }
  async function loadFile(p, file, element) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { $('message').textContent = '画像ファイルを選択してください。'; return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((resolve, reject) => { img.onload=resolve; img.onerror=reject; img.src=url; });
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('画像の寸法を取得できません');
      const crop = visibleBounds(img);
      if (!entries().includes(p)) { URL.revokeObjectURL(url); return; }
      if (p.src) URL.revokeObjectURL(p.src);
      Object.assign(p, { image:img, src:url, filename:file.name, crop, dx:0, dy:0, scale:1 });
      element.querySelector('.scale').value = 100; element.querySelector('output').textContent='100%';
      const thumb = element.querySelector('img'); thumb.src = url; thumb.hidden = false;
      element.querySelector('.placeholder').hidden = true;
      element.querySelector('.filename').textContent = `${file.name} · ${img.naturalWidth} × ${img.naturalHeight}`;
      refreshGroup(p.group); render();
      $('message').textContent = ready() ? '商品をドラッグすると、その種類の画像をまとめて移動できます。' : '反対側のグループにも画像を登録してください。';
    } catch (err) {
      URL.revokeObjectURL(url);
      $('message').textContent = `画像を読み込めませんでした：${err.message}`;
    }
  }

  function sectionRects(layout) {
    if (layout === 'side') return { purchase:{x:14,y:19,w:134,h:382}, service:{x:182,y:19,w:134,h:382} };
    return { purchase:{x:16,y:16,w:298,h:171}, service:{x:16,y:234,w:298,h:170} };
  }
  function findTypeGrid(group, slot) {
    const n = group.length;
    if (!n) return { cells:[], score:0 };
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), gap = n > 1 ? 5 : 0;
      const cw = (slot.w - gap*(cols-1)) / cols;
      const ch = (slot.h - gap*(rows-1)) / rows;
      if (cw < 4 || ch < 4) continue;
      const areas = group.map(p => {
        const r = toRect(p);
        const aspect = r.w / r.h;
        const fitW = Math.min(cw, ch*aspect);
        return fitW * fitW / aspect;
      });
      // High total area, with a moderate preference for legibility of the smallest type.
      const score = areas.reduce((a,b)=>a+b,0) + Math.min(...areas)*0.3;
      if (!best || score > best.score) best = { cols,rows,gap,cw,ch,score };
    }
    if (!best) return {cells:[],score:0};
    const {cols,rows,gap,cw,ch} = best;
    const cells = group.map((p,i) => {
      const row = Math.floor(i/cols), col = i%cols;
      const rowCount = Math.min(cols, n-row*cols);
      const fullW = cols*cw + (cols-1)*gap;
      const rowW = rowCount*cw + (rowCount-1)*gap;
      return {x:slot.x+(slot.w-fullW)/2+(fullW-rowW)/2+col*(cw+gap), y:slot.y+(slot.h-(rows*ch+(rows-1)*gap))/2+row*(ch+gap), w:cw,h:ch};
    });
    return {cells,score:best.score};
  }
  function productGeometry(p, cell, ignoreTransforms=false) {
    const crop = toRect(p), n = p.quantity, aspect = crop.w/crop.h;
    let best = null;
    for (let cols=1;cols<=Math.min(n,8);cols++) {
      const rows = Math.ceil(n/cols), gap = n>1?2.5:0;
      const cw=(cell.w-gap*(cols-1))/cols, ch=(cell.h-gap*(rows-1))/rows;
      if (cw<=0 || ch<=0) continue;
      const fitW=Math.min(cw,ch*aspect), fitH=fitW/aspect;
      const score=fitW*fitH*n;
      if (!best || score>best.score) best={cols,rows,gap,cw,ch,fitW,fitH,score};
    }
    if (!best) return [];
    const b=best, factor=ignoreTransforms?1:p.scale;
    const scale=Math.min(factor, b.cw/(b.fitW*.95), b.ch/(b.fitH*.95));
    const dw=b.fitW*.95*scale, dh=b.fitH*.95*scale;
    const groupW=b.cols*b.cw+(b.cols-1)*b.gap;
    const groupH=b.rows*b.ch+(b.rows-1)*b.gap;
    const rects=[];
    for (let i=0;i<n;i++) {
      const row=Math.floor(i/b.cols), column=i%b.cols;
      const rowCount=Math.min(b.cols,n-row*b.cols);
      const rowWidth=rowCount*b.cw+(rowCount-1)*b.gap;
      const rowOffset=(groupW-rowWidth)/2;
      rects.push({x:cell.x+(cell.w-groupW)/2+rowOffset+column*(b.cw+b.gap)+(b.cw-dw)/2+(ignoreTransforms?0:p.dx),y:cell.y+(cell.h-groupH)/2+row*(b.ch+b.gap)+(b.ch-dh)/2+(ignoreTransforms?0:p.dy),w:dw,h:dh});
    }
    return rects;
  }
  function geometry(layout, ignoreTransforms=false) {
    const sections=sectionRects(layout), list=[];
    for (const key of ['purchase','service']) {
      const group=groups[key].filter(p=>p.image);
      if (!group.length) continue;
      const {cells}=findTypeGrid(group,sections[key]);
      group.forEach((p,i)=>list.push({p,cell:cells[i],rects:productGeometry(p,cells[i],ignoreTransforms)}));
    }
    return list;
  }
  function chooseLayout() {
    if (state.layout !== 'auto') return state.layout;
    if (!ready()) return 'side';
    const score = mode => {
      const items=geometry(mode,true);
      const sides = {purchase:0,service:0};
      items.forEach(item => item.rects.forEach(r => { sides[item.p.group]+=r.w*r.h; }));
      return sides.purchase+sides.service+Math.min(sides.purchase,sides.service)*0.3;
    };
    return score('side') >= score('stack') ? 'side' : 'stack';
  }
  function render() {
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
    state.hits=[];
    if (!ready()) {
      ctx.fillStyle='#9ca9b3';ctx.textAlign='center';ctx.font='12px sans-serif';
      ctx.fillText('購入商品・サービス商品を', W/2,H/2-9);
      ctx.fillText('それぞれ登録してください',W/2,H/2+12);
      $('download').disabled=true;
      $('layout-status').textContent='左右のグループに画像を登録してください';
      return;
    }
    const layout=chooseLayout();state.currentLayout=layout;
    const drawn=geometry(layout);
    for (const item of drawn) {
      const crop=toRect(item.p);
      for (const rect of item.rects) {
        ctx.drawImage(item.p.image,crop.x,crop.y,crop.w,crop.h,rect.x,rect.y,rect.w,rect.h);
        state.hits.push({p:item.p,rect,cell:item.cell});
      }
      if (state.showCount && item.p.quantity>1) {
        ctx.fillStyle='#515c65';ctx.font='bold 11px Arial,sans-serif';ctx.textAlign='right';ctx.textBaseline='bottom';
        ctx.fillText(`×${item.p.quantity}`,item.cell.x+item.cell.w-1,item.cell.y+item.cell.h-1);
      }
    }
    if (state.showPlus) {
      ctx.fillStyle='#555b61';ctx.font='28px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('+',W/2,H/2);
    }
    ctx.textBaseline='alphabetic';
    $('download').disabled=false;
    $('layout-status').textContent=`現在の配置：${layout==='side'?'左右':'上下'}（${state.layout==='auto'?'自動選択':'手動指定'}）`;
  }
  function resetTransforms() {
    for (const p of entries()) {
      p.dx=0;p.dy=0;p.scale=1;
      p.element.querySelector('.scale').value=100;
      p.element.querySelector('output').textContent='100%';
    }
    render();$('message').textContent='位置とサイズをリセットしました。';
  }
  function resetAll() {
    for (const p of entries()) if (p.src) URL.revokeObjectURL(p.src);
    groups.purchase=[];groups.service=[];
    addProduct('purchase');addProduct('service');
    render();$('message').textContent='すべてクリアしました。';
  }
  function canvasPoint(e) {
    const b=canvas.getBoundingClientRect();
    return {x:(e.clientX-b.left)*W/b.width,y:(e.clientY-b.top)*H/b.height};
  }
  canvas.addEventListener('pointerdown',e=>{
    if (!ready()) return;
    const pos=canvasPoint(e);
    const hit=[...state.hits].reverse().find(h=>pos.x>=h.rect.x&&pos.x<=h.rect.x+h.rect.w&&pos.y>=h.rect.y&&pos.y<=h.rect.y+h.rect.h);
    if (!hit) return;
    state.drag={p:hit.p,cell:hit.cell,x:pos.x,y:pos.y,dx:hit.p.dx,dy:hit.p.dy};
    canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');
    document.querySelectorAll('.product-entry').forEach(el=>el.classList.toggle('active-item',Number(el.dataset.productId)===hit.p.id));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if (!state.drag) return;
    const d=state.drag,pos=canvasPoint(e),p=d.p;
    const proposedX=d.dx+pos.x-d.x,proposedY=d.dy+pos.y-d.y;
    p.dx=0;p.dy=0;
    const rects=productGeometry(p,d.cell);
    if (!rects.length) return;
    const minX=Math.min(...rects.map(r=>r.x)),minY=Math.min(...rects.map(r=>r.y));
    const maxX=Math.max(...rects.map(r=>r.x+r.w)),maxY=Math.max(...rects.map(r=>r.y+r.h));
    // Keep products on the output canvas; allow deliberate adjustments within the section.
    const section=sectionRects(state.currentLayout)[p.group];
    p.dx=clamp(proposedX,Math.max(5-minX,section.x-minX-12),Math.min(W-5-maxX,section.x+section.w-maxX+12));
    p.dy=clamp(proposedY,Math.max(5-minY,section.y-minY-12),Math.min(H-5-maxY,section.y+section.h-maxY+12));
    render();
  });
  const stopDrag=()=>{state.drag=null;canvas.classList.remove('dragging');document.querySelectorAll('.product-entry').forEach(el=>el.classList.remove('active-item'));};
  canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
  $('add-purchase').addEventListener('click',()=>addProduct('purchase'));
  $('add-service').addEventListener('click',()=>addProduct('service'));
  document.querySelectorAll('[data-layout]').forEach(button=>button.addEventListener('click',()=>{
    state.layout=button.dataset.layout;
    document.querySelectorAll('[data-layout]').forEach(el=>{const active=el===button;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active));});
    for (const p of entries()) {p.dx=0;p.dy=0;}
    render();
  }));
  [['show-plus','showPlus'],['trim-whitespace','trim'],['show-count','showCount']].forEach(([id,key])=>{
    $(id).addEventListener('change',e=>{state[key]=e.target.checked;render();});
  });
  $('reset-position').addEventListener('click',resetTransforms);
  $('reset-all').addEventListener('click',resetAll);
  $('download').addEventListener('click',()=>{
    if (!ready()) return;
    render();
    canvas.toBlob(blob=>{
      if (!blob) {$('message').textContent='PNG書き出しに失敗しました。';return;}
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='REVO_set_330x420.png';document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      $('message').textContent='330×420pxのPNGを保存しました。';
    },'image/png');
  });
  addProduct('purchase');addProduct('service');render();
})();
