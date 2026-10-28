import * as pako from 'pako'; import { Buffer } from 'buffer';
const B = u => Buffer.from(u.buffer ? new Uint8Array(u.buffer, u.byteOffset, u.byteLength) : u);
export const inflateRawSync = (d, o) => B(pako.inflateRaw(d));
export const inflateSync = (d, o) => B(pako.inflate(d));
export const deflateRawSync = (d, o) => B(pako.deflateRaw(d, o));
export const deflateSync = (d, o) => B(pako.deflate(d, o));
export const gunzipSync = d => B(pako.ungzip(d));
export const constants = {};
export default { inflateRawSync, inflateSync, deflateRawSync, deflateSync, gunzipSync, constants };
