const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const dir = require('path').join(__dirname, '..') + require('path').sep;
let checks = 0;
function test(name, fn) {fn();checks++;console.log('PASS',name);}
// Small DOM fixture: real browser layout / Chrome permission checks are outside this test.
class Element {
  constructor(tag, attrs={},children=[]) {this.localName=tag;this.attrs=attrs;this.children=children;this.nodeType=1;this.baseURI='https://example.test/page/';this.naturalWidth=0;this.naturalHeight=0;this.style={};for(const c of children)c.parentElement=this;this.currentSrc='';this.ownerDocument=null;this.poster=attrs.poster||'';this.type=attrs.type;this.bg=attrs.background||'none';}
  getAttribute(k){return this.attrs[k]??null;}
  setAttribute(k,v){this.attrs[k]=v;}
  get href(){return this.attrs.href ? new URL(this.attrs.href,this.baseURI).href : '';}
  querySelectorAll(){return this.children.flatMap(x=>[x,...x.querySelectorAll('*')]);}
  closest(tag){let p=this;while(p){if(tag.split(',').includes(p.localName))return p;p=p.parentElement;}return null;}
  addEventListener(){}
  cloneNode(){return new Element(this.localName,{...this.attrs},[]);}
}
const picture = new Element('picture',{},[new Element('source',{srcset:'/responsive-1.webp 1x, /responsive-2.webp 2x'}),new Element('img',{src:'/photo.png',alt:'测试图片','data-src':'/original.jpg',srcset:'/small.jpg 480w, /large.jpg 1200w'})]);
const photo=picture.children[1];photo.currentSrc='https://example.test/photo.png';photo.naturalWidth=800;photo.naturalHeight=600;
const vid = new Element('video',{src:'/movie.mp4',poster:'https://example.test/poster.jpg'},[new Element('source',{src:'/movie.webm'})]);
const audio = new Element('audio',{},[new Element('source',{src:'/music.mp3'})]);
const bg = new Element('div',{background:'url("https://example.test/bg.png")'});
const scriptLink = new Element('a',{href:'javascript:alert(1)'});
const stream = new Element('a',{href:'/live.m3u8?token=a%2Fb'});
const blob = new Element('video',{src:'blob:https://example.test/abc'});
const lazy = new Element('img',{'data-original':'/lazy.jpg'});
const inline = new Element('img',{src:'data:image/png;base64,AAAA',srcset:'data:image/png;base64,AAAA 1x, /two.png 2x'});
const svg = new Element('svg');
const frame = new Element('iframe');frame.contentDocument=null;
const shadowHost = new Element('div');shadowHost.shadowRoot=new Element('shadow',{},[new Element('img',{src:'/shadow.png'})]);
const doc = new Element('document',{},[picture,vid,audio,bg,scriptLink,stream,blob,lazy,inline,svg,frame,shadowHost]);doc.nodeType=9;doc.baseURI='https://example.test/page/';doc.title='测试网页';
const performance={getEntriesByType:()=>[{name:'https://cdn.example.test/network.mp4?sign=abc%2Fdef',initiatorType:'fetch'},{name:'https://example.test/photo.png',initiatorType:'img'}]};
const view={getComputedStyle:(el,pseudo)=>({backgroundImage:pseudo?'none':el.bg}),performance};doc.defaultView=view;
for(const el of [doc,...doc.querySelectorAll('*'),...shadowHost.shadowRoot.querySelectorAll('*')])el.ownerDocument=doc;
let onMessage, mutations=[];
const ctx=vm.createContext({URL,Map,WeakSet,XMLSerializer:class{serializeToString(){return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';}},MutationObserver:class{constructor(fn){mutations.push(fn)}observe(){}},PerformanceObserver:class{observe(){}},document:doc,window:view,chrome:{runtime:{id:'test',onMessage:{addListener:fn=>onMessage=fn}}}});
vm.runInContext(fs.readFileSync(dir+'content.js','utf8'),ctx);
function scan(force=true){let response;onMessage({type:'MP_SCAN',force},{id:'test'},r=>response=r);assert(!response.error,response.error);return response;}
let result=scan();
function has(path,type){assert(result.items.some(x=>x.url.includes(path)&&(!type||x.type===type)),`missing ${path} ${type}`);}
test('图片、视频、音频与背景分类',()=>{has('/photo.png','image');has('/movie.mp4','video');has('/movie.webm','video');has('/music.mp3','audio');has('/bg.png','image');has('/poster.jpg','image');});
test('响应式图片与懒加载',()=>{for(const p of ['/responsive-1.webp','/responsive-2.webp','/small.jpg','/large.jpg','/original.jpg','/lazy.jpg','/two.png'])has(p,'image');});
test('当前图片与网络记录去重',()=>{assert.equal(result.items.filter(x=>x.url.endsWith('/photo.png')).length,1);assert.equal(result.items.find(x=>x.url.endsWith('/photo.png')).width,800);});
test('带签名链接完整保留',()=>has('network.mp4?sign=abc%2Fdef','video'));
test('流媒体和临时链接明确标记不可直下',()=>{assert(result.items.find(x=>x.url.includes('live.m3u8')).reason);assert(result.items.find(x=>x.url.startsWith('blob:')).reason);});
test('忽略脚本链接',()=>assert(!result.items.some(x=>x.url.startsWith('javascript:'))));
test('内嵌图片、SVG 与开放 Shadow DOM',()=>{has('data:image/png;base64,AAAA','image');has('data:image/svg+xml','image');has('/shadow.png','image');});
test('跨域框架限制计数',()=>assert.equal(result.blockedFrames,1));
test('动态页面变更刷新缓存',()=>{const el=new Element('img',{src:'/added.jpg'});el.ownerDocument=doc;doc.children.push(el);mutations.forEach(fn=>fn());result=scan(false);has('/added.jpg','image');});
test('重复注入不会重复注册',()=>{let original=onMessage;vm.runInContext(fs.readFileSync(dir+'content.js','utf8'),ctx);assert.equal(onMessage,original);});
let handler, calls=[],serial=0;
const bctx=vm.createContext({chrome:{runtime:{id:'test',onMessage:{addListener:fn=>handler=fn}},downloads:{download:async options=>{calls.push(options);if(options.url.includes('fail'))throw new Error('SERVER_FORBIDDEN');return serial++;}}},Date});
vm.runInContext(fs.readFileSync(dir+'background.js','utf8'),bctx);
function send(msg,sender={id:'test'}){return new Promise(resolve=>handler(msg,sender,resolve));}
(async()=>{
 const answer=await send({type:'MP_DOWNLOAD',saveAs:false,items:[{url:'https://example.test/photo.png?a=b'},{url:'https://example.test/fail.mp4'},{url:'javascript:alert(1)'},{url:'blob:https://example.test/abc'},{url:'https://example.test/live.m3u8'},{url:'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E'}]});
 test('批量错误隔离，继续后续下载',()=>{assert.equal(answer.results.length,6);assert.equal(answer.results.filter(x=>x.error).length,4);assert.equal(answer.results[0].id,0);assert.equal(answer.results[5].id,1);});
 test('保存参数与内嵌 SVG 文件扩展名',()=>{assert.equal(calls[0].saveAs,false);assert.equal(calls[0].conflictAction,'uniquify');assert(calls.at(-1).filename.endsWith('.svg'));});
 const single=await send({type:'MP_DOWNLOAD',saveAs:true,items:[{url:'https://example.test/music.mp3'}]});
 test('单项另存为',()=>{assert.equal(calls.at(-1).saveAs,true);assert.equal(single.results.length,1);});
 const cap=await send({type:'MP_DOWNLOAD',items:Array.from({length:102},()=>({url:'https://example.test/a.png'}))});
 test('限制批量为 100 项',()=>assert.equal(cap.results.length,100));
 test('拒绝非本扩展消息',()=>assert.equal(handler({type:'MP_DOWNLOAD',items:[]},{id:'other'},()=>{throw Error('unexpected')}),undefined));
 const manifest=JSON.parse(fs.readFileSync(dir+'manifest.json'));
 test('Manifest V3 与最小权限',()=>{assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['activeTab','scripting','downloads']);assert(!manifest.host_permissions);for(const file of ['background.js','content.js','popup.js','popup.css',manifest.action.default_popup,...Object.values(manifest.icons)])assert(fs.existsSync(dir+file),file);});
 console.log(`\n${checks} checks passed. Browser installation and real downloads not covered.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
