import { parseHwp, parseHwpx } from 'kordoc';
import { marked } from 'marked';
import { hwpPages, hwpxPages } from './pages.js';
import { isDocCfb, docHtml, renderDocx } from './wordfmt.js';
import JSZip from '../../kordoc/node_modules/jszip/dist/jszip.min.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

async function toMarkdown(buf, name) {
  const u = new Uint8Array(buf);
  const isZip = u[0] === 0x50 && u[1] === 0x4b;
  const opts = { htmlTables: true, inlineImages: true };
  const r = isZip ? await parseHwpx(buf, opts) : await parseHwp(buf, opts);
  if (!r.success) throw new Error(r.error || '변환 실패');
  let md = r.markdown;
  for (const img of r.images || []) {
    if (!img.data) continue;
    const uri = `data:${img.mimeType || 'image/png'};base64,` + b64(img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data));
    md = md.split('](' + img.filename + ')').join('](' + uri + ')').split('src="' + img.filename + '"').join('src="' + uri + '"');
  }

  return md;
}

function renderBody(md) {
  const toc = []; let n = 0;
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const inner = this.parser.parseInline(tokens); const id = 'h' + (++n);
    toc.push({ depth, id, text: inner.replace(/<[^>]+>/g, '') });
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  let body = marked.parse(md, { renderer, gfm: true, breaks: true });
  body = body.replace(/<p>\s*<strong>([^<]{2,80}?)\s*<\/strong>\s*<\/p>/g, (m, t) => {
    const id = 'h' + (++n); toc.push({ depth: 2, id, text: t.trim() });
    return `<p class="ptitle" id="${id}"><strong>${t}</strong></p>`;
  });
  // one-row "section banner" tables (HTML or pipe form) -> headings, via DOM
  const tmp = document.createElement('div'); tmp.innerHTML = body;
  for (const t of [...tmp.querySelectorAll('table')]) {
    const rows = t.querySelectorAll('tr'); if (rows.length !== 1 || rows[0].cells.length > 3) continue;
    const txt = t.textContent.replace(/\s+/g, ' ').trim(); if (!txt || txt.length > 60) continue;
    const id = 'h' + (++n); toc.push({ depth: 2, id, text: txt });
    const d = document.createElement('div'); d.className = 'banner'; d.id = id; d.textContent = txt; t.replaceWith(d);
  }
  body = tmp.innerHTML;
  toc.sort((a, b) => body.indexOf('id="' + a.id + '"') - body.indexOf('id="' + b.id + '"'));
  // wrap tables for horizontal scroll on phones
  body = body.replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>');
  return { body, toc };
}

let last = null;
function applyPages(info) {
  let ps = document.getElementById('pagedef'); if (!ps) { ps = document.createElement('style'); ps.id = 'pagedef'; document.head.appendChild(ps); }
  ps.textContent = '';
  if (!info) return;
  const mm = v => (v / 7200 * 25.4).toFixed(1) + 'mm', pg = info.page;
  if (pg && pg.w > 28000 && pg.w < 130000 && pg.h > 28000 && pg.h < 130000) {
    const top = Math.max(10, (pg.t + pg.hd) / 7200 * 25.4), bot = Math.max(10, (pg.b + pg.ft) / 7200 * 25.4), l = Math.max(10, pg.l / 7200 * 25.4), r = Math.max(10, pg.r / 7200 * 25.4);
    ps.textContent = '@media print{@page{size:' + mm(pg.w) + ' ' + mm(pg.h) + ';margin:' + top.toFixed(1) + 'mm ' + r.toFixed(1) + 'mm ' + bot.toFixed(1) + 'mm ' + l.toFixed(1) + 'mm}}';
  }
  const blocks = [...$('#doc').children], norm = e => (e.textContent || '').replace(/\s+/g, '');
  const texts = blocks.map(norm); let cur = 1, placed = 0, pno = 1;
  for (const st of info.starts) {
    pno++; const k = st.key; if (!k) continue;
    let idx = -1; for (let i = cur; i < blocks.length; i++) if (texts[i].includes(k) || (k.length > 8 && texts[i].includes(k.slice(0, 8)))) { idx = i; break; }
    if (idx < 0) continue;
    const m = document.createElement('div'); m.className = 'hwp-pagebreak'; m.innerHTML = '<span>— ' + pno + '쪽 —</span>';
    blocks[idx].before(m); cur = idx + 1; placed++;
  }
  info.placed = placed;
}
const decName = b => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { try { return new TextDecoder('euc-kr').decode(b); } catch (e2) { return new TextDecoder().decode(b); } } };
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const SUP = /\.(hwp|hwpx|pdf|docx?)$/i;
let zipStack = [], fromZip = false;   // stack of {name, items:[{path,name,size,entry}]}
async function openZip(file, nested) {
  const st = $('#status'); st.textContent = 'ZIP 여는 중… ' + file.name; st.hidden = false;
  let z; try { z = await JSZip.loadAsync(file, { decodeFileName: decName }); }
  catch (e) { st.textContent = /encrypt/i.test(e && e.message) ? '암호가 걸린 ZIP은 열 수 없어요. 압축을 풀어서 열어 주세요.' : 'ZIP을 열 수 없어요: ' + (e && e.message || e); setTimeout(() => st.hidden = true, 4000); return; }
  const items = [];
  z.forEach((p, e) => { if (e.dir || /(^|\/)(__MACOSX|\.)/.test(p)) return; const nm = p.split('/').pop();
    if (SUP.test(nm) || (!nested && /\.zip$/i.test(nm))) items.push({ path: p, name: nm, size: e._data && e._data.uncompressedSize || 0, entry: e }); });
  st.hidden = true;
  if (!items.length) { st.textContent = 'ZIP 안에 열 수 있는 파일(HWP·HWPX·PDF)이 없어요.'; st.hidden = false; setTimeout(() => st.hidden = true, 3500); return; }
  if (!nested) zipStack = [];
  zipStack.push({ name: file.name, items });
  if (items.length === 1 && !/\.zip$/i.test(items[0].name)) { zipStack[zipStack.length - 1].auto = true; return openZipItem(0); }
  showZipList();
}
function showZipList() {
  $('#pdfbtn').hidden = true;
  const z = zipStack[zipStack.length - 1]; fromZip = false;
  if (window.__pdfReset) window.__pdfReset();
  $('#doc').classList.remove('pdf');
  $('#doc').innerHTML = '<h2 class="ziph">🗜 ' + esc(z.name) + '</h2><p class="zipn">열 수 있는 파일 ' + z.items.length + '개 · 눌러서 열기</p><ul class="ziplist">' +
    z.items.map((it, i) => { const dir = it.path.slice(0, it.path.length - it.name.length);
      const ic = /\.pdf$/i.test(it.name) ? '📕' : /\.zip$/i.test(it.name) ? '🗜' : '📄';
      return '<li><button data-i="' + i + '"><span class="zi">' + ic + '</span><span class="zt"><b>' + esc(it.name) + '</b>' + (dir ? '<small>' + esc(dir) + '</small>' : '') + '</span><span class="zs">' + fmtSize(it.size) + '</span></button></li>'; }).join('') + '</ul>';
  $('#toc').innerHTML = ''; $('#tocbtn').hidden = true;
  $('#welcome').hidden = true; $('#page').hidden = false; document.body.classList.add('docopen');
  $('#fn').textContent = z.name; $('#meta').textContent = 'ZIP · 파일 ' + z.items.length + '개'; document.title = z.name; window.scrollTo(0, 0);
  $('#doc').querySelectorAll('.ziplist button').forEach(b => b.onclick = () => openZipItem(+b.dataset.i));
}
async function openZipItem(i) {
  const it = zipStack[zipStack.length - 1].items[i];
  const st = $('#status'); st.textContent = '압축 푸는 중… ' + it.name; st.hidden = false;
  const blob = await it.entry.async('blob'); const f = new File([blob], it.name);
  if (/\.zip$/i.test(it.name)) return openZip(f, true);
  fromZip = true; return openFile(f, true);
}
window.__zip = { get stack() { return zipStack; }, get fromZip() { return fromZip; }, showZipList, back() {
  const top = zipStack[zipStack.length - 1];
  if (fromZip && top && !top.auto) { showZipList(); return true; }
  if (!fromZip && zipStack.length > 1) { zipStack.pop(); showZipList(); return true; }
  return false; } };
// one place that decides what we can open: extension, MIME, then magic bytes (Android pickers may drop the extension)
async function detectKind(file) {
  const n = (file.name || '').toLowerCase(), t = (file.type || '').toLowerCase();
  let h = null; try { h = new Uint8Array(await file.slice(0, 8).arrayBuffer()); } catch (e) {}
  if (h && h.length >= 4) {
    if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf';            // %PDF
    if (h[0] === 0xD0 && h[1] === 0xCF && h[2] === 0x11 && h[3] === 0xE0) { if (/\.doc$/.test(n)) return 'doc'; if (/\.hwp$/.test(n)) return 'hwp'; try { if (isDocCfb(new Uint8Array(await file.arrayBuffer()))) return 'doc'; } catch (e) {} return 'hwp'; } // CFB: HWP 5 or Word 97
    if (h[0] === 0x50 && h[1] === 0x4B) {                                                             // zip: HWPX or archive?
      if (/\.hwpx$/.test(n)) return 'hwpx'; if (/\.docx$/.test(n)) return 'docx'; if (/\.zip$/.test(n)) return 'zip';
      try { const z = await JSZip.loadAsync(file, { decodeFileName: decName });
        const m = z.file('mimetype'); if ((m && /hwp/.test(await m.async('string'))) || z.file('Contents/section0.xml')) return 'hwpx'; if (z.file('word/document.xml')) return 'docx';
        return 'zip'; } catch (e) { return /encrypt/i.test(e && e.message) ? 'zip' : null; }
    }
    return null;
  }
  if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
  if (/\.zip$/.test(n) || /zip/.test(t)) return 'zip';
  if (/\.hwpx$/.test(n)) return 'hwpx'; if (/\.hwp$/.test(n)) return 'hwp'; if (/\.docx$/.test(n)) return 'docx'; if (/\.doc$/.test(n)) return 'doc';
  return null;
}
window.hwpviewDetect = detectKind;
async function openFile(file, inZip) {
  if (!inZip) { zipStack = []; fromZip = false; }
  const kind = await detectKind(file);
  if (kind === 'zip') return openZip(file);
  if (kind === 'pdf') return openPdf(file);
  if (!kind) { const st = $('#status'); st.textContent = '열 수 없는 파일이에요. HWP·HWPX·PDF·DOC·DOCX·ZIP 파일만 열 수 있어요.'; st.hidden = false; setTimeout(() => st.hidden = true, 3500); return; }
  $('#status').textContent = '변환 중… ' + file.name; $('#status').hidden = false;
  try {
    const t0 = performance.now();
    const buf = await file.arrayBuffer();
    const word = kind === 'doc' || kind === 'docx';
    const { body, toc } = word ? { body: '', toc: [] } : renderBody(await toMarkdown(buf, file.name));
    const now = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short', hour12: false }).format(new Date());
    $('#fn').textContent = file.name; $('#meta').textContent = `변환: ${now} (KST) · 기기 내 변환 ${Math.round(performance.now() - t0)}ms`;
    if (pdfObs) { pdfObs.disconnect(); pdfObs = null; } $('#doc').classList.remove('pdf');
    $('#doc').classList.toggle('word', word); $('#doc').classList.toggle('docx', kind === 'docx');
    if (kind === 'docx') await renderDocx(buf, $('#doc'));
    else if (kind === 'doc') $('#doc').innerHTML = '<p class="wordnote">ⓘ 예전 Word(.doc) 문서는 글자·표 위주로 보여 줍니다. 서식·그림은 원본과 다를 수 있어요.</p>' + docHtml(new Uint8Array(buf));
    else $('#doc').innerHTML = body;
    $('#save').hidden = false;
    $('#doc').querySelectorAll('td,th').forEach(c => { if (!c.querySelector('img') && !c.textContent.replace(/[\s\u00a0\u2003\u2007]/g, '')) { c.classList.add('emp'); c.innerHTML = '&nbsp;'; } });
    let pinfo = null; if (!word) try { pinfo = await (kind === 'hwpx' ? hwpxPages(buf.slice(0)) : hwpPages(buf.slice(0))); applyPages(pinfo); } catch (e) { console.warn('pages', e); applyPages(null); }
    window.__pinfo = pinfo;
    $('#toc').innerHTML = toc.length ? toc.map(t => `<a class="d${t.depth}" href="#${t.id}">${esc(t.text)}</a>`).join('') : '<span class="empty">제목 없음</span>';
    $('#welcome').hidden = true; $('#page').hidden = false; $('#tocbtn').hidden = false; $('#pdfbtn').hidden = false; document.body.classList.add('docopen'); $('#toc').insertAdjacentHTML('afterbegin','<button id="tocx">✕ 닫기</button>'); $('#status').hidden = true;
    document.title = file.name; last = file.name; window.scrollTo(0, 0);
  } catch (e) { $('#status').textContent = '오류: ' + (e && e.message || e); console.error(e); }
}
window.hwpviewOpen = openFile;

let pdfjs = null, pdfDoc = null, pdfObs = null;
window.__pdfReset = () => { if (pdfObs) { pdfObs.disconnect(); pdfObs = null; } };
async function openPdf(file) {
  $('#pdfbtn').hidden = true;
  const st = $('#status'); st.textContent = 'PDF 여는 중… ' + file.name; st.hidden = false;
  try {
    const t0 = performance.now();
    if (!pdfjs) { pdfjs = await import(new URL('pdf.min.mjs', location.href).href); pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href; }
    if (pdfObs) pdfObs.disconnect(); if (pdfDoc) pdfDoc.destroy();
    pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const doc = pdfDoc, n = doc.numPages, holder = $('#doc');
    holder.innerHTML = ''; holder.classList.add('pdf');
    $('#welcome').hidden = true; $('#page').hidden = false;   // must be visible to measure width
    const W = holder.clientWidth || innerWidth;
    const first = await doc.getPage(1), v1 = first.getViewport({ scale: 1 });
    for (let i = 1; i <= n; i++) {
      const d = document.createElement('div'); d.className = 'pg'; d.id = 'p' + i; d.dataset.n = i;
      d.style.aspectRatio = v1.width + ' / ' + v1.height; d.innerHTML = '<span class="pno">' + i + ' / ' + n + '</span>';
      holder.appendChild(d);
    }
    const render = async d => {
      if (d.dataset.r) return; d.dataset.r = '1';
      const page = await doc.getPage(+d.dataset.n); const v0 = page.getViewport({ scale: 1 });
      d.style.aspectRatio = v0.width + ' / ' + v0.height;
      const cssW = d.clientWidth || W, scale = cssW / v0.width, vp = page.getViewport({ scale });
      const q = Math.min(3, (devicePixelRatio || 1) * 1.5);
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width * q); c.height = Math.floor(vp.height * q);
      d.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: [q, 0, 0, q, 0, 0] }).promise;
      try { const tl = document.createElement('div'); tl.className = 'textLayer'; tl.style.setProperty('--scale-factor', scale); d.appendChild(tl);
        await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render(); } catch (e) {}
    };
    const unrender = d => { if (!d.dataset.r) return; delete d.dataset.r; d.querySelectorAll('canvas,.textLayer').forEach(x => x.remove()); };
    pdfObs = new IntersectionObserver(es => es.forEach(e => {
      const k = +e.target.dataset.n;
      if (e.isIntersecting) render(e.target);
      else { const vis = [...holder.querySelectorAll('.pg[data-r]')]; if (vis.length > 12) unrender(e.target); }
    }), { rootMargin: '1500px 0px' });
    holder.querySelectorAll('.pg').forEach(d => pdfObs.observe(d));
    // TOC: outline or page list
    let items = [];
    try {
      const ol = await doc.getOutline();
      const walk = async (arr, depth) => { for (const o of arr || []) { let pi = null;
        try { let dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest; if (dest && dest[0]) pi = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]); } catch (e) {}
        if (pi != null) items.push({ depth: Math.min(depth, 4), id: 'p' + (pi + 1), text: o.title });
        await walk(o.items, depth + 1); } };
      await walk(ol, 1);
    } catch (e) {}
    if (!items.length) for (let i = 1; i <= n; i++) items.push({ depth: 2, id: 'p' + i, text: i + '쪽' });
    $('#toc').innerHTML = '<button id="tocx">✕ 닫기</button>' + items.map(t => `<a class="d${t.depth}" href="#${t.id}">${esc(t.text)}</a>`).join('');
    const now = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short', hour12: false }).format(new Date());
    $('#fn').textContent = file.name; $('#meta').textContent = `PDF ${n}쪽 · 열람: ${now} (KST) · ${Math.round(performance.now() - t0)}ms`;
    $('#tocbtn').hidden = false; document.body.classList.add('docopen'); st.hidden = true;
    document.title = file.name; last = file.name; window.scrollTo(0, 0);
  } catch (e) { st.textContent = 'PDF 오류: ' + (e && e.message || e); console.error(e); }
}

function saveHtml() {
  const css = document.querySelector('style').outerHTML;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(last)}</title>${css}</head><body class="saved"><header class="bar"><span id="fn">${esc(last)}</span><span id="meta">${esc($('#meta').textContent)}</span></header><div class="wrap"><nav id="toc">${$('#toc').innerHTML}</nav><main><div class="page">${$('#doc').innerHTML}</div></main></div></body></html>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = (last || 'doc').replace(/\.[^.]+$/, '') + '.html'; a.click();
}

addEventListener('DOMContentLoaded', async () => {
  $('#pick').onchange = e => e.target.files[0] && openFile(e.target.files[0]);
  const B = document.body, isOpen = () => B.classList.contains('tocopen');
  let dlg = null, exiting = false;
  const CW = typeof window.CloseWatcher === 'function';
  const toast = (m, ms) => { const st = $('#status'); st.textContent = m; st.hidden = false; setTimeout(() => st.hidden = true, ms || 2000); };
  const closeDlg = () => { if (dlg) { dlg.remove(); dlg = null; } };
  const goHome = () => { $('#pdfbtn').hidden = true; if (window.__pdfReset) window.__pdfReset(); document.body.classList.remove('docopen'); $('#page').hidden = true; $('#welcome').hidden = false; $('#tocbtn').hidden = true; $('#doc').innerHTML = ''; $('#doc').classList.remove('pdf'); $('#toc').innerHTML = ''; $('#fn').textContent = 'HWP·HWPX·PDF 뷰어'; last = null; document.querySelectorAll('input[type=file]').forEach(i => i.value = ''); scrollTo(0, 0); };
  let pushed = 0, exitAt = 0;
  const doExit = () => {
    exiting = true; exitAt = Date.now(); if (cw) { cw.destroy(); cw = null; }
    try { window.close(); } catch (e) {}
    const n = pushed; pushed = 0;
    if (n > 0) history.go(-n);                        // unwind our guard entries
    setTimeout(() => { if (document.visibilityState === 'visible') try { history.back(); } catch (e) {} }, n > 0 ? 350 : 0); // leave the page if there is somewhere to go
    setTimeout(() => { if (document.visibilityState === 'visible') toast('뒤로 버튼을 한 번 더 누르면 끝나요. 안 되면 홈 버튼으로 나가 주세요.', 5000); }, 900);
  };
  window.__exitState = () => ({ exiting, pushed, cw: !!cw, len: history.length, state: history.state });
  const ask = (msg, okText, onOk) => {
    closeDlg(); dlg = document.createElement('div'); dlg.id = 'dlg';
    dlg.innerHTML = '<div class="box"><p>' + msg + '</p><div class="btns"><button class="cancel">취소</button><button class="ok">' + okText + '</button></div></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('.cancel').onclick = closeDlg;
    dlg.querySelector('.ok').onclick = () => { closeDlg(); onOk(); };
    dlg.onclick = e => { if (e.target === dlg) closeDlg(); };
  };
  // one place that decides what "back" means
  const onBack = () => { if (window.__licOpen && window.__licOpen()) { window.__licClose(); return; }
    if (window.__helpOpen && window.__helpOpen()) { window.__helpClose(); return; }
    if (dlg) return closeDlg();
    if (isOpen()) return B.classList.remove('tocopen');
    if (!$('#page').hidden) ask('파일을 닫을까요?', '닫기', () => { if (!window.__zip.back()) goHome(); });
    else ask('뷰어를 끝낼까요?', '끝내기', doExit);
  };
  // A) CloseWatcher (Chrome 120+, Android back button/gesture goes here first)
  let cw = null;
  const arm = () => { if (!CW || exiting || cw) return; try { cw = new CloseWatcher(); cw.onclose = () => { cw = null; onBack(); arm(); }; } catch (e) { cw = null; } };
  // B) history guard fallback; pushed only inside a real tap (click = user activation on touch; pointerdown on touch is NOT)
  const G = () => history.state && history.state.g;
  const guard = () => { if (CW || exiting) return; if (!G()) { history.pushState({ g: 1 }, ''); pushed++; } };
  const onGesture = e => { if (exiting) { if ((e && e.type === 'keydown') || Date.now() - exitAt < 1500 || (e && e.target && e.target.closest && e.target.closest('#dlg'))) return; exiting = false; } if (CW) arm(); else guard(); };
  addEventListener('click', onGesture, true); addEventListener('touchend', onGesture, true); addEventListener('keydown', onGesture, true);
  if (CW) arm();
  window.addEventListener('popstate', () => {
    if (CW || exiting) return;
    if (G()) return;                       // landed on guard (e.g. other entry popped)
    pushed = Math.max(0, pushed - 1); history.pushState({ g: 1 }, ''); pushed++;      // re-arm
    onBack();
  });
  const openToc = () => { if ($('#page').hidden) return toast('문서를 열면 목차가 나타나요'); B.classList.add('tocopen'); };
  const closeToc = () => B.classList.remove('tocopen');
  $('#tocbtn').onclick = () => isOpen() ? closeToc() : openToc();
  $('#tocbd').onclick = closeToc;
  $('#toc').onclick = e => {
    if (e.target.id === 'tocx') return closeToc();
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1));
    closeToc(); if (t) setTimeout(() => t.scrollIntoView(), 50);
  };
  window.__hv = { onBack, get cw() { return cw; }, CW };
  $('#pdfbtn').onclick = () => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    toast(ios ? '인쇄 화면에서 공유 버튼 → "파일에 저장"을 누르세요' : '인쇄 화면에서 프린터를 "PDF로 저장"으로 고르세요', 3500);
    const t = document.title, nm = (last || 'document').replace(/\.[^.]+$/, '');
    const restore = () => { document.title = t; removeEventListener('afterprint', restore); };
    setTimeout(() => { document.title = nm; addEventListener('afterprint', restore); try { window.print(); } catch (e) { toast('이 브라우저에서는 인쇄를 열 수 없어요'); } setTimeout(restore, 60000); }, 1200);
  };
  $('#save').onclick = saveHtml; $('#print').onclick = () => print();
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); });
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    (function(){var had=!!navigator.serviceWorker.controller,done=false;navigator.serviceWorker.addEventListener('controllerchange',function(){if(had&&!done){done=true;location.reload()}})})(),navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(function(r){r.update()}).catch(() => {});
    if (location.search.includes('shared=1')) {   // Android share target: SW stashed the file in cache
      const c = await caches.open('simview-share'); const r = await c.match('/shared-file');
      if (r) { const name = decodeURIComponent(r.headers.get('x-name') || 'shared.hwp'); await c.delete('/shared-file'); openFile(new File([await r.blob()], name)); }
    }
  }
  if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files && p.files[0]) openFile(await p.files[0].getFile()); });
});
