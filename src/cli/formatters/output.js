export function hasJsonFlag(args) {
  return args.includes("--json");
}

export function printOutput(payload, options = {}) {
  const { json = false } = options;

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (typeof payload === "string") {
    console.log(payload);
    return;
  }

  if (payload.summary) {
    console.log(payload.summary);
  }

  for (const line of payload.lines ?? []) {
    console.log(line);
  }

  if (payload.notes?.length) {
    console.log("");
    console.log("Notes:");
    for (const note of payload.notes) {
      console.log(`- ${note}`);
    }
  }
}
