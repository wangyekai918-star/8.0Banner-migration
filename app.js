(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('banner-data').textContent);
  const records = data.records;
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.id)) groups.set(record.id, []);
    groups.get(record.id).push(record);
  }
  const selectedVariants = new Map();
  let matchingKeys = new Set();
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    app:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
    mini:'<path d="M12 12c-7-6-12 2-6 5 3 2 5-1 5-5s2-7 5-5c6 3 1 11-6 5"/>',
    link:'<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 9l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
    zoom:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',
    image:'<rect x="2" y="4" width="20" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 3 3-3 5 4"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  const byteSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`;
  const dimensions = r => `${r.image.width} × ${r.image.height}`;
  const imageUrl = image => image.sha256 ? `${image.src}${image.src.includes('?')?'&':'?'}v=${image.sha256.slice(0,12)}` : image.src;
  const safeLink = value => /^https?:\/\//i.test(String(value));
  const batchSize = 10, sectionSize = 5, preloadDistance = 900;
  let terminal = 'all', query = '';
  let loadedCount = 0, loadingMore = false, renderVersion = 0, batchController;
  let navigationFrame = 0, activeSection = -1, topScrollFrame = 0;
  let filtered = records.slice(), previewIndex = 0, toastTimer;
  let previewRecords = [], previewVersion = '7.0';
  const searchable = new Map(records.map(r => [r.key, Object.values(r.fields).filter(v => v != null).join(' ').toLocaleLowerCase()]));
  const openedDetails = new Set();
  const openedCities = new Set();
  const stats = data.stats;
  $('stat-records').textContent = groups.size;
  $('stat-ids').textContent = stats.records;
  $('count-all').textContent = groups.size;
  $('count-app').textContent = stats.terminals['APP轮播图'] || 0;
  $('count-mini').textContent = stats.terminals['小程序轮播图'] || 0;


  function metadata(r) {
    return data.headers.filter(k => !['ID','终端类型'].includes(k)).map(k => {
      const raw = r.fields[k], value = raw == null || raw === '' ? '—' : String(raw);
      const text = safeLink(value) ? `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>` : escape(value);
      return `<dt>${escape(k)}</dt><dd>${text}</dd>`;
    }).join('');
  }
  function card(r, n) {
    const variants = groups.get(r.id);
    const terminals = variants.map(v => {
      const app = v.terminal === 'APP轮播图';
      if (v.terminalPending) return '<span class="terminal-badge">终端待补充</span>';
      if (variants.length === 1) return `<span class="terminal-badge ${app?'':'mini'}">${icon(app?'app':'mini')}${escape(v.terminal)}</span>`;
      return `<button type="button" class="terminal-badge variant-button ${app?'':'mini'}" data-variant="${escape(v.key)}" data-banner-id="${escape(v.id)}" aria-pressed="${v.key===r.key}" ${matchingKeys.has(v.key)?'':'disabled'} title="${matchingKeys.has(v.key)?'查看此终端的原图与配置信息':'此终端不符合当前筛选条件'}">${icon(app?'app':'mini')}${escape(v.terminal)}</button>`;
    }).join('');
    const variantHint = variants.length > 1 ? `<span class="variant-hint">${new Set(variants.map(v=>v.image.sha256)).size>1?'原图不同 · 点击终端切换':'同 ID 已合并'}</span>` : '';
    const image = r.image;
    const idLine = r.idPending
      ? '<span class="id-label">ID</span><span class="id-value">待补充</span>'
      : `<span class="id-label">ID</span><span class="id-value">${escape(r.id)}</span><button type="button" class="icon-button" data-copy="${escape(r.id)}" aria-label="复制 Banner ID ${escape(r.id)}">${icon('copy')}</button>`;
    const sourceLabel = r.sourceRow ? `Excel 第 ${r.sourceRow} 行` : '手动补充';
    const hasSizeWarning = r.id === '21b5c9d3-8b9f-4d39-b157-1cb857cf3b92';
    const sizeWarning = hasSizeWarning ? `<span class="size-warning" id="size-warning-${escape(r.key)}">线上Banner 尺寸存在异常</span>` : '';
    const preview = image.src ? `<button type="button" class="image-button${hasSizeWarning?' has-size-warning':''}" data-preview="${escape(r.key)}" aria-label="放大预览：${escape(r.title)} · ${escape(r.terminal)}" ${hasSizeWarning?`aria-describedby="size-warning-${escape(r.key)}"`:''}><img class="banner-image" src="${escape(image.src)}" alt="${escape(r.title)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"><span class="image-load-state" aria-hidden="true">加载中…</span><span class="zoom-cue">${icon('zoom')}放大预览</span>${sizeWarning}</button><div class="image-caption"><span>${dimensions(r)} px</span><span>·</span><span>${escape(image.format)} / ${byteSize(image.bytes)}</span><span class="ratio">· ${(image.width / image.height).toFixed(2)} : 1</span><a href="${escape(image.src)}" download="${escape(image.src.split('/').pop())}">${icon('download')}下载原图</a></div>` : `<div class="image-error">原图下载失败，请查看详情中的图片链接</div>`;
    const next = r.newImage;
    const newer = next?.src ? `<div class="new-artwork"><button type="button" class="image-button" data-preview="${escape(r.key)}" data-version="8.0" aria-label="放大预览：${escape(r.title)} · 8.0 新版"><img class="new-banner" src="${escape(imageUrl(next))}" width="${next.width}" height="${next.height}" alt="${escape(r.title)} 8.0 新版" loading="lazy" decoding="async"><span class="image-load-state" aria-hidden="true">加载中…</span><span class="zoom-cue">${icon('zoom')}放大预览</span></button><div class="image-caption"><span>${next.width} × ${next.height} px</span><span>·</span><span>JPG / ${byteSize(next.bytes)}</span><a href="${escape(imageUrl(next))}" download="${escape(next.src.split('/').pop())}">${icon('download')}下载 8.0 图片</a></div></div>` : `<div class="placeholder">${icon('image')}<span>8.0 图片待补充</span><span class="placeholder-sub">预留新版对照位置</span></div>`;
    return `<article class="banner-row" id="banner-row-${n}" tabindex="-1" data-banner-id="${escape(r.id)}" data-record-key="${escape(r.key)}"><div class="old-cell"><div class="record-top"><span class="row-number">${String(n).padStart(3,'0')}</span>${terminals}${variantHint}</div><div class="id-line">${idLine}</div><h2 class="record-title">${escape(r.title)}</h2>${preview}<div class="brief-meta" data-meta-key="${escape(r.key)}">${icon('pin')}<span class="brief-meta-text" id="meta-${escape(r.key)}">${escape(r.fields['可用城市'] || '未设置城市')}<span class="meta-separator">/</span>${escape(r.fields['运营公司'] || '未设置运营公司')}</span><button type="button" class="meta-toggle" data-meta-toggle aria-expanded="false" aria-controls="meta-${escape(r.key)}" hidden>展开</button></div><details class="details" data-details-key="${escape(r.id)}" ${openedDetails.has(r.id)?'open':''}><summary>${icon('arrow')}配置信息<span class="source-row">${sourceLabel}</span></summary><dl>${metadata(r)}</dl></details></div><div class="new-cell"><div class="new-label"><span>${next?.src?'已适配 8.0':'新版预留'}</span><span class="tiny-id">${escape(r.terminal)}</span></div>${newer}</div></article>`;
  }
  function updateCityOverflow(root = document) {
    root.querySelectorAll('.brief-meta').forEach(row => {
      const text = row.querySelector('.brief-meta-text');
      const button = row.querySelector('.meta-toggle');
      // Measure the available full line before reserving space for the toggle.
      row.classList.remove('is-expanded');
      button.hidden = true;
      const overflows = text.scrollWidth > text.clientWidth + 1;
      const expanded = overflows && openedCities.has(row.dataset.metaKey);
      button.hidden = !overflows;
      row.classList.toggle('is-expanded', expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '收起' : '展开';
    });
  }
  function prepareImages(root) {
    root.querySelectorAll('img.banner-image, img.new-banner').forEach(img => {
      const button = img.closest('.image-button');
      const label = button.querySelector('.image-load-state');
      const finish = () => {
        button.classList.remove('is-loading');
        const failed = !img.naturalWidth;
        button.classList.toggle('is-error', failed);
        label.textContent = failed ? '图片加载失败 · 点击重试' : '';
      };
      if (img.complete) finish();
      else button.classList.add('is-loading');
      img.addEventListener('load', finish);
      img.addEventListener('error', finish);
    });
  }
  function updateLoadStatus() {
    const hasMore = loadedCount < filtered.length;
    $('load-more').hidden = filtered.length === 0;
    $('load-more').classList.toggle('is-loading', loadingMore);
    $('load-more').classList.toggle('is-complete', !hasMore);
    $('banner-list').setAttribute('aria-busy', String(loadingMore));
    $('load-title').textContent = loadingMore ? '正在加载更多 Banner…' : hasMore ? '继续下滑，自动加载更多' : '已显示全部 Banner';
    $('load-progress').textContent = `已显示 ${loadedCount} / ${filtered.length} 个 Banner`;
  }
  function appendBatch(end = Math.min(loadedCount + batchSize, filtered.length)) {
    const start = loadedCount;
    const template = document.createElement('template');
    template.innerHTML = filtered.slice(start, end).map((r, i) => card(r, start + i + 1)).join('');
    const rows = [...template.content.children];
    $('banner-list').append(template.content);
    loadedCount = end;
    rows.forEach(row => {prepareImages(row); updateCityOverflow(row);});
    scheduleNavigationUpdate();
  }
  function renderSectionIndex() {
    const sections = Math.ceil(filtered.length / sectionSize);
    activeSection = -1;
    $('section-index').hidden = sections === 0;
    $('index-steps').innerHTML = Array.from({length:sections}, (_, index) => {
      const start = index * sectionSize + 1, end = Math.min(start + sectionSize - 1, filtered.length);
      const range = `${String(start).padStart(3,'0')}–${String(end).padStart(3,'0')}`;
      return `<button type="button" class="index-step" data-section="${index}" aria-label="跳转到第 ${range} 张 Banner" aria-controls="banner-list"><span class="index-mark" aria-hidden="true"></span><span class="index-tooltip" aria-hidden="true"><strong>${range}</strong><span>${escape(filtered[start-1].title)}</span></span></button>`;
    }).join('');
    scheduleNavigationUpdate();
  }
  function scheduleNavigationUpdate() {
    if (!navigationFrame) navigationFrame = requestAnimationFrame(updateScrollNavigation);
  }
  function updateScrollNavigation() {
    navigationFrame = 0;
    $('back-to-top').hidden = window.scrollY < Math.min(400, window.innerHeight * .6);
    if (!filtered.length) return;
    const marker = document.querySelector('.sticky-tools').getBoundingClientRect().height + 32;
    let current = 0;
    for (let start = 1; start <= loadedCount; start += sectionSize) {
      const row = $(`banner-row-${start}`);
      if (row && row.getBoundingClientRect().top <= marker) current = Math.floor((start - 1) / sectionSize);
      else break;
    }
    if (current === activeSection) return;
    activeSection = current;
    document.querySelectorAll('.index-step').forEach(button => {
      const distance = Math.abs(Number(button.dataset.section) - current);
      button.style.setProperty('--mark-size', distance === 0 ? '32px' : distance === 1 ? '24px' : distance === 2 ? '18px' : '12px');
      if (distance === 0) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
  }
  function cancelScrollToTop() {
    cancelAnimationFrame(topScrollFrame);
    topScrollFrame = 0;
  }
  function scrollToTop() {
    cancelScrollToTop();
    const startY = window.scrollY;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || startY <= 0) {
      window.scrollTo({top:0, behavior:'instant'});
      return;
    }
    const started = performance.now(), duration = 260;
    const tick = now => {
      const progress = Math.min(1, (now - started) / duration);
      window.scrollTo({top:startY * Math.pow(1 - progress, 3), behavior:'instant'});
      topScrollFrame = progress < 1 ? requestAnimationFrame(tick) : 0;
    };
    topScrollFrame = requestAnimationFrame(tick);
  }
  function jumpToSection(section) {
    const start = section * sectionSize;
    if (start < 0 || start >= filtered.length) return;
    cancelScrollToTop();
    // Cancel a pending scroll preload so a later response cannot duplicate appended rows.
    renderVersion++;
    batchController?.abort();
    batchController = null;
    loadingMore = false;
    const end = Math.min(start + sectionSize, filtered.length);
    // Only add card structure for skipped groups; their images remain lazy.
    if (loadedCount < end) appendBatch(end);
    updateLoadStatus();
    const row = $(`banner-row-${start + 1}`);
    const offset = document.querySelector('.sticky-tools').getBoundingClientRect().height + 16;
    const top = row.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({top:Math.max(0, top), behavior:'instant'});
    row.focus({preventScroll:true});
    scheduleNavigationUpdate();
  }
  function preloadImage(src, signal) {
    if (!src || signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const img = new Image();
      const finish = () => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {finish(); img.removeAttribute('src');};
      // A missing image must not block subsequent batches.
      const timer = setTimeout(cancel, 10000);
      img.onload = img.onerror = finish;
      signal.addEventListener('abort', cancel, {once:true});
      img.src = src;
    });
  }
  async function loadMore() {
    if (loadingMore || loadedCount >= filtered.length) return;
    const version = renderVersion;
    const controller = new AbortController();
    batchController = controller;
    loadingMore = true;
    updateLoadStatus();
    // Warm only the first comparison row. Remaining images stay lazy until approached.
    const next = filtered[loadedCount];
    await Promise.all([
      preloadImage(next.image.src, controller.signal),
      preloadImage(next.newImage?.src ? imageUrl(next.newImage) : '', controller.signal)
    ]);
    if (version !== renderVersion || controller.signal.aborted) return;
    batchController = null;
    appendBatch();
    loadingMore = false;
    updateLoadStatus();
    requestAnimationFrame(maybeLoadMore);
  }
  function maybeLoadMore() {
    if ($('load-more').hidden) return;
    const rect = $('load-more').getBoundingClientRect();
    if (rect.top <= window.innerHeight + preloadDistance && rect.bottom >= 0) loadMore();
  }
  function render() {
    cancelScrollToTop();
    const tools = document.querySelector('.sticky-tools');
    const returnToStart = $('banner-list').getBoundingClientRect().top < tools.getBoundingClientRect().height;
    renderVersion++;
    batchController?.abort();
    batchController = null;
    loadingMore = false;
    loadedCount = 0;
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    matchingKeys = new Set();
    filtered = [];
    for (const [id, variants] of groups) {
      const matches = variants.filter(r => (terminal==='all'||r.terminal===terminal) && terms.every(t => searchable.get(r.key).includes(t)));
      matches.forEach(r => matchingKeys.add(r.key));
      if (matches.length) filtered.push(matches.find(r=>r.key===selectedVariants.get(id)) || matches.find(r=>r.key===r.newImage?.sourceRecordKey) || matches.find(r=>r.terminal==='APP轮播图') || matches[0]);
    }
    $('banner-list').replaceChildren();
    appendBatch();
    const count = filtered.length;
    $('empty').hidden = count !== 0;
    document.querySelectorAll('[data-terminal]').forEach(b => { const selected = b.dataset.terminal===terminal; b.classList.toggle('active',selected); b.setAttribute('aria-pressed',String(selected)); });
    updateLoadStatus();
    renderSectionIndex();
    if (returnToStart) tools.scrollIntoView({behavior:'instant', block:'start'});
    requestAnimationFrame(maybeLoadMore);
  }
  function reset() {terminal='all';query='';$('search').value='';render();}
  function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},2400);}
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {const el=document.createElement('textarea');el.value=text;el.style.cssText='position:fixed;opacity:0';document.body.append(el);el.select();const ok=document.execCommand('copy');el.remove();if(!ok)throw Error('copy failed');}
      toast('Banner ID 已复制');
    } catch {toast('复制失败，请选中 ID 手动复制');}
  }
  function setPreview(index) {
    previewIndex=index;const r=previewRecords[index], image=previewVersion==='8.0'?r.newImage:r.image;
    $('preview-title').textContent=r.title;
    $('preview-subtitle').textContent=`${previewVersion} · ${r.terminalPending?'终端待补充':r.terminal} · ID ${r.idPending?'待补充':r.id} · ${image.width} × ${image.height} px`;
    $('preview-image').src=imageUrl(image); $('preview-image').alt=`${r.title} · ${previewVersion} · ${r.terminal}`;
    $('preview-download').href=imageUrl(image); $('preview-download').download=image.src.split('/').pop();
    $('preview-download').textContent=previewVersion==='8.0'?'下载 8.0 图片':'下载原图';
    $('preview-index').textContent=`${index+1} / ${previewRecords.length}`;
    $('preview-prev').disabled=index===0;$('preview-next').disabled=index===previewRecords.length-1;
  }
  function openPreview(key, version='7.0') {previewVersion=version;previewRecords=filtered.filter(r=>version==='8.0'?r.newImage?.src:r.image?.src);const i=previewRecords.findIndex(r=>r.key===key);if(i<0)return;setPreview(i);$('preview').showModal();}
  document.querySelectorAll('[data-terminal]').forEach(b=>b.addEventListener('click',()=>{terminal=b.dataset.terminal;render(true);}));
  $('search').addEventListener('input',e=>{query=e.target.value;render(true);});
  $('empty-reset').addEventListener('click',reset);
  $('banner-list').addEventListener('toggle',event=>{const d=event.target;if(d.matches('.details')){if(d.open)openedDetails.add(d.dataset.detailsKey);else openedDetails.delete(d.dataset.detailsKey);}},true);
  $('banner-list').addEventListener('click',e=>{
    const cityToggle=e.target.closest('[data-meta-toggle]');
    if(cityToggle){
      const row=cityToggle.closest('.brief-meta'), key=row.dataset.metaKey;
      const expanded=cityToggle.getAttribute('aria-expanded')!=='true';
      if(expanded)openedCities.add(key);else openedCities.delete(key);
      row.classList.toggle('is-expanded',expanded);
      cityToggle.setAttribute('aria-expanded',String(expanded));
      cityToggle.textContent=expanded?'收起':'展开';
      return;
    }
    const variant=e.target.closest('[data-variant]');
    if(variant && !variant.disabled){
      const id = variant.dataset.bannerId;
      const record = groups.get(id).find(r => r.key === variant.dataset.variant);
      selectedVariants.set(id, record.key);
      const index = filtered.findIndex(r => r.id === id);
      filtered[index] = record;
      const previous = variant.closest('.banner-row');
      const template = document.createElement('template');
      template.innerHTML = card(record, index + 1);
      const replacement = template.content.firstElementChild;
      previous.replaceWith(replacement);
      prepareImages(replacement);
      updateCityOverflow(replacement);
      return;
    }
    const copyButton=e.target.closest('[data-copy]');if(copyButton){copy(copyButton.dataset.copy);return;}
    const image=e.target.closest('[data-preview]');
    if(image?.classList.contains('is-error')){
      image.classList.remove('is-error');image.classList.add('is-loading');
      image.querySelector('.image-load-state').textContent='加载中…';
      const img=image.querySelector('img');img.src=img.src;
      return;
    }
    if(image)openPreview(image.dataset.preview,image.dataset.version || '7.0');
  });
  $('preview-close').addEventListener('click',()=>$('preview').close());
  $('preview').addEventListener('click',e=>{if(e.target===$('preview')){const r=$('preview').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('preview').close();}});
  $('preview-prev').addEventListener('click',()=>{if(previewIndex>0)setPreview(previewIndex-1);});
  $('preview-next').addEventListener('click',()=>{if(previewIndex<previewRecords.length-1)setPreview(previewIndex+1);});
  document.addEventListener('keydown',e=>{
    if($('preview').open){if(e.key==='ArrowLeft'&&previewIndex>0){e.preventDefault();setPreview(previewIndex-1);}if(e.key==='ArrowRight'&&previewIndex<previewRecords.length-1){e.preventDefault();setPreview(previewIndex+1);}return;}
    if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}
  });
  $('index-steps').addEventListener('click', event => {
    const step = event.target.closest('[data-section]');
    if (step) jumpToSection(Number(step.dataset.section));
  });
  $('back-to-top').addEventListener('click', scrollToTop);
  ['wheel','touchstart','pointerdown'].forEach(type => window.addEventListener(type, cancelScrollToTop, {passive:true}));
  window.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) cancelScrollToTop();
  });
  window.addEventListener('scroll', scheduleNavigationUpdate, {passive:true});
  window.addEventListener('resize', scheduleNavigationUpdate, {passive:true});
  new ResizeObserver(scheduleNavigationUpdate).observe($('banner-list'));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, {rootMargin: `${preloadDistance}px 0px`});
    observer.observe($('load-more'));
  } else {
    window.addEventListener('scroll', maybeLoadMore, {passive:true});
  }
  render();
  let metaWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== metaWidth) {metaWidth = width; updateCityOverflow();}
  }).observe($('banner-list'));
  document.fonts.ready.then(() => updateCityOverflow());
})();
