import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

export interface ZipStreamEntry {
  name: string;
  source: Buffer | string | Uint8Array | NodeJS.ReadableStream | AsyncIterable<Buffer | string | Uint8Array>;
}

interface CentralDirectoryEntry {
  name: Buffer;
  crc32: number;
  compressedSize: bigint;
  uncompressedSize: bigint;
  localHeaderOffset: bigint;
}

const ZIP_STORE_METHOD = 0;
const ZIP_UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const ZIP_VERSION_ZIP64 = 45;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const DOS_TIME = 0;
const DOS_DATE_1980_01_01 = 33;

export function createZipStream(entries: ZipStreamEntry[]): Readable {
  return Readable.from(streamZip(entries));
}

async function* streamZip(entries: ZipStreamEntry[]): AsyncGenerator<Buffer> {
  const centralDirectory: CentralDirectoryEntry[] = [];
  let offset = 0n;

  for (const entry of entries) {
    const name = normalizeEntryName(entry.name);
    const localHeaderOffset = offset;
    const localHeader = createLocalFileHeader(name);
    yield localHeader;
    offset = addZipBytes(offset, localHeader.length);

    let crc = 0xffffffff;
    let size = 0n;
    for await (const chunk of toBufferChunks(entry.source)) {
      if (chunk.length === 0) continue;
      crc = updateCrc32(crc, chunk);
      size = addZipBytes(size, chunk.length);
      yield chunk;
      offset = addZipBytes(offset, chunk.length);
    }

    const finalizedCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = createDataDescriptor(finalizedCrc, size);
    yield descriptor;
    offset = addZipBytes(offset, descriptor.length);

    centralDirectory.push({
      name,
      crc32: finalizedCrc,
      compressedSize: size,
      uncompressedSize: size,
      localHeaderOffset,
    });
  }

  const centralDirectoryOffset = offset;
  for (const entry of centralDirectory) {
    const header = createCentralDirectoryHeader(entry);
    yield header;
    offset = addZipBytes(offset, header.length);
  }
  const centralDirectorySize = offset - centralDirectoryOffset;
  const zip64EndOffset = offset;

  const zip64End = createZip64EndOfCentralDirectory(
    centralDirectory.length,
    centralDirectorySize,
    centralDirectoryOffset,
  );
  yield zip64End;

  const locator = createZip64EndOfCentralDirectoryLocator(zip64EndOffset);
  yield locator;

  yield createEndOfCentralDirectory();
}

async function* toBufferChunks(source: ZipStreamEntry['source']): AsyncGenerator<Buffer> {
  if (Buffer.isBuffer(source)) {
    yield source;
    return;
  }
  if (typeof source === 'string') {
    yield Buffer.from(source, 'utf8');
    return;
  }
  if (source instanceof Uint8Array) {
    yield Buffer.from(source);
    return;
  }

  for await (const chunk of source) {
    if (Buffer.isBuffer(chunk)) {
      yield chunk;
    } else if (typeof chunk === 'string') {
      yield Buffer.from(chunk, 'utf8');
    } else {
      yield Buffer.from(chunk);
    }
  }
}

function createLocalFileHeader(name: Buffer): Buffer {
  const extra = createZip64LocalExtraField();
  const header = Buffer.alloc(30 + name.length + extra.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION_ZIP64, 4);
  header.writeUInt16LE(ZIP_UTF8_DATA_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(ZIP_STORE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0xffffffff, 18);
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  name.copy(header, 30);
  extra.copy(header, 30 + name.length);
  return header;
}

function createDataDescriptor(crc32: number, size: bigint): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeBigUInt64LE(size, 8);
  descriptor.writeBigUInt64LE(size, 16);
  return descriptor;
}

function createCentralDirectoryHeader(entry: CentralDirectoryEntry): Buffer {
  const extra = createZip64CentralDirectoryExtraField(entry);
  const header = Buffer.alloc(46 + entry.name.length + extra.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION_ZIP64, 4);
  header.writeUInt16LE(ZIP_VERSION_ZIP64, 6);
  header.writeUInt16LE(ZIP_UTF8_DATA_DESCRIPTOR_FLAGS, 8);
  header.writeUInt16LE(ZIP_STORE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(0xffffffff, 20);
  header.writeUInt32LE(0xffffffff, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(0xffffffff, 42);
  entry.name.copy(header, 46);
  extra.copy(header, 46 + entry.name.length);
  return header;
}

function createZip64LocalExtraField(): Buffer {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(ZIP64_EXTRA_FIELD_ID, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(0n, 4);
  extra.writeBigUInt64LE(0n, 12);
  return extra;
}

function createZip64CentralDirectoryExtraField(entry: CentralDirectoryEntry): Buffer {
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(ZIP64_EXTRA_FIELD_ID, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(entry.uncompressedSize, 4);
  extra.writeBigUInt64LE(entry.compressedSize, 12);
  extra.writeBigUInt64LE(entry.localHeaderOffset, 20);
  return extra;
}

function createZip64EndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: bigint,
  centralDirectoryOffset: bigint,
): Buffer {
  const header = Buffer.alloc(56);
  header.writeUInt32LE(0x06064b50, 0);
  header.writeBigUInt64LE(44n, 4);
  header.writeUInt16LE(ZIP_VERSION_ZIP64, 12);
  header.writeUInt16LE(ZIP_VERSION_ZIP64, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(0, 20);
  header.writeBigUInt64LE(BigInt(entryCount), 24);
  header.writeBigUInt64LE(BigInt(entryCount), 32);
  header.writeBigUInt64LE(centralDirectorySize, 40);
  header.writeBigUInt64LE(centralDirectoryOffset, 48);
  return header;
}

function createZip64EndOfCentralDirectoryLocator(zip64EndOffset: bigint): Buffer {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x07064b50, 0);
  header.writeUInt32LE(0, 4);
  header.writeBigUInt64LE(zip64EndOffset, 8);
  header.writeUInt32LE(1, 16);
  return header;
}

function createEndOfCentralDirectory() {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0xffff, 8);
  header.writeUInt16LE(0xffff, 10);
  header.writeUInt32LE(0xffffffff, 12);
  header.writeUInt32LE(0xffffffff, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function normalizeEntryName(name: string): Buffer {
  const normalized = name
    .replace(/\\/gu, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .join('/');
  if (!normalized) {
    throw new Error('zip_entry_name_required');
  }
  return Buffer.from(normalized, 'utf8');
}

function addZipBytes(current: bigint, next: number): bigint {
  return current + BigInt(next);
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function updateCrc32(crc: number, chunk: Buffer): number {
  let value = crc;
  for (const byte of chunk) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff]!;
  }
  return value >>> 0;
}
