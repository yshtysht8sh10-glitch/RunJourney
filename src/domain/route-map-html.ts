import type { RoutePreview } from './route-preview';
/** Local, self-contained renderer. No CDN, telemetry or coordinate-bearing URLs. */
export function routeMapHtml(preview:RoutePreview,tiles:boolean) {
  return `<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${tiles?'https://tile.openstreetmap.org':"'none'"}; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>
body{margin:0;background:#e9eee9;font-family:sans-serif}svg{display:block;width:100vw;height:320px;touch-action:none}#controls{position:absolute;top:8px;left:8px;display:flex;gap:8px}button{min-width:48px;min-height:48px;font-size:18px;background:#fff;border:1px solid #555;border-radius:8px}#credit{position:absolute;right:3px;top:296px;background:#fff;font-size:12px;padding:3px}#status{font-size:12px;background:#fff;margin:0;padding:6px}</style></head><body>
<svg id="map" aria-label="保存GPSの軌跡"></svg><div id="controls"><button id="plus" aria-label="拡大">＋</button><button id="minus" aria-label="縮小">－</button><button id="fit">全体</button></div><div id="credit">${tiles?'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors':'背景地図OFF / 端末内の軌跡'}</div><p id="status">線：GPSの表示用サンプル。緑：開始、赤：終了。ドラッグで移動できます。</p><script>
const data=${JSON.stringify(preview.points)},bounds=${JSON.stringify(preview.bounds)},online=${tiles};
const svg=document.getElementById('map');let cx=.5,cy=.5,z=0,drag=null;
function fit(){cx=(bounds[0]+bounds[2])/2;cy=(bounds[1]+bounds[3])/2;z=Math.max(0,Math.min(18,Math.floor(Math.log2(Math.min((innerWidth-40)/Math.max(bounds[2]-bounds[0],1e-9),280/Math.max(bounds[3]-bounds[1],1e-9))/256))));draw();}
function draw(){const w=innerWidth,h=320,s=256*Math.pow(2,z),left=cx*s-w/2,top=cy*s-h/2,n=Math.pow(2,z);let content='';
if(online){let count=0;for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++)if(x>=0&&x<n&&y>=0&&y<n&&count++<24)content+='<image x="'+(x*256-left)+'" y="'+(y*256-top)+'" width="256" height="256" href="https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png"/>';}
let d='';data.forEach((p,i)=>{d+=(p[2]||i===0?'M':'L')+(p[0]*s-left).toFixed(2)+','+(p[1]*s-top).toFixed(2)+' ';});content+='<path d="'+d+'" stroke="#d85130" stroke-width="4" fill="none"/>';
[data[0],data[data.length-1]].forEach((p,i)=>{if(p)content+='<circle cx="'+(p[0]*s-left)+'" cy="'+(p[1]*s-top)+'" r="6" fill="'+(i?'#b92330':'#087c56')+'" stroke="white" stroke-width="2"/>';});svg.innerHTML=content;svg.querySelectorAll('image').forEach(image=>{image.onerror=()=>{document.getElementById('status').textContent='背景地図を取得できません。軌跡は端末内のデータです。';};});}
document.getElementById('plus').onclick=()=>{z=Math.min(18,z+1);draw();};document.getElementById('minus').onclick=()=>{z=Math.max(0,z-1);draw();};document.getElementById('fit').onclick=fit;
svg.onpointerdown=e=>{drag=[e.clientX,e.clientY];svg.setPointerCapture(e.pointerId);};svg.onpointermove=e=>{if(!drag)return;const s=256*Math.pow(2,z);cx=Math.max(0,Math.min(1,cx-(e.clientX-drag[0])/s));cy=Math.max(0,Math.min(1,cy-(e.clientY-drag[1])/s));drag=[e.clientX,e.clientY];draw();};svg.onpointerup=()=>{drag=null;};svg.onpointercancel=()=>{drag=null;};window.onresize=draw;fit();
</script></body></html>`;
}
