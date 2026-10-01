// Some movie SRT files use Windows-1252. Detect UTF-8 strictly before decoding
// so malformed bytes do not quietly become replacement characters in captions.
const windows1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
function isUtf8(bytes: Uint8Array) {
  for (let i = 0; i < bytes.length; i++) {
    const head = bytes[i];
    if (head < 0x80) continue;
    const length = head >= 0xc2 && head <= 0xdf ? 2 : head >= 0xe0 && head <= 0xef ? 3 : head >= 0xf0 && head <= 0xf4 ? 4 : 0;
    if (!length || i + length > bytes.length) return false;
    const second = bytes[i + 1];
    if ((head === 0xe0 && second < 0xa0) || (head === 0xed && second >= 0xa0) || (head === 0xf0 && second < 0x90) || (head === 0xf4 && second >= 0x90)) return false;
    for (let j = 1; j < length; j++) if (bytes[i + j] < 0x80 || bytes[i + j] > 0xbf) return false;
    i += length - 1;
  }
  return true;
}
export function decodeSpeakingSubtitle(bytes: Uint8Array) {
  if (isUtf8(bytes)) return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/u, '');
  let text = '';
  for (const byte of bytes) text += String.fromCodePoint(byte >= 0x80 && byte <= 0x9f ? windows1252[byte - 0x80] : byte);
  return text;
}
