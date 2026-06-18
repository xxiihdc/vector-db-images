import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AppError } from "../errors/app-error.js";

const IMAGE_MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
]);

function toSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function inferMimeType(filePath) {
  const extension = path.extname(String(filePath ?? "")).toLowerCase();
  return IMAGE_MIME_TYPES.get(extension) ?? "application/octet-stream";
}

export function buildExternalImageLocalIdentifier({ sha256 }) {
  return `external-image:${sha256}`;
}

export async function readLocalImageFile(filePath) {
  const absolutePath = path.resolve(String(filePath ?? ""));

  if (!absolutePath || absolutePath === path.sep) {
    throw new AppError("Image file path is required.", {
      code: "LOCAL_IMAGE_PATH_REQUIRED",
    });
  }

  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch (error) {
    throw new AppError("Image file could not be accessed.", {
      code: "LOCAL_IMAGE_FILE_UNREADABLE",
      details: {
        image_path: absolutePath,
      },
      cause: error,
    });
  }

  if (!fileStats.isFile()) {
    throw new AppError("Image path must point to a file.", {
      code: "LOCAL_IMAGE_FILE_INVALID",
      details: {
        image_path: absolutePath,
      },
    });
  }

  const bytes = await readFile(absolutePath);

  if (bytes.length === 0) {
    throw new AppError("Image file must not be empty.", {
      code: "LOCAL_IMAGE_FILE_EMPTY",
      details: {
        image_path: absolutePath,
      },
    });
  }

  const sha256 = toSha256(bytes);

  return {
    absolute_path: absolutePath,
    file_name: path.basename(absolutePath),
    mime_type: inferMimeType(absolutePath),
    byte_length: bytes.length,
    bytes_base64: bytes.toString("base64"),
    sha256,
    modification_date: fileStats.mtime.toISOString(),
    local_identifier: buildExternalImageLocalIdentifier({ sha256 }),
    source_fingerprint: `external-image:${sha256}:${bytes.length}`,
  };
}
