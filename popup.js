const $ = selector => document.querySelector(selector);
const names = {image:'图片',video:'视频',audio:'音频'};
let tabId, items = [], filter = 'all', scanning = false, busy = false, fingerprint = '';
const selected = new Set(), downloads = new Map();
function status(text, error = false) {$('#status').textContent = text;$('#status').className = error ? 'error' : '';}
function filtered() {const query = $('#search').value.trim().toLowerCase();return items.filter(item => (filter === 'all' || item.type === filter) && (!query || [item.name,item.title,item.url].join(' ').toLowerCase().includes(query)));}
function syncSelection() {
  const available = filtered().filter(item => !item.reason);
  $('#all').checked = available.length > 0 && available.every(item => selected.has(item.url));
  $('#all').indeterminate = available.some(item => selected.has(item.url)) && !$('#all').checked;
  $('#selected').textContent = `已选 ${selected.size} 项`;
  $('#batch').disabled = selected.size === 0 || busy;
  $('#batch').textContent = busy ? '正在提交…' : '↓ 下载所选';
}
async function copy(url, button) {
  try {await navigator.clipboard.writeText(url);button.textContent = '已复制';setTimeout(() => {if(button.isConnected) button.textContent = '复制';},1400);}
  catch {status('无法访问剪贴板，请重试。',true);}
}
function render() {
  const list = $('#list'), oldScroll = list.scrollTop; list.replaceChildren();
  for (const button of document.querySelectorAll('nav button')) {const type = button.dataset.filter;button.classList.toggle('active',type === filter);button.querySelector('span').textContent = items.filter(item => type === 'all' || item.type === type).length;}
  const visible = filtered(); $('#count').textContent = `${visible.length} 个资源`;
  if (!visible.length) {const empty = document.createElement('div');empty.className = 'empty';empty.textContent = items.length ? '没有匹配的资源，试试其他关键词。' : '暂未发现资源。\n可先滚动页面、播放媒体，再重新打开插件。';list.append(empty);}
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const card = document.createElement('article');card.className = 'card';
    const checkbox = document.createElement('input');checkbox.type = 'checkbox';checkbox.checked = selected.has(item.url);checkbox.disabled = !!item.reason;checkbox.setAttribute('aria-label',`选择 ${item.name}`);checkbox.onchange = () => {checkbox.checked ? selected.add(item.url) : selected.delete(item.url);syncSelection();};
    const thumb = document.createElement('div');thumb.className = 'thumb';thumb.textContent = {image:'▧',video:'▷',audio:'♫'}[item.type];
    if(item.type === 'image' && !item.reason) {const img = document.createElement('img');img.alt = '';img.loading = 'lazy';img.referrerPolicy = 'no-referrer';img.src = item.url;img.onerror = () => {img.remove();thumb.textContent = '▧';};thumb.replaceChildren(img);}
    const info = document.createElement('div');info.className = 'info';
    const name = document.createElement('div');name.className = 'name';name.textContent = item.title || item.name;name.title = item.name;
    const meta = document.createElement('div');meta.className = 'meta';const progress = downloads.get(item.url);meta.textContent = item.reason || (progress?.text || `${names[item.type]}${item.width ? ' · '+item.width+' × '+item.height : ''} · ${item.sources.join(' / ')}`);if(progress?.error) meta.classList.add('download-error');meta.title = meta.textContent;
    const url = document.createElement('div');url.className = 'url';url.textContent = item.url.startsWith('data:') ? '内嵌于页面的媒体资源' : item.url;url.title = item.url;
    info.append(name,meta,url);
    const actions = document.createElement('div');actions.className = 'actions';
    const dl = document.createElement('button');dl.textContent = '↓ 下载';dl.disabled = !!item.reason || busy;dl.title = item.reason || '选择保存位置并下载';dl.onclick = () => download([item],true);
    const cp = document.createElement('button');cp.textContent = '复制';cp.onclick = () => copy(item.url,cp);actions.append(dl,cp);card.append(checkbox,thumb,info,actions);fragment.append(card);
  }
  list.append(fragment);list.scrollTop = oldScroll;syncSelection();
}
async function download(chosen, saveAs) {
  if(busy) return;
  if(chosen.length > 100) {status('每次最多下载 100 项，请减少选择后重试。',true);return;}
  busy = true;render();status(`正在提交 ${chosen.length} 项下载…`);
  try {
    const reply = await chrome.runtime.sendMessage({type:'MP_DOWNLOAD',items:chosen.map(item => ({url:item.url})),saveAs});
    if(!reply || reply.error) throw new Error(reply?.error || '下载服务无响应');
    let success = 0;
    for(const result of reply.results) {
      if(result.error) downloads.set(result.url,{text:result.error,error:true});
      else {success++;downloads.set(result.url,{id:result.id,text:'正在下载…'});selected.delete(result.url);}
    }
    status(`已提交 ${success} 项；失败 ${reply.results.length-success} 项。完成状态请看 Chrome 下载记录。`,success < reply.results.length);
  } catch(error) {status('下载失败：'+error.message,true);}
  finally {busy = false;render();}
}
async function progress() {
  let changed = false;
  for(const [url, value] of downloads) {
    if(value.id === undefined || value.done) continue;
    try {const [item] = await chrome.downloads.search({id:value.id});if(!item) continue;const text = item.state === 'complete' ? '已下载完成' : item.state === 'interrupted' ? `下载失败：${item.error || '已中断'}` : '正在下载…';if(text !== value.text) {downloads.set(url,{...value,text,error:item.state === 'interrupted',done:item.state !== 'in_progress'});changed = true;}} catch{}
  }
  if(changed) render();
}
async function scan(force = false) {
  if(scanning || !tabId) return;scanning = true;$('#refresh').disabled = true;
  try {
    const response = await chrome.tabs.sendMessage(tabId,{type:'MP_SCAN',force});
    if(response.error) throw new Error(response.error);
    $('#pageTitle').textContent = response.title || '当前页面';
    $('#coverage').textContent = `自动更新已发现资源；滚动或播放后可刷新。${response.blockedFrames ? `另有 ${response.blockedFrames} 个跨域框架不可访问，可在新标签页打开其内容后扫描。` : '不支持 DRM、分片合并和 blob 临时资源。'}`;
    const next = JSON.stringify(response.items);
    if(next !== fingerprint) {fingerprint = next;items = response.items;const allowed = new Set(items.filter(x=>!x.reason).map(x=>x.url));for(const url of selected) if(!allowed.has(url)) selected.delete(url);render();}
    if(force) status(`扫描完成，发现 ${items.length} 个资源。`);
  }catch(error) {status('无法读取页面，请刷新网页后重新打开插件。'+error.message,true);}
  finally {scanning = false;$('#refresh').disabled = false;}
}
$('#search').addEventListener('input',render);
for(const button of document.querySelectorAll('nav button')) button.onclick = () => {filter = button.dataset.filter;render();};
$('#all').onchange = () => {for(const item of filtered()) if(!item.reason) $('#all').checked ? selected.add(item.url) : selected.delete(item.url);render();};
$('#batch').onclick = () => download(items.filter(item => selected.has(item.url)),false);
$('#refresh').onclick = () => scan(true);
$('#pick').onclick = async () => {try {const reply = await chrome.tabs.sendMessage(tabId,{type:'MP_PICK'});if(!reply?.ok) throw new Error('选择器启动失败');window.close();}catch(error){status(error.message,true);}};
(async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('请在普通 http/https 网页使用；Chrome 内部页、商店页面和 PDF 查看器不支持。');
    tabId = tab.id;
    await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
    await scan(true);
    setInterval(async () => {await scan();await progress();},2000);
  } catch(error) {$('#list').replaceChildren();const empty = document.createElement('div');empty.className = 'empty';empty.textContent = '此页面无法扫描\n请打开普通网页再试。';$('#list').append(empty);$('#count').textContent = '无法访问';$('#pick').disabled = true;$('#refresh').disabled = true;status(error.message,true);}
})();
