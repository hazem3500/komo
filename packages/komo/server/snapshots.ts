import { check, HttpError } from "./validation";

// Opt-in element snapshots attached to a thread: at most one image and one
// HTML capture each. They may contain page content or user data, so they are
// never public: reads need a session, and HTML is served as inert text.
export type SnapshotKind = "image" | "html";
export const SNAPSHOT_KINDS: readonly SnapshotKind[] = ["image", "html"];
export const SNAPSHOT_LIMITS: Record<SnapshotKind, number> = {
  image: 256 * 1024,
  html: 32 * 1024,
};
/** Default total snapshot storage per project; `maxSnapshotBytes` overrides it. */
export const SNAPSHOT_PROJECT_BYTES = 50 * 1024 * 1024;
/** Hosted workspaces share their 10 MiB budget; snapshots may use half of it. */
export const HOSTED_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/webp", "image/png"];
// A multipart envelope adds boundaries and part headers around the file.
const MULTIPART_OVERHEAD = 16 * 1024;
/** One base64 image record plus its metadata fits in a snapshot import request. */
export const SNAPSHOT_IMPORT_BYTES =
  Math.ceil(SNAPSHOT_LIMITS.image / 3) * 4 + 8192;

export type Snapshot = { kind: SnapshotKind; mime: string; bytes: Uint8Array };

export function snapshotKind(value: unknown): SnapshotKind {
  check(
    typeof value === "string" && (SNAPSHOT_KINDS as string[]).includes(value),
    400,
    "Choose an image or html snapshot."
  );
  return value as SnapshotKind;
}

export async function readLimited(request: Request, max: number, message = "Request too large.") {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > max) throw new HttpError(413, message);
  const reader = request.body?.getReader();
  check(reader, 400, "Missing body.");
  let length = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new HttpError(413, message);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

const tooLarge = (kind: SnapshotKind) =>
  `The ${kind === "image" ? "image" : "HTML"} snapshot exceeds ${SNAPSHOT_LIMITS[kind] / 1024} KiB.`;
const mediaType = (value: string | null | undefined) =>
  (value ?? "").split(";")[0].trim().toLowerCase();

/** Validates a snapshot's declared type, size, and actual contents. */
export function snapshotValue(
  kind: SnapshotKind,
  declaredType: string,
  bytes: Uint8Array
): Snapshot {
  const mime = mediaType(declaredType);
  if (kind === "image") {
    check(
      IMAGE_TYPES.includes(mime),
      415,
      "Use image/webp or image/png for image snapshots."
    );
  } else {
    check(mime === "text/html", 415, "Use text/html for HTML snapshots.");
    const charset = /;\s*charset=("?)([^";]+)\1/i.exec(declaredType)?.[2];
    check(
      !charset || /^utf-?8$/i.test(charset),
      415,
      "Send HTML snapshots as UTF-8."
    );
  }
  check(bytes.length > 0, 400, "The snapshot is empty.");
  check(bytes.length <= SNAPSHOT_LIMITS[kind], 413, tooLarge(kind));
  if (kind === "image") {
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.subarray(start, end));
    const png =
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, index) => bytes[index] === byte
      );
    const webp =
      bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    check(
      mime === "image/png" ? png : webp,
      415,
      "The image does not match its declared type."
    );
  } else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new HttpError(415, "Send HTML snapshots as UTF-8.");
    }
  }
  return { kind, mime, bytes };
}

/**
 * Reads an upload as a raw body (Content-Type is the snapshot's type) or as
 * multipart/form-data with a `kind` field and a `file` part. Size is capped
 * while streaming, separately from the JSON body limit.
 */
export async function readSnapshot(
  request: Request,
  requestedKind: string | null
): Promise<Snapshot> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (mediaType(contentType) === "multipart/form-data") {
    const limit =
      (requestedKind
        ? SNAPSHOT_LIMITS[snapshotKind(requestedKind)]
        : SNAPSHOT_LIMITS.image) + MULTIPART_OVERHEAD;
    const raw = await readLimited(request, limit, "The snapshot is too large.");
    let form: FormData;
    try {
      form = await new Response(raw, {
        headers: { "Content-Type": contentType },
      }).formData();
    } catch {
      throw new HttpError(400, "Invalid multipart body.");
    }
    const field = form.get("kind");
    const kind = snapshotKind(requestedKind ?? field);
    check(
      field === null || field === kind,
      400,
      "The snapshot kind does not match."
    );
    const file = form.get("file");
    check(
      file && typeof file === "object",
      400,
      "Attach the snapshot as a file field."
    );
    const blob = file as Blob;
    check(blob.size <= SNAPSHOT_LIMITS[kind], 413, tooLarge(kind));
    return snapshotValue(kind, blob.type, new Uint8Array(await blob.arrayBuffer()));
  }
  const mime = mediaType(contentType);
  const kind = snapshotKind(
    requestedKind ??
      (mime.startsWith("image/") ? "image" : mime === "text/html" ? "html" : null)
  );
  const bytes = await readLimited(request, SNAPSHOT_LIMITS[kind], tooLarge(kind));
  return snapshotValue(kind, contentType, bytes);
}

/** D1 returns BLOBs as number arrays; PostgreSQL returns Buffers. */
export function blobBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw Error("Unsupported snapshot storage value");
}

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function fromBase64(value: unknown): Uint8Array {
  check(
    typeof value === "string" &&
      value.length <= SNAPSHOT_IMPORT_BYTES &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    400,
    "Invalid snapshot data."
  );
  let binary: string;
  try {
    binary = atob(value as string);
  } catch {
    throw new HttpError(400, "Invalid snapshot data.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Inserts a snapshot only while the project's snapshot total, excluding the
 * one it replaces, stays within `cap`. Hosted quota triggers also count it.
 */
export function storeSnapshot(
  db: D1Database,
  project: string,
  threadId: string,
  snapshot: Snapshot,
  createdAt: number,
  cap: number,
  replace: boolean
) {
  return db
    .prepare(
      `INSERT ${replace ? "" : "OR IGNORE "}INTO snapshots(thread_id,kind,mime,bytes,size,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(s.size),0) FROM snapshots s JOIN threads t ON t.id=s.thread_id WHERE t.project=? AND NOT (s.thread_id=? AND s.kind=?))+?<=?${
        replace
          ? " ON CONFLICT(thread_id,kind) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,size=excluded.size,created_at=excluded.created_at"
          : " RETURNING thread_id"
      }`
    )
    .bind(
      threadId,
      snapshot.kind,
      snapshot.mime,
      snapshot.bytes,
      snapshot.bytes.length,
      createdAt,
      project,
      threadId,
      snapshot.kind,
      snapshot.bytes.length,
      cap
    );
}

export function snapshotCap(limit: number | undefined) {
  return limit !== undefined && Number.isSafeInteger(limit) && limit >= 0
    ? limit
    : SNAPSHOT_PROJECT_BYTES;
}

/** Older databases may not have run the snapshot migration yet. */
export function missingSnapshots(error: unknown) {
  return (
    error instanceof Error &&
    /no such table: snapshots|relation "snapshots" does not exist/.test(
      error.message
    )
  );
}
