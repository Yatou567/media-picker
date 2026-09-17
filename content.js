(() => {
  if (globalThis.__mediaPicker) return;
  const state = globalThis.__mediaPicker = {dirty: true, cache: null, picker: null};
  const labels = {image: '图片', video: '视频', audio: '音频'};
  const extensions = {image: /\.(avif|webp|png|jpe?g|gif|svg|bmp|ico|tiff?)(?:$|[?#])/i, video: /\.(mp4|webm|mov|m4v|ogv|mkv|avi|m3u8|mpd|ts)(?:$|[?#])/i, audio: /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|aiff)(?:$|[?#])/i};
  try { new PerformanceObserver(() => {state.dirty = true;}).observe({type: 'resource', buffered: true}); } catch {}
  const observed = new WeakSet();
  const listeners = new WeakSet();
  function kind(url) { return Object.keys(extensions).find(key => extensions[key].test(url)) || (/^data:(image|video|audio)\//i.exec(url)?.[1]?.toLowerCase()); }
  function normalize(raw, base) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      const url = new URL(raw.trim(), base);
      if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return null;
      if (url.protocol === 'data:' && !/^data:(image|video|audio)\//i.test(raw)) return null;
      // Preserve queries and fragments: signed links and SVG fragments can depend on them.
      return url.href;
    } catch { return null; }
  }
  function srcset(value) {
    // URLs may contain commas (notably data URLs); descriptors end at commas.
    const urls = []; let i = 0;
    while (i < value.length) {
      while (/[\s,]/.test(value[i] || '') && i < value.length) i++;
      let url = '';
      while (i < value.length && !/\s/.test(value[i])) url += value[i++];
      if (!url) break;
      if (url.endsWith(',')) { urls.push(url.replace(/,+$/, '')); continue; }
      urls.push(url);
      while (i < value.length && value[i] !== ',') i++;
      i++;
    }
    return urls;
  }
  function collector() {
    const map = new Map();
    function add(raw, type, el, source) {
      const url = normalize(raw, el?.baseURI || document.baseURI);
      if (!url) return;
      type = type || kind(url);
      if (!type) return;
      const existing = map.get(url);
      if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); return; }
      const stream = /\.(m3u8|mpd|ts)(?:$|[?#])/i.test(url);
      const reason = url.startsWith('blob:') ? '页面临时资源，暂不支持直接下载' : stream ? '分片 / 播放清单，不能直接下载完整视频' : '';
      let name;
      try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { name = ''; }
      if (url.startsWith('data:') || url.startsWith('blob:')) name = `${labels[type]} · ${url.startsWith('data:') ? '内嵌资源' : '临时资源'}`;
      map.set(url, {url, type, name: name || `${labels[type]}资源`, title: (el?.getAttribute?.('alt') || el?.getAttribute?.('title') || '').slice(0, 180), width: el?.naturalWidth || el?.videoWidth || 0, height: el?.naturalHeight || el?.videoHeight || 0, sources: [source], reason});
    }
    return {add, values: () => [...map.values()]};
  }
  function inspect(el, c, css = true) {
    const tag = el.localName;
    if (tag === 'img' || (tag === 'input' && el.type === 'image')) {
      c.add(el.currentSrc, 'image', el, '当前图片'); c.add(el.getAttribute('src'), 'image', el, '图片');
      for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-url']) c.add(el.getAttribute(attr), 'image', el, '懒加载');
      for (const attr of ['srcset', 'data-srcset']) for (const url of srcset(el.getAttribute(attr) || '')) c.add(url, 'image', el, '响应式图片');
    }
    if (tag === 'video' || tag === 'audio') {
      c.add(el.currentSrc, tag, el, '正在播放'); c.add(el.getAttribute('src'), tag, el, '媒体元素');
      if (tag === 'video') c.add(el.poster, 'image', el, '视频封面');
    }
    if (tag === 'source') {
      const parent = el.parentElement?.localName;
      const type = parent === 'audio' ? 'audio' : parent === 'video' ? 'video' : 'image';
      c.add(el.getAttribute('src'), type, el, '媒体来源');
      for (const url of srcset(el.getAttribute('srcset') || '')) c.add(url, type, el, '响应式图片');
    }
    if (tag === 'a') c.add(el.href, null, el, '资源链接');
    if (tag === 'image') c.add(el.getAttribute('href') || el.getAttribute('xlink:href'), 'image', el, 'SVG 图片');
    if (tag === 'svg' && !el.parentElement?.closest('svg')) {
      const clone = el.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      c.add('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)), 'image', el, '内嵌 SVG');
    }
    if (css && el.ownerDocument.defaultView) {
      for (const pseudo of [null, '::before', '::after']) {
        const style = el.ownerDocument.defaultView.getComputedStyle(el, pseudo);
        const value = style.backgroundImage;
        for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) c.add(match[1] || match[2] || match[3], 'image', el, '背景图片');
      }
    }
  }
  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    new MutationObserver(() => { state.dirty = true; }).observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'href', 'poster', 'style', 'class', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset', 'data-url']});
    root.addEventListener('load', () => {state.dirty = true;}, true);
    root.addEventListener('loadedmetadata', () => {state.dirty = true;}, true);
  }
  function scan(force) {
    if (!force && state.cache && !state.dirty) return state.cache;
    const c = collector(); let blockedFrames = 0;
    function visit(root) {
      observe(root);
      for (const el of root.querySelectorAll('*')) {
        if (el === state.picker?.host) continue;
        inspect(el, c);
        if (el.shadowRoot) visit(el.shadowRoot);
        if (el.localName === 'iframe') {
          try { if (el.contentDocument) visit(el.contentDocument); else blockedFrames++; } catch {blockedFrames++;}
        }
      }
      if (root.nodeType === 9) {
        try {
          for (const entry of root.defaultView.performance.getEntriesByType('resource')) c.add(entry.name, kind(entry.name) || ({img:'image',video:'video',audio:'audio'}[entry.initiatorType]), null, '已加载资源');
        } catch { /* A frame can navigate while being scanned. */ }
      }
    }
    visit(document);
    state.dirty = false;
    return state.cache = {items: c.values(), title: document.title, blockedFrames};
  }
  function endPicker() { state.picker?.cleanup(); state.picker = null; }
  function startPicker() {
    endPicker();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow = host.attachShadow({mode:'closed'});
    shadow.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}.box{position:fixed;border:2px solid #61e2c2;background:#61e2c222;pointer-events:none}.panel{position:fixed;right:24px;top:24px;width:360px;max-height:80vh;overflow:auto;background:#122324;color:#f3fffb;border:1px solid #45645f;border-radius:16px;padding:18px;font:14px/1.6 system-ui;box-shadow:0 12px 50px #0005;pointer-events:auto}b{font-size:17px}p{color:#adc7c0;margin:8px 0}button{font:inherit;cursor:pointer;border:0;border-radius:8px;background:#a4f4d4;color:#122324;padding:7px 12px}button:disabled{opacity:.45;cursor:default}.close{float:right;background:#294441;color:white}.row{border-top:1px solid #35514b;padding:12px 0}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{font-size:12px;color:#adc7c0;margin:4px 0}.actions{display:flex;gap:8px}</style><div class="box" hidden></div><section class="panel"><button class="close" aria-label="关闭">✕</button><b>点选网页资源</b><p class="tip">移动鼠标高亮元素，点击选择。按 Esc 退出。</p><div class="results"></div></section>`;
    document.documentElement.append(host);
    const box = shadow.querySelector('.box'), tip = shadow.querySelector('.tip'), results = shadow.querySelector('.results');
    let frozen = false;
    const cleanups = [];
    function own(e) { return e.composedPath().includes(host); }
    function find(e) {
      let el = e.composedPath().find(n => n?.nodeType === 1);
      if (el?.closest('svg')) el = el.closest('svg');
      return el;
    }
    function move(e) {
      if (own(e) || frozen) return;
      const el = find(e); if (!el) return;
      let r = el.getBoundingClientRect(), left = r.left, top = r.top;
      let win = el.ownerDocument.defaultView;
      while (win && win !== window) { const frame = win.frameElement; if (!frame) break; const f = frame.getBoundingClientRect(); left += f.left + frame.clientLeft; top += f.top + frame.clientTop; win = frame.ownerDocument.defaultView; }
      box.hidden = false; Object.assign(box.style, {left:left+'px', top:top+'px', width:r.width+'px', height:r.height+'px'});
    }
    async function copy(url, button) { try { await navigator.clipboard.writeText(url); button.textContent = '已复制'; } catch {tip.textContent = '复制失败，请在插件资源列表中复制。';} }
    function click(e) {
      if (own(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (frozen) return;
      const el = find(e); if (!el) return;
      const c = collector();
      inspect(el, c);
      const parentMedia = el.closest('video,audio,picture');
      if (parentMedia && parentMedia !== el) inspect(parentMedia, c);
      function descendants(root) { for (const child of root.querySelectorAll('*')) {inspect(child,c); if(child.shadowRoot) descendants(child.shadowRoot);} }
      descendants(parentMedia || el); if (el.shadowRoot) descendants(el.shadowRoot);
      const items = c.values();
      if (!items.length) {tip.textContent = '这个元素没有可识别的资源，请尝试点击图片、播放器或其外层容器。'; return;}
      frozen = true; results.replaceChildren(); tip.textContent = `找到 ${items.length} 个资源，点击下载或复制链接。`;
      const again = document.createElement('button'); again.textContent = '继续选择'; again.onclick = () => {frozen = false; results.replaceChildren(); tip.textContent = '移动鼠标高亮元素，点击选择。按 Esc 退出。';}; results.append(again);
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'row';
        const name = document.createElement('div'); name.className = 'name'; name.textContent = item.title || item.name; name.title = item.url;
        const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${labels[item.type]} · ${item.reason || item.sources.join(' / ')}`;
        const actions = document.createElement('div'); actions.className = 'actions';
        const download = document.createElement('button'); download.textContent = '下载'; download.disabled = !!item.reason;
        download.onclick = async () => {
          download.disabled = true;
          try { const reply = await chrome.runtime.sendMessage({type:'MP_DOWNLOAD',items:[item],saveAs:true}); const result = reply?.results?.[0]; if (reply?.error || result?.error || !result) throw new Error(reply?.error || result?.error || '扩展无响应'); download.textContent = '已交给 Chrome'; }
          catch(error) {tip.textContent = '下载失败：'+error.message; download.disabled = false;}
        };
        const cp = document.createElement('button'); cp.textContent = '复制链接'; cp.onclick = () => copy(item.url,cp);
        actions.append(download,cp); row.append(name,meta,actions); results.append(row);
      }
    }
    function key(e) { if(e.key === 'Escape') {e.preventDefault();e.stopImmediatePropagation();endPicker();} }
    function bind(doc) {
      if (listeners.has(doc)) return;
      listeners.add(doc);
      doc.addEventListener('pointermove',move,true); doc.addEventListener('click',click,true); doc.addEventListener('keydown',key,true);
      cleanups.push(() => {doc.removeEventListener('pointermove',move,true);doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',key,true);listeners.delete(doc);});
      for (const frame of doc.querySelectorAll('iframe')) {try{if(frame.contentDocument) bind(frame.contentDocument);}catch{}}
    }
    bind(document); shadow.querySelector('.close').onclick = endPicker;
    state.picker = {host, cleanup:() => {for(const fn of cleanups) fn();host.remove();}};
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'MP_SCAN') { try {respond(scan(message.force));} catch(error){respond({error:error.message});} }
    if (message?.type === 'MP_PICK') {startPicker();respond({ok:true});}
  });
})();
