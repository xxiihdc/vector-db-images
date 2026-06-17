export function createIndexPipelineScaffold() {
  return {
    status: "scaffold",
    stages: ["scan", "extract", "normalize", "persist"],
    implementation: "pending",
  };
}
