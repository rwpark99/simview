import fs from 'node:fs'; import { blake3 } from '@noble/hashes/blake3.js';
const files = ['index.html','app.js','sw.js','manifest.webmanifest','icon-192.png','icon-512.png'];
const CT = {html:'text/html',js:'application/javascript',webmanifest:'application/manifest+json',png:'image/png'};
const hex = u => Buffer.from(u).toString('hex');
const assets = files.map(f => { const b64 = fs.readFileSync('dist/'+f).toString('base64'); const ext = f.split('.').pop();
  return { f, key: hex(blake3(new TextEncoder().encode(b64 + ext))).slice(0,32), b64, ct: CT[ext] }; });
const code = `async () => {
const A = ${JSON.stringify(assets)};
const P = 'hwp-viewer';
let name = P;
let c = await cloudflare.request({method:'POST', path:\`/accounts/\${accountId}/pages/projects\`, body:{name:P, production_branch:'main'}}).catch(e=>({err:String(e)}));
if (c.err) { if (!/already|exist|taken/i.test(c.err)) return {step:'create', err:c.err}; name = 'hwp-viewer-rw';
  c = await cloudflare.request({method:'POST', path:\`/accounts/\${accountId}/pages/projects\`, body:{name, production_branch:'main'}}).catch(e=>({err:String(e)}));
  if (c.err && !/already exist/i.test(c.err)) return {step:'create2', err:c.err}; }
const t = await cloudflare.request({method:'GET', path:\`/accounts/\${accountId}/pages/projects/\${name}/upload-token\`});
const jwt = t.result.jwt; const H = {Authorization:'Bearer '+jwt,'Content-Type':'application/json'}; const API='https://api.cloudflare.com/client/v4';
const up = await fetch(API+'/pages/assets/upload',{method:'POST',headers:H,body:JSON.stringify(A.map(a=>({key:a.key,value:a.b64,metadata:{contentType:a.ct},base64:true})))});
const upj = await up.json(); if (!upj.success) return {step:'upload', upj};
const us = await (await fetch(API+'/pages/assets/upsert-hashes',{method:'POST',headers:H,body:JSON.stringify({hashes:A.map(a=>a.key)})})).json();
const manifest = Object.fromEntries(A.map(a=>['/'+a.f,a.key]));
const b='----F'+Date.now(); const body=['--'+b,'Content-Disposition: form-data; name="manifest"','',JSON.stringify(manifest),'--'+b,'Content-Disposition: form-data; name="branch"','','main','--'+b+'--',''].join('\\r\\n');
const d = await cloudflare.request({method:'POST', path:\`/accounts/\${accountId}/pages/projects/\${name}/deployments\`, body, contentType:'multipart/form-data; boundary='+b, rawBody:true});
return {name, upsert:us.success, url:d.result.url, id:d.result.id, stage:d.result.latest_stage, sub:(c.result||{}).subdomain};
}`;
fs.writeFileSync('/workspace/cf-deploy.js', code); console.log(code.length, assets.map(a=>a.f+':'+a.key).join(' '));
