export function formatBytes(bytes: number) {
  const sizes = ["B", "KB", "MB", "GB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

type ZipEntry = {
  name: string;
  data: Uint8Array;
  lastModified?: number;
};

const textEncoder = new TextEncoder();
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const readUint32BE = (data: Uint8Array, offset: number) =>
  ((data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]) >>>
  0;

const toDosDateTime = (timestamp?: number) => {
  const date = new Date(timestamp ?? Date.now());
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
};

export function createZipBlob(entries: ZipEntry[]) {
  const flags = 0x0800;
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = textEncoder.encode(entry.name.replace(/\\/g, "/"));
    const data = entry.data;
    const { dosTime, dosDate } = toDosDateTime(entry.lastModified);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    fileParts.push(localHeader, data);
    const localOffset = offset;
    offset += localHeader.length + data.length;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);

  const blobParts = [...fileParts, ...centralParts, endRecord] as unknown as BlobPart[];
  return new Blob(blobParts, {
    type: "application/zip",
  });
}

export function addPngTextChunk(
  pngData: Uint8Array,
  keyword: string,
  text: string,
) {
  if (pngData.length < PNG_SIGNATURE.length) return pngData;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (pngData[i] !== PNG_SIGNATURE[i]) return pngData;
  }

  const keywordBytes = textEncoder.encode(keyword);
  const textBytes = textEncoder.encode(text);
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0;
  chunkData.set(textBytes, keywordBytes.length + 1);

  const chunk = new Uint8Array(12 + chunkData.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, chunkData.length, false);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4);
  chunk.set(chunkData, 8);
  const crc = crc32(chunk.subarray(4, 8 + chunkData.length));
  chunkView.setUint32(8 + chunkData.length, crc, false);

  let insertOffset = -1;
  let offset = 8;
  while (offset + 8 <= pngData.length) {
    const length = readUint32BE(pngData, offset);
    const type = String.fromCharCode(
      pngData[offset + 4],
      pngData[offset + 5],
      pngData[offset + 6],
      pngData[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > pngData.length) break;
    if (type === "IEND") {
      insertOffset = offset;
      break;
    }
    offset = crcEnd;
  }

  if (insertOffset === -1) return pngData;

  const output = new Uint8Array(pngData.length + chunk.length);
  output.set(pngData.subarray(0, insertOffset), 0);
  output.set(chunk, insertOffset);
  output.set(pngData.subarray(insertOffset), insertOffset + chunk.length);
  return output;
}
