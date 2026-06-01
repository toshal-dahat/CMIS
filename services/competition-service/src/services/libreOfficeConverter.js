/**
 * LibreOffice converter — converts PPT/PPTX submissions to PDF.
 *
 * Pipeline: S3 (PPT/PPTX) → Lambda /tmp → LibreOffice --convert-to pdf → S3 (converted PDF)
 *
 * Uses the public shelf.io LibreOffice Lambda Layer (brotli-compressed).
 * The layer ships LibreOffice as `/opt/lo.tar.br`. On first invocation we extract
 * it to `/tmp/instdir`. Subsequent calls on a warm Lambda reuse the extracted binary.
 *
 * Prerequisites:
 *   - Lambda layer attached:  arn:aws:lambda:us-east-1:764866452798:layer:libreoffice-brotli:1
 *   - Lambda memory:          at least 2048 MB (LibreOffice is memory-hungry)
 *   - Ephemeral storage:      at least 1024 MB (for extracted binary + temp files)
 *   - Timeout:                at least 120s
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const tar = require("tar");
const { randomUUID } = require("crypto");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const execFileAsync = promisify(execFile);

const s3Client = new S3Client({});
const BUCKET = process.env.SUBMISSIONS_BUCKET;

// ── Paths (Lambda environment) ─────────────────────────
const LAYER_ARCHIVE = "/opt/lo.tar.br";                       // provided by shelf.io layer
const EXTRACT_ROOT = "/tmp";                                  // where the archive extracts to
const TMP_TAR_PATH = "/tmp/lo.tar";                           // intermediate decompressed tar
const TMP_WORK_DIR = "/tmp/conversions";                      // per-conversion workspace

// ── Config ─────────────────────────────────────────────
const CONVERSION_TIMEOUT_MS = 90 * 1000;                      // 90s — plenty for a single PPTX

// Discovered path to the soffice binary — set once after extraction.
let discoveredSofficeBin = null;

// Names that could reference the LibreOffice entrypoint binary.
// `soffice` is the usual one, but on some layers it's a symlink to `soffice.bin`.
const SOFFICE_CANDIDATES = new Set(["soffice", "soffice.bin"]);

/**
 * Recursively walk a directory looking for the soffice binary.
 *
 * The shelf.io layer normally extracts to /tmp/instdir/program/soffice, but
 * we walk rather than assume to be robust to layer changes. We check for files
 * AND symlinks — on many LibreOffice builds, `soffice` is a symlink to
 * `soffice.bin`, and Dirent.isFile() returns false for symlinks.
 */
async function findSofficeBinary(rootDir, depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return null;
  let entries;
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  // First pass: look for a candidate name in THIS directory (file or symlink).
  for (const entry of entries) {
    if (!SOFFICE_CANDIDATES.has(entry.name)) continue;
    if (entry.isFile() || entry.isSymbolicLink()) {
      const candidatePath = path.join(rootDir, entry.name);
      // For a symlink, verify the target resolves to something we can stat.
      try {
        const stat = await fsp.stat(candidatePath); // stat follows symlinks
        if (stat.isFile()) return candidatePath;
      } catch {
        // Symlink target missing — keep searching
      }
    }
  }

  // Second pass: descend into subdirectories.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (rootDir === EXTRACT_ROOT && entry.name === "conversions") continue;
    const found = await findSofficeBinary(path.join(rootDir, entry.name), depth + 1, maxDepth);
    if (found) return found;
  }

  return null;
}

/**
 * List top-level contents of a directory for diagnostic logging.
 */
async function listDirForDiagnostics(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => {
      if (e.isDirectory()) return `${e.name}/`;
      if (e.isSymbolicLink()) return `${e.name}@`;
      return e.name;
    });
  } catch (err) {
    return [`<readdir failed: ${err.message}>`];
  }
}

/**
 * One-time (per Lambda container) extraction of LibreOffice from the layer archive.
 *
 * Flow:
 *   1. Verify layer archive exists
 *   2. Brotli-decompress /opt/lo.tar.br → /tmp/lo.tar  (Node's built-in zlib)
 *   3. Extract tar into /tmp using npm `tar` package   (pure JS, no binary deps)
 *   4. Recursively locate soffice binary in /tmp
 *   5. Delete intermediate tar file
 *   6. Cache the discovered path for warm invocations
 *
 * Guarded by a module-level promise so concurrent invocations don't race.
 */
let extractionPromise = null;

async function ensureLibreOfficeReady() {
  // Fast path: already discovered on a warm container
  if (discoveredSofficeBin && fs.existsSync(discoveredSofficeBin)) {
    return discoveredSofficeBin;
  }

  // Concurrent invocation already doing the work?
  if (extractionPromise) return extractionPromise;

  if (!fs.existsSync(LAYER_ARCHIVE)) {
    throw new Error(
      `LibreOffice layer archive not found at ${LAYER_ARCHIVE}. ` +
      `Ensure the 'libreoffice-brotli' Lambda layer is attached to this function.`
    );
  }

  extractionPromise = (async () => {
    const start = Date.now();

    // Log archive size so we can sanity-check the layer attachment
    const archiveStats = await fsp.stat(LAYER_ARCHIVE);
    console.log(`Extracting LibreOffice layer: ${LAYER_ARCHIVE} (${Math.round(archiveStats.size / 1024 / 1024)}MB brotli-compressed)`);

    // Step 1: Brotli-decompress to /tmp/lo.tar. Node has built-in brotli support,
    // so we don't need the `brotli` CLI (not available in Lambda Node 20 base image).
    const decompressStart = Date.now();
    await pipeline(
      fs.createReadStream(LAYER_ARCHIVE),
      zlib.createBrotliDecompress(),
      fs.createWriteStream(TMP_TAR_PATH)
    );
    const tarStats = await fsp.stat(TMP_TAR_PATH);
    console.log(`Brotli decompressed in ${Date.now() - decompressStart}ms → ${TMP_TAR_PATH} (${Math.round(tarStats.size / 1024 / 1024)}MB)`);

    // Step 2: Extract tar using pure-JS npm `tar` package.
    // Using { file, cwd } form (not stream form) is more reliable and waits for completion.
    const extractStart = Date.now();
    await tar.x({
      file: TMP_TAR_PATH,
      cwd: EXTRACT_ROOT,
    });
    console.log(`Tar extracted in ${Date.now() - extractStart}ms`);

    // Step 3: Clean up the intermediate tar to free /tmp space.
    await fsp.unlink(TMP_TAR_PATH).catch(() => { /* best-effort */ });

    // Step 4: Log what actually ended up in /tmp
    const tmpContents = await listDirForDiagnostics(EXTRACT_ROOT);
    console.log(`/tmp after extraction: [${tmpContents.join(", ")}]`);

    // Step 5: Locate soffice binary (don't assume path — walk the tree,
    // checking both regular files and symlinks).
    const sofficePath = await findSofficeBinary(EXTRACT_ROOT);
    if (!sofficePath) {
      // Deeper diagnostics: show what's inside instdir/ and instdir/program/
      const instdir = path.join(EXTRACT_ROOT, "instdir");
      const programDir = path.join(instdir, "program");
      const instContents = await listDirForDiagnostics(instdir);
      const programContents = await listDirForDiagnostics(programDir);

      throw new Error(
        `Extraction succeeded but 'soffice' binary not found anywhere in ${EXTRACT_ROOT}. ` +
        `/tmp: [${tmpContents.join(", ")}]. ` +
        `instdir/: [${instContents.slice(0, 20).join(", ")}]. ` +
        `instdir/program/: [${programContents.slice(0, 20).join(", ")}]. ` +
        `(Archive: ${Math.round(archiveStats.size / 1024 / 1024)}MB brotli, ` +
        `${Math.round(tarStats.size / 1024 / 1024)}MB tar)`
      );
    }

    // Ensure the binary is executable (tar should preserve perms, but double-check)
    try {
      await fsp.chmod(sofficePath, 0o755);
    } catch { /* ignore */ }

    discoveredSofficeBin = sofficePath;
    console.log(`LibreOffice ready in ${Date.now() - start}ms — soffice at ${sofficePath}`);
    return sofficePath;
  })();

  try {
    return await extractionPromise;
  } catch (err) {
    extractionPromise = null; // allow retry on next call
    // Also clean up any partial tar file
    await fsp.unlink(TMP_TAR_PATH).catch(() => {});
    throw err;
  }
}

/**
 * Download an S3 object to a local file path, streaming to avoid memory pressure.
 */
async function downloadFromS3(s3Key, localPath) {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  }));

  await pipeline(response.Body, fs.createWriteStream(localPath));
}

/**
 * Upload a local file to S3 under the given key.
 */
async function uploadToS3(localPath, s3Key, contentType) {
  const fileStream = fs.createReadStream(localPath);

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: fileStream,
    ContentType: contentType,
  }));
}

/**
 * Best-effort cleanup — deletes files, ignores "file not found" errors.
 */
async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`Failed to cleanup ${filePath}:`, err.message);
    }
  }
}

/**
 * Convert a PPT/PPTX submission to PDF and store the result in S3.
 *
 * @param {Object} params
 * @param {string} params.sourceS3Key - Original PPT/PPTX key in S3
 * @param {string} params.fileType - Original MIME type
 * @param {string} params.competitionId - For naming the converted file
 * @param {string} params.teamId - For naming the converted file
 * @returns {Promise<string>} - S3 key of the converted PDF
 * @throws {Error} with statusCode 502 if conversion fails
 */
async function convertToPdf({ sourceS3Key, fileType, competitionId, teamId }) {
  if (!BUCKET) {
    throw new Error("SUBMISSIONS_BUCKET environment variable is not set");
  }

  // Ensure LibreOffice is ready and get the discovered soffice path.
  const sofficeBin = await ensureLibreOfficeReady();

  // Determine file extension from MIME type
  const extMap = {
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  const sourceExt = extMap[fileType];
  if (!sourceExt) {
    const err = new Error(`Cannot convert unsupported file type: ${fileType}`);
    err.statusCode = 400;
    throw err;
  }

  // Prepare per-conversion workspace to avoid concurrent conflicts
  const conversionId = randomUUID();
  const workDir = path.join(TMP_WORK_DIR, conversionId);
  await fsp.mkdir(workDir, { recursive: true });

  const inputFile = path.join(workDir, `input.${sourceExt}`);
  const expectedOutput = path.join(workDir, `input.pdf`);

  try {
    // 1. Download source file from S3
    console.log(`Downloading ${sourceS3Key} for conversion...`);
    await downloadFromS3(sourceS3Key, inputFile);

    // 2. Run LibreOffice. `-env:UserInstallation` isolates config per invocation so concurrent runs don't clash.
    console.log(`Running LibreOffice conversion for ${conversionId}...`);
    const loStart = Date.now();

    await execFileAsync(sofficeBin, [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      `-env:UserInstallation=file://${workDir}/profile`,
      "--convert-to", "pdf",
      "--outdir", workDir,
      inputFile,
    ], {
      timeout: CONVERSION_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });

    console.log(`LibreOffice conversion completed in ${Date.now() - loStart}ms`);

    // 3. Verify the output file exists
    if (!fs.existsSync(expectedOutput)) {
      throw new Error("LibreOffice did not produce the expected PDF output");
    }

    // 4. Upload converted PDF to S3
    const destKey = `converted/${competitionId}/${teamId}/${conversionId}.pdf`;
    console.log(`Uploading converted PDF to ${destKey}...`);
    await uploadToS3(expectedOutput, destKey, "application/pdf");

    return destKey;
  } catch (err) {
    console.error("LibreOffice conversion failed:", {
      sourceS3Key,
      fileType,
      error: err.message,
      stderr: err.stderr?.toString?.(),
    });
    const error = new Error(
      `Failed to convert ${sourceExt.toUpperCase()} submission to PDF. ` +
      `The file may be corrupted or use an unsupported feature.`
    );
    error.statusCode = 502;
    throw error;
  } finally {
    // Cleanup /tmp files. Ignore errors — /tmp is ephemeral anyway.
    try {
      await fsp.rm(workDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

module.exports = {
  convertToPdf,
  ensureLibreOfficeReady,
};
