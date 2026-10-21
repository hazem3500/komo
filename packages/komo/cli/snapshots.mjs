import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The server stores at most 256 KiB per image and 32 KiB per HTML capture.
const MAX_BYTES = 512 * 1024;

/**
 * Saves a thread's element snapshots under `directory` and returns their paths:
 * THREAD_ID.webp (or .png) for the image and THREAD_ID.html.txt for the HTML,
 * kept as text because it is evidence, never a page to open. Reads use the same
 * credentials as every other command, against the configured endpoint only. A
 * default directory ignores itself in Git, since snapshots may hold page content.
 */
export async function saveSnapshots(config, token, thread, directory, ignore = false) {
  const files = {};
  const kinds = ["image", "html"].filter((kind) => thread.snapshot?.[kind]);
  if (!kinds.length) return files;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (ignore) await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const name = thread.id.replace(/[^\w-]/g, "_");
  for (const kind of kinds) {
    const url = new URL(`threads/${encodeURIComponent(thread.id)}/snapshot/${kind}`, `${config.endpoint}/`);
    for (const key of ["project", "repo", "branch"]) url.searchParams.set(key, config[key]);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Origin: config.origin, Authorization: `Bearer ${token}` },
    });
    // Removed since the thread was listed.
    if (response.status === 404) continue;
    if (!response.ok) {
      const error = Error(
        response.status === 429
          ? "Too many requests. Wait a minute, then run komo comments snapshots THREAD_ID."
          : response.status === 401
            ? "Session missing or expired. Run komo login."
            : `Could not download the ${kind} snapshot (${response.status}).`
      );
      error.status = response.status;
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw Error(`The ${kind} snapshot is larger than expected.`);
    const type = response.headers.get("content-type") ?? "";
    const path = join(directory, `${name}.${kind === "html" ? "html.txt" : type.includes("png") ? "png" : "webp"}`);
    await writeFile(path, bytes, { mode: 0o600 });
    files[kind] = path;
  }
  return files;
}
