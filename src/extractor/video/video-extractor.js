import { createRepresentationContract } from "../contracts/representation.js";

export function buildVideoRepresentation(payload = {}) {
  return createRepresentationContract({
    ...payload,
    asset_type: "video",
    representation_kind: payload.representation_kind ?? "video-poster-frame",
  });
}

export function collectVideoRepresentations(representations = []) {
  return representations
    .filter((representation) => representation.asset_type === "video")
    .map((representation) => buildVideoRepresentation(representation));
}
