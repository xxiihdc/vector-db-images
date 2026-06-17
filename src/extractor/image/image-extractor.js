import { createRepresentationContract } from "../contracts/representation.js";

export function buildImageRepresentation(payload = {}) {
  return createRepresentationContract({
    ...payload,
    asset_type: "image",
    representation_kind: payload.representation_kind ?? "image-thumbnail",
  });
}

export function collectImageRepresentations(representations = []) {
  return representations
    .filter((representation) => representation.asset_type === "image")
    .map((representation) => buildImageRepresentation(representation));
}
