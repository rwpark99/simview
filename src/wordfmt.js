// Word 문서(.docx: docx-preview, .doc: 자체 경량 파서) — 모두 기기 안에서 처리
import CFB from '../../kordoc/node_modules/cfb/cfb.js';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 반복 공백 보존: 두 칸 이상이면 nbsp 로
const keepSp = s => esc(s).replace(/ {2,}/g, m => '\u00a0'.repeat(m.length - 1) + ' ').replace(/\t/g, '\u2003\u2003');

export function isDocCfb(u8) { try { const c = CFB.read(u8, { type: 'array' }); return !!CFB.find(c, 'WordDocument'); } catch { return false; } }

export function docText(u8) {
  const c = CFB.read(u8, { type: 'array' });
  const wd = CFB.find(c, 'WordDocument').content; const W = new DataView(Uint8Array.from(wd).buffer);
  const flags = W.getUint16(0x0A, true); if (flags & 0x0100) throw new Error('암호가 걸린 DOC 파일은 열 수 없습니다.');
  const tbl = CFB.find(c, (flags & 0x0200) ? '1Table' : '0Table'); if (!tbl) throw new Error('DOC 표 스트림 없음');
  const T = new DataView(Uint8Array.from(tbl.content).buffer);
  const ccpText = W.getInt32(64 + 12, true);
  const fcClx = W.getUint32(154 + 33 * 8, true), lcbClx = W.getUint32(154 + 33 * 8 + 4, true);
  let o = fcClx; const end = fcClx + lcbClx;
  while (o < end && T.getUint8(o) === 1) o += 3 + T.getUint16(o + 1, true);
  if (T.getUint8(o) !== 2) throw new Error('DOC 조각표 해석 실패');
  const lcb = T.getUint32(o + 1, true); o += 5; const n = (lcb - 4) / 12;
  const cps = []; for (let i = 0; i <= n; i++) cps.push(T.getUint32(o + i * 4, true));
  const dU16 = new TextDecoder('utf-16le'), d1252 = new TextDecoder('windows-1252');
  let s = '';
  for (let i = 0; i < n && cps[i] < ccpText; i++) {
    const pcd = o + (n + 1) * 4 + i * 8; let fc = T.getUint32(pcd + 2, true);
    const len = Math.min(cps[i + 1], ccpText) - cps[i]; const comp = !!(fc & 0x40000000);
    if (comp) { fc = (fc & ~0x40000000) >>> 1; s += d1252.decode(wd.slice(fc, fc + len)); }
    else s += dU16.decode(Uint8Array.from(wd.slice(fc, fc + len * 2)));
  }
  // 필드: \x13 지시 \x14 결과 \x15 → 결과만
  let out = '', depth = [], skip = 0;
  for (const ch of s) {
    if (ch === '\x13') { depth.push(1); skip++; continue; }
    if (ch === '\x14') { if (depth.length && depth[depth.length - 1] === 1) { depth[depth.length - 1] = 2; skip--; } continue; }
    if (ch === '\x15') { const d = depth.pop(); if (d === 1) skip--; continue; }
    if (skip > 0) continue; out += ch;
  }
  return out;
}

// 텍스트 → HTML (문단, 표(셀 표시 \x07), 쪽 나누기 \x0c)
export function docHtml(u8) {
  const t = docText(u8).replace(/[\x01\x08\x1f]/g, '').replace(/\x1e/g, '-').replace(/\x0b/g, '\n');
  const html = []; let cells = []; let pageNo = 1;
  const flushTable = () => {
    if (!cells.length) return;
    // 열 개수 k 추정: 매 (k+1)번째 토큰이 행 끝(빈 값)
    let k = 0;
    for (let c = 1; c <= Math.min(64, cells.length); c++) { if (cells.length % (c + 1)) continue; let ok = true; for (let r = c; r < cells.length; r += c + 1) if (cells[r] !== '') { ok = false; break; } if (ok) { k = c; break; } }
    const rows = []; if (k) for (let i = 0; i < cells.length; i += k + 1) rows.push(cells.slice(i, i + k)); else rows.push(cells.filter(x => x !== ''));
    html.push('<table>' + rows.map(r => '<tr>' + r.map(c => `<td>${c.split('\r').map(keepSp).join('<br>') || ''}</td>`).join('') + '</tr>').join('') + '</table>');
    cells = [];
  };
  const segs = t.match(/[^\r\x07\x0c]*[\r\x07\x0c]|[^\r\x07\x0c]+$/g) || [];
  let cellBuf = [], prevEnd = '', prev2 = '';
  const para = x => html.push(x.trim() ? `<p>${keepSp(x).replace(/\n/g, '<br>')}</p>` : '<p class="emptyp">&nbsp;</p>');
  for (const sg of segs) {
    const e = sg.slice(-1), x = /[\r\x07\x0c]/.test(e) ? sg.slice(0, -1) : sg;
    if (e === '\x07') { cellBuf.push(x); cells.push(cellBuf.join('\r')); cellBuf = []; prev2 = prevEnd; prevEnd = x === '' ? 'E' : 'C'; continue; }
    const rowDone = cells.length && prevEnd === 'E' && cellBuf.length === 0;
    if (cells.length && !rowDone) { cellBuf.push(x); prevEnd = 'P'; continue; }
    flushTable(); para(x); prevEnd = '';
    if (e === '\x0c') html.push(`<div class="hwp-pagebreak">${++pageNo}쪽</div>`);
  }
  if (cellBuf.length) cells.push(cellBuf.join('\r')); flushTable();
  return html.join('\n').replace(/(<p class="emptyp">&nbsp;<\/p>\n?){3,}/g, '<p class="emptyp">&nbsp;</p>\n');
}

export async function renderDocx(buf, el) {
  const { renderAsync } = await import('docx-preview');
  el.innerHTML = ''; const st = document.createElement('div');
  await renderAsync(buf, el, st, { inWrapper: false, ignoreWidth: true, ignoreHeight: true, breakPages: true, renderHeaders: true, renderFooters: false, useBase64URL: true, experimental: true });
  el.prepend(st);
  // 쪽 경계 표시
  const secs = [...el.querySelectorAll(':scope > section, :scope > article, :scope section.docx')].filter((s, i, a) => a.indexOf(s) === i && s.tagName === 'SECTION');
  secs.slice(1).forEach((s, i) => s.insertAdjacentHTML('beforebegin', `<div class="hwp-pagebreak">${i + 2}쪽</div>`));
  // 10pt 미만 글씨 올리기, 공백 보존
  el.querySelectorAll('span,p,td,th,li').forEach(e => { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs && fs < 13.33) e.style.fontSize = '10pt'; });
  return secs.length;
}
