// Original pagination from Hangul's cached layout (LINE_SEG vertpos) + explicit breaks.
import CFB from '../../kordoc/node_modules/cfb/cfb.js';
import pako from '../../kordoc/node_modules/pako/index.js';
import JSZip from '../../kordoc/node_modules/jszip/dist/jszip.min.js';

const EXT = new Set([1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23]);
function hwpText(u8) {           // PARA_TEXT (UTF-16LE with 8-unit controls)
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let s = '';
  for (let i = 0; i + 1 < u8.length;) { const c = v.getUint16(i, true);
    if (c < 32) { i += EXT.has(c) ? 16 : 2; if (c === 13 || c === 10) s += ' '; continue; }
    s += String.fromCharCode(c); i += 2; }
  return s;
}
// pages: array of { text } = first top-level paragraph text of each page after page 1
function finish(paras, how) {
  // paras: [{text, vert0, brk(page/section), hasTable}]
  const starts = []; let prev = -1;
  paras.forEach((p, i) => {
    if (i === 0) { prev = p.vertLast ?? p.vert0; return; }
    const reset = p.vert0 != null && prev != null && p.vert0 < prev - 1000 && p.vert0 <= 3000;
    if (p.brk || reset) { let k = ''; for (let j = i; j < paras.length && j < i + 6 && !k; j++) k = paras[j].text.replace(/\s+/g, ''); starts.push({ i, text: p.text, key: k.slice(0, 14), why: p.brk ? 'break' : 'layout' }); }
    if (p.vertLast != null) prev = p.vertLast;
  });
  return { starts, paras: paras.length, pages: starts.length + 1, how };
}
export async function hwpPages(buf) {
  const cfb = CFB.read(new Uint8Array(buf), { type: 'array' });
  const fh = CFB.find(cfb, '/FileHeader').content; const compressed = fh[36] & 1;
  const paras = []; let page = null;
  for (let s = 0; ; s++) {
    const e = CFB.find(cfb, '/BodyText/Section' + s); if (!e) break;
    let d = new Uint8Array(e.content); if (compressed) d = pako.inflateRaw(d);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength); let cur = null, top = null, first = true;
    for (let o = 0; o + 4 <= d.length;) {
      const h = v.getUint32(o, true); o += 4; const tag = h & 0x3ff, lvl = (h >> 10) & 0x3ff; let sz = h >>> 20;
      if (sz === 0xfff) { sz = v.getUint32(o, true); o += 4; }
      const body = d.subarray(o, o + sz); o += sz;
      if (tag === 66 && lvl !== 0) { if (cur) { top = top || cur; } cur = null; continue; }
      if (tag === 67 && lvl !== 1) { if (top) top.text += ' ' + hwpText(body).trim(); continue; }
      if (tag === 69 && lvl !== 1) continue;
      if (tag === 66) { const bt = body[11] || 0; top = cur = { text: '', brk: (bt & 0x05) || (s > 0 && first) ? 1 : 0, vert0: null, vertLast: null }; first = false; paras.push(cur); }
      else if (tag === 67 && cur) cur.text = (hwpText(body).trim() + ' ' + cur.text).trim();
      else if (tag === 69 && cur && body.length >= 36) { const bv = new DataView(body.buffer, body.byteOffset, body.byteLength); cur.vert0 = bv.getInt32(4, true); cur.vertLast = bv.getInt32(4 + 36 * (Math.floor(body.length / 36) - 1), true); }
      else if (tag === 73 && !page && body.length >= 40) { const bv = new DataView(body.buffer, body.byteOffset); page = { w: bv.getUint32(0, true), h: bv.getUint32(4, true), l: bv.getUint32(8, true), r: bv.getUint32(12, true), t: bv.getUint32(16, true), b: bv.getUint32(20, true), hd: bv.getUint32(24, true), ft: bv.getUint32(28, true) }; }
    }
  }
  return { ...finish(paras, "hwp"), page };
}
export async function hwpxPages(buf) {
  const z = await JSZip.loadAsync(buf); const names = Object.keys(z.files).filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const paras = []; let page = null;
  for (let si = 0; si < names.length; si++) {
    const doc = new DOMParser().parseFromString(await z.file(names[si]).async('string'), 'application/xml');
    const sec = doc.documentElement; let first = true;
    for (const p of sec.children) { if (p.localName !== 'p') continue;
      if (!page) { const pp = p.getElementsByTagNameNS('*', 'pagePr')[0]; if (pp) { const m = pp.getElementsByTagNameNS('*', 'margin')[0]; page = { w: +pp.getAttribute('width'), h: +pp.getAttribute('height'), l: +(m && m.getAttribute('left')), r: +(m && m.getAttribute('right')), t: +(m && m.getAttribute('top')), b: +(m && m.getAttribute('bottom')), hd: +(m && m.getAttribute('header')), ft: +(m && m.getAttribute('footer')) }; } }
      const ls = [...p.children].find(c => c.localName === 'linesegarray'); const segs = ls ? [...ls.children] : [];
      let text = ''; for (const t of p.getElementsByTagNameNS('*', 't')) text += t.textContent + ' ';
      paras.push({ text: text.trim(), brk: p.getAttribute('pageBreak') === '1' || (si > 0 && first) ? 1 : 0, vert0: segs.length ? +segs[0].getAttribute('vertpos') : null, vertLast: segs.length ? +segs[segs.length - 1].getAttribute('vertpos') : null });
      first = false; }
  }
  return { ...finish(paras, 'hwpx'), page };
}
