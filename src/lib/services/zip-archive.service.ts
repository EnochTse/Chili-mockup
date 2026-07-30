type ZipEntryInput = {
  name: string;
  data: Buffer;
};

export type StoredZipEntry = {
  name: string;
  data: Buffer;
};

const localFileHeaderSignature = 0x04034b50;
const centralDirectoryHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const utf8Flag = 0x0800;
const maxEndRecordSearch = 65_557;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function calculateCrc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeArchivePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/");

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${value}`);
  }

  return normalized;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);

  return {
    date: dosDate,
    time: dosTime
  };
}

export function createStoredZip(entries: ZipEntryInput[]) {
  if (!entries.length) {
    throw new Error("A ZIP archive needs at least one entry.");
  }
  if (entries.length > 65_535) {
    throw new Error("The ZIP archive has too many entries.");
  }

  const now = toDosDateTime(new Date());
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  const seenNames = new Set<string>();
  let localOffset = 0;

  for (const entry of entries) {
    const name = normalizeArchivePath(entry.name);
    if (seenNames.has(name)) {
      throw new Error(`Duplicate ZIP entry: ${name}`);
    }
    seenNames.add(name);

    const nameBuffer = Buffer.from(name, "utf8");
    if (nameBuffer.length > 65_535 || entry.data.length > 0xffffffff) {
      throw new Error(`ZIP entry is too large: ${name}`);
    }

    const crc = calculateCrc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(localFileHeaderSignature, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuffer, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(centralDirectoryHeaderSignature, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralChunks.push(centralHeader, nameBuffer);

    localOffset += localHeader.length + nameBuffer.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(endOfCentralDirectorySignature, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}

function findEndRecord(buffer: Buffer) {
  if (buffer.length < 22) {
    return -1;
  }

  const minimumOffset = Math.max(0, buffer.length - maxEndRecordSearch);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }
  return -1;
}

export function readStoredZip(
  buffer: Buffer,
  options: {
    maxEntries?: number;
    maxTotalBytes?: number;
  } = {}
): StoredZipEntry[] {
  const maxEntries = options.maxEntries ?? 500;
  const maxTotalBytes = options.maxTotalBytes ?? 512 * 1024 * 1024;
  const endOffset = findEndRecord(buffer);
  if (endOffset < 0 || endOffset + 22 > buffer.length) {
    throw new Error("The product package is not a valid ZIP archive.");
  }

  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (entryCount > maxEntries) {
    throw new Error(`The product package contains more than ${maxEntries} files.`);
  }
  if (centralOffset + centralSize > endOffset) {
    throw new Error("The product package has an invalid central directory.");
  }

  const entries: StoredZipEntry[] = [];
  const seenNames = new Set<string>();
  let totalBytes = 0;
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralDirectoryHeaderSignature) {
      throw new Error("The product package has an invalid file directory.");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const centralEntrySize = 46 + nameLength + extraLength + commentLength;
    if (offset + centralEntrySize > buffer.length) {
      throw new Error("The product package contains a truncated directory entry.");
    }

    if (flags & 0x0001) {
      throw new Error("Encrypted ZIP entries are not supported.");
    }
    if (compressionMethod !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("Only Chili product packages exported by Local Studio are supported.");
    }

    const name = normalizeArchivePath(
      buffer.toString(flags & utf8Flag ? "utf8" : "latin1", offset + 46, offset + 46 + nameLength)
    );
    if (seenNames.has(name)) {
      throw new Error(`The product package contains a duplicate file: ${name}`);
    }
    seenNames.add(name);

    if (
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== localFileHeaderSignature
    ) {
      throw new Error(`The product package has an invalid local header for ${name}.`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`The product package contains a truncated file: ${name}`);
    }

    totalBytes += uncompressedSize;
    if (totalBytes > maxTotalBytes) {
      throw new Error("The product package is larger than the configured import limit.");
    }

    const data = Buffer.from(buffer.subarray(dataOffset, dataEnd));
    if (calculateCrc32(data) !== expectedCrc) {
      throw new Error(`The product package failed its integrity check for ${name}.`);
    }

    entries.push({ name, data });
    offset += centralEntrySize;
  }

  return entries;
}
