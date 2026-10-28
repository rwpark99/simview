import fs from 'node:fs'; import zlib from 'node:zlib';
const files = {'/index.html':'text/html; charset=utf-8','/app.js':'application/javascript; charset=utf-8','/sw.js':'application/javascript; charset=utf-8','/manifest.webmanifest':'application/manifest+json','/icon-192.png':'image/png','/icon-512.png':'image/png','/version.json':'application/json','/THIRD_PARTY_NOTICES.txt':'text/plain; charset=utf-8','/pdf.min.mjs':'text/javascript; charset=utf-8','/pdf.worker.min.mjs':'text/javascript; charset=utf-8'};
const F = Object.fromEntries(Object.entries(files).map(([p,ct])=>[p,[ct,zlib.gzipSync(fs.readFileSync('dist'+p),{level:9}).toString('base64')]]));
const worker = `const F=${JSON.stringify(F)};const C={};
export default{async fetch(req){const u=new URL(req.url);let p=u.pathname;if(p==='/'||p==='')p='/index.html';
if(req.method==='POST'&&p==='/share')return new Response('Service worker not active yet. Open the app once, then share again.',{status:200,headers:{'content-type':'text/plain; charset=utf-8'}});
const f=F[p];if(!f)return new Response('Not found',{status:404});
if(!C[p]){const s=atob(f[1]);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);C[p]=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
return new Response(C[p],{headers:{'content-type':f[0],'cache-control':p==='/version.json'?'no-store':/\.png$/.test(p)?'public, max-age=3600':'no-cache','x-content-type-options':'nosniff'}});}};`;
const code = `async () => {
const W = ${JSON.stringify(worker)};
const name='simview'; const b='----F'+Date.now();
const meta={main_module:'worker.js',compatibility_date:'2026-10-01'};
const body=['--'+b,'Content-Disposition: form-data; name="metadata"','Content-Type: application/json','',JSON.stringify(meta),'--'+b,'Content-Disposition: form-data; name="worker.js"; filename="worker.js"','Content-Type: application/javascript+module','',W,'--'+b+'--',''].join('\\r\\n');
const up = await cloudflare.request({method:'PUT',path:\`/accounts/\${accountId}/workers/scripts/\${name}\`,body,contentType:'multipart/form-data; boundary='+b,rawBody:true});
const en = await cloudflare.request({method:'POST',path:\`/accounts/\${accountId}/workers/scripts/\${name}/subdomain\`,body:{enabled:true}}).catch(e=>String(e));
const sd = await cloudflare.request({method:'GET',path:\`/accounts/\${accountId}/workers/subdomain\`}).catch(e=>String(e));
return {ok:up.success, en: en.success ?? en, sd: sd.result ?? sd};
}`;
fs.writeFileSync('/workspace/cf-worker.js', code); console.log(code.length);
