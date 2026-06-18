import { executeSearchWorkflow } from "../../app/search/execute-search-workflow.js";

function parseSearchArgs(args = []) {
  const positional = [];
  let limit;
  let imagePath = null;
  let skipAlbum = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--limit") {
      const parsed = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      index += 1;
      continue;
    }

    if (value === "--image") {
      imagePath = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--skip-album") {
      skipAlbum = true;
      continue;
    }

    positional.push(value);
  }

  if (!imagePath && positional[0] === "image") {
    imagePath = positional[1] ?? null;
    positional.splice(0, 2);
  }

  return {
    query: positional.join(" ").trim(),
    limit,
    imagePath,
    skipAlbum,
  };
}

export async function runSearchCommand({
  cwd,
  args = [],
  loadConfigFn,
  createStorageRepositoriesFn,
  createSearchServiceFn,
  createAlbumServiceFn,
} = {}) {
  const parsedArgs = parseSearchArgs(args);

  return executeSearchWorkflow({
    cwd,
    query: parsedArgs.query,
    queryImagePath: parsedArgs.imagePath,
    limit: parsedArgs.limit,
    skipAlbum: parsedArgs.skipAlbum,
    loadConfigFn,
    createStorageRepositoriesFn,
    createSearchServiceFn,
    createAlbumServiceFn,
  });
}
