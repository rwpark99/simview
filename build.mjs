import * as esbuild from 'esbuild';
const empty = new URL('./shims/empty.js', import.meta.url).pathname;
import { builtinModules } from 'node:module';
const nodeMods0 = ['fs','fs/promises','path','os','crypto','url','module','child_process','worker_threads','util','stream','net','tls','http','https','events','readline','assert','v8','perf_hooks'];
const alias = { zlib: new URL('./shims/zlib.js', import.meta.url).pathname };
const plugin = { name: 'node-shim', setup(b) {
  b.onResolve({ filter: /^(node:)?[a-z_\/]+$/ }, a => { const m = a.path.replace(/^node:/, '');
    if (m === 'zlib') return { path: alias.zlib }; if (builtinModules.includes(m) && m!=='buffer' && m!=='process') return { path: empty }; });
  b.onResolve({ filter: /^(sharp|onnxruntime-node|@hyzyla\/pdfium|pdfjs-dist.*|@huggingface\/tokenizers|@modelcontextprotocol\/.*)$/ }, () => ({ path: empty }));
  b.onLoad({ filter: /kordoc[\/\\]dist[\/\\].*\.js$/ }, async a => {
    let src = await (await import('node:fs/promises')).readFile(a.path, 'utf8');
    src = src.replace(/(\w+)\.nodeStream\("nodebuffer"\)/g, (m, f) => `((z)=>{const h={};const s={on(e,fn){h[e]=fn;return s},pause(){},destroy(){}};z.async("uint8array").then(u=>{h.data&&h.data(Buffer.from(u.buffer,u.byteOffset,u.byteLength));h.end&&h.end()},e=>h.error&&h.error(e));return s})(${f})`);
    // whitespace preservation (hwpview): keep runs of spaces, tabs, fixed-width / non-breaking spaces
    src = src.replace('let t = raw.replace(/[ \\t]+/g, " ").trim();', 'let t = raw.replace(/\\t/g, "\\u2003\\u2003").replace(/ {2,}/g, (m) => "\\u00a0".repeat(m.length - 1) + " ").replace(/^[ \\u00a0\\u2003]+|[ \\u00a0\\u2003]+$/g, "");');
    src = src.replace(/case "fwSpace":\s*case "hwSpace":\s*case "nbSpace":\s*text \+= " ";/, 'case "fwSpace": text += "\\u2007"; break; case "nbSpace": text += "\\u00a0"; break; case "hwSpace": text += " ";');
    return { contents: src, loader: 'js', resolveDir: (await import('node:path')).dirname(a.path) };
  });
}};
export const opts = (entry, out) => ({ entryPoints: [entry], outfile: out, bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: !process.env.DEV, plugins: [plugin], inject: [new URL('./shims/inject.js', import.meta.url).pathname], define: { global: 'globalThis' }, logLevel: 'warning', supported: { 'top-level-await': false }});
await esbuild.build(opts(process.argv[2], process.argv[3]));
