import { inflateRawSync } from "node:zlib";

/**
 * A read-only, dependency-free ZIP reader — just enough to extract the XML entries of an OOXML
 * (XLSX/DOCX) container (M5.3). Uploads are an untrusted boundary (PRD §"Security"), so this is
 * deliberately minimal and hardened rather than a general-purpose unzip: it reads the central
 * directory by name, supports only the two real-world methods (stored / DEFLATE), and caps every
 * inflated entry at {@link MAX_ENTRY_BYTES} so a zip-bomb can't amplify a small upload into an
 * out-of-memory. A swappable, heavier parser (or a sandboxed Python worker) can replace this behind
 * the `Parser` seam if format coverage ever falls short.
 */

const EOCD_SIGNATURE = 0x06054b50; // End Of Central Directory record
const CENTRAL_SIGNATURE = 0x02014b50; // Central directory file header
const LOCAL_SIGNATURE = 0x04034b50; // Local file header
const EOCD_MIN_SIZE = 22;

/** Per-entry inflated-size ceiling (32 MiB). Bounds zip-bomb amplification on the untrusted path. */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Thrown when a buffer is not a parseable ZIP container (truncated, corrupt, or not a ZIP). */
export class InvalidZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidZipError";
  }
}

/**
 * Index a ZIP buffer by entry name, returning a reader that inflates entries on demand. Throws
 * {@link InvalidZipError} if the End-Of-Central-Directory record can't be located.
 */
export function openZip(buffer: Buffer): ZipArchive {
  const entries = readCentralDirectory(buffer);
  return new ZipArchive(buffer, entries);
}

export class ZipArchive {
  private readonly byName: Map<string, CentralEntry>;

  constructor(
    private readonly buffer: Buffer,
    entries: CentralEntry[],
  ) {
    this.byName = new Map(entries.map((e) => [e.name, e]));
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** All entry names, in central-directory order — for callers that scan a folder (worksheets/). */
  names(): string[] {
    return [...this.byName.keys()];
  }

  /** Inflate an entry to a UTF-8 string, or return `null` if no such entry exists. */
  readText(name: string): string | null {
    const entry = this.byName.get(name);
    if (!entry) {
      return null;
    }
    return this.readEntry(entry).toString("utf8");
  }

  private readEntry(entry: CentralEntry): Buffer {
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new InvalidZipError(
        `zip entry "${entry.name}" exceeds the ${MAX_ENTRY_BYTES}-byte limit`,
      );
    }
    // The local header repeats name/extra fields whose lengths we must skip to reach the data; the
    // central directory's copies of those lengths can differ, so read them from the local header.
    const lho = entry.localHeaderOffset;
    if (lho + 30 > this.buffer.length || this.buffer.readUInt32LE(lho) !== LOCAL_SIGNATURE) {
      throw new InvalidZipError(`bad local header for "${entry.name}"`);
    }
    const nameLen = this.buffer.readUInt16LE(lho + 26);
    const extraLen = this.buffer.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > this.buffer.length) {
      throw new InvalidZipError(`truncated data for "${entry.name}"`);
    }
    const data = this.buffer.subarray(dataStart, dataEnd);

    if (entry.method === 0) {
      return Buffer.from(data); // stored — no compression
    }
    if (entry.method === 8) {
      return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    }
    throw new InvalidZipError(
      `unsupported compression method ${entry.method} for "${entry.name}"`,
    );
  }
}

/** Parse the central directory, scanning back from the End-Of-Central-Directory record. */
function readCentralDirectory(buffer: Buffer): CentralEntry[] {
  if (buffer.length < EOCD_MIN_SIZE) {
    throw new InvalidZipError("buffer too small to be a ZIP");
  }
  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16); // start of central directory

  const entries: CentralEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new InvalidZipError("corrupt central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Locate the EOCD record by scanning backwards for its signature (it ends with a variable comment). */
function findEocd(buffer: Buffer): number {
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new InvalidZipError("end-of-central-directory record not found");
}
