import { createEmbeddingProvider } from "../../embedding/create-provider.js";
import { normalizeQuery } from "../../enrichment/normalizers/query-normalizer.js";
import { createRetrievalResult } from "../contracts/retrieval-result.js";
import { AppError } from "../../shared/errors/app-error.js";

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return null;
  }

  if (left.length !== right.length) {
    return null;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);

    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return null;
    }

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function buildMatchNotes({ representationKind, assetType, score }) {
  return [
    "top similarity match",
    `${representationKind} representation`,
    `${assetType} asset`,
    `cosine score ${score.toFixed(4)}`,
  ];
}

export function createSearchService({
  catalogRepository,
  vectorRepository,
  createEmbeddingProviderFn = createEmbeddingProvider,
} = {}) {
  if (!catalogRepository || !vectorRepository) {
    throw new AppError("Search service requires both catalog and vector repositories.", {
      code: "SEARCH_REPOSITORIES_REQUIRED",
    });
  }

  async function search({
    query,
    config,
    limit,
    representationKinds = ["image-thumbnail", "video-poster-frame"],
  } = {}) {
    const normalizedQuery = normalizeQuery(query);

    if (!normalizedQuery) {
      throw new AppError("Search query must not be empty.", {
        code: "SEARCH_QUERY_REQUIRED",
      });
    }

    const searchLimit = Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : config?.retriever?.default_limit ?? 50;
    const embeddingProvider = createEmbeddingProviderFn({ config });
    const queryEmbedding = await embeddingProvider.embedQuery({
      text: normalizedQuery,
    });
    const activeEmbeddings = await vectorRepository.listActiveEmbeddings({
      embedding_model: queryEmbedding.embedding_model,
      representation_kinds: representationKinds,
    });

    if (activeEmbeddings.length === 0) {
      return {
        implemented: true,
        phase: "search-and-retrieval",
        status: "completed",
        query_text: normalizedQuery,
        result_count: 0,
        results: [],
        searched_embedding_count: 0,
        notes: [
          "Local semantic search found no active embeddings for the configured model.",
        ],
      };
    }

    const candidates = [];
    for (const embedding of activeEmbeddings) {
      const [asset, vectorEntry] = await Promise.all([
        catalogRepository.getAssetByAssetId(embedding.asset_id),
        vectorRepository.getVector(embedding.vector_ref),
      ]);

      if (!asset || !vectorEntry?.values?.length) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding.vector, vectorEntry.values);

      if (score === null) {
        continue;
      }

      candidates.push({
        asset,
        embedding,
        score,
      });
    }

    candidates.sort((left, right) => right.score - left.score);

    const results = candidates.slice(0, searchLimit).map((candidate, index) =>
      createRetrievalResult({
        local_identifier: candidate.asset.local_identifier,
        asset_id: candidate.asset.asset_id,
        asset_type: candidate.asset.asset_type,
        embedding_id: candidate.embedding.embedding_id,
        representation_kind: candidate.embedding.representation_kind,
        album_name: config?.app?.results_album_name ?? "AI Search Results",
        score: Number(candidate.score.toFixed(4)),
        rank: index + 1,
        match_evidence: {
          query_text: normalizedQuery,
          strategy: "semantic-vector",
          model: queryEmbedding.embedding_model,
          notes: buildMatchNotes({
            representationKind: candidate.embedding.representation_kind,
            assetType: candidate.asset.asset_type,
            score: candidate.score,
          }),
        },
        debug: {
          source_fingerprint: candidate.embedding.source_fingerprint ?? null,
          embedding_dimensions: candidate.embedding.embedding_dimensions ?? null,
          indexed_at: candidate.embedding.indexed_at ?? null,
        },
      })
    );

    return {
      implemented: true,
      phase: "search-and-retrieval",
      status: "completed",
      query_text: normalizedQuery,
      result_count: results.length,
      results,
      searched_embedding_count: activeEmbeddings.length,
      notes: [
        `Semantic search ranked local image/video embeddings via ${queryEmbedding.model_identity}.`,
      ],
    };
  }

  return {
    search,
  };
}
