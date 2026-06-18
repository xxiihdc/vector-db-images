import { createEmbeddingProvider } from "../../embedding/create-provider.js";
import { normalizeQuery } from "../../enrichment/normalizers/query-normalizer.js";
import { createRetrievalResult } from "../contracts/retrieval-result.js";
import { AppError } from "../../shared/errors/app-error.js";
import { readLocalImageFile } from "../../shared/utils/local-image-file.js";

function buildMatchNotes({ representationKind, assetType, score }) {
  return [
    "top similarity match",
    `${representationKind} representation`,
    `${assetType} asset`,
    `backend score ${score.toFixed(4)}`,
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

  async function searchByPreparedVector({
    queryVector,
    embeddingModel,
    modelIdentity,
    config,
    limit,
    representationKinds = ["image-thumbnail", "video-poster-frame"],
    matchStrategy = "semantic-vector",
    queryText = null,
    queryNotes = [],
  } = {}) {
    const searchLimit = Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : config?.retriever?.default_limit ?? 50;
    const [searchedEmbeddingCount, searchHits] = await Promise.all([
      vectorRepository.countEmbeddings({
        embedding_model: embeddingModel,
        representation_kinds: representationKinds,
        statuses: ["ready", "stale"],
      }),
      vectorRepository.searchByVector({
        vector: queryVector,
        embedding_model: embeddingModel,
        representation_kinds: representationKinds,
        limit: searchLimit,
      }),
    ]);

    if (searchHits.length === 0) {
      return {
        implemented: true,
        phase: "search-and-retrieval",
        status: "completed",
        query_text: queryText,
        result_count: 0,
        results: [],
        searched_embedding_count: searchedEmbeddingCount,
        notes: [
          "Local semantic search found no active embeddings for the configured model.",
        ],
      };
    }

    const candidates = [];
    for (const hit of searchHits) {
      const asset = await catalogRepository.getAssetByAssetId(hit.embedding.asset_id);

      if (!asset) {
        continue;
      }

      candidates.push({
        asset,
        embedding: hit.embedding,
        score: hit.score,
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
          query_text: queryText,
          strategy: matchStrategy,
          model: modelIdentity,
          notes: [
            ...queryNotes,
            ...buildMatchNotes({
              representationKind: candidate.embedding.representation_kind,
              assetType: candidate.asset.asset_type,
              score: candidate.score,
            }),
          ],
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
      query_text: queryText,
      result_count: results.length,
      results,
      searched_embedding_count: searchedEmbeddingCount,
      notes: [
        `Semantic search queried the configured vector backend via ${modelIdentity}.`,
      ],
    };
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

    const embeddingProvider = createEmbeddingProviderFn({ config });
    const queryEmbedding = await embeddingProvider.embedQuery({
      text: normalizedQuery,
    });

    return searchByPreparedVector({
      queryVector: queryEmbedding.vector,
      embeddingModel: queryEmbedding.embedding_model,
      modelIdentity: queryEmbedding.model_identity,
      config,
      limit,
      representationKinds,
      matchStrategy: "semantic-vector",
      queryText: normalizedQuery,
      queryNotes: [`text query: ${normalizedQuery}`],
    });
  }

  async function searchByImage({
    imagePath,
    config,
    limit,
    representationKinds = ["image-thumbnail", "video-poster-frame"],
  } = {}) {
    const imageFile = await readLocalImageFile(imagePath);
    const embeddingProvider = createEmbeddingProviderFn({ config });
    const queryEmbedding = await embeddingProvider.embedImageQuery({
      bytes_base64: imageFile.bytes_base64,
      mime_type: imageFile.mime_type,
    });

    return searchByPreparedVector({
      queryVector: queryEmbedding.vector,
      embeddingModel: queryEmbedding.embedding_model,
      modelIdentity: queryEmbedding.model_identity,
      config,
      limit,
      representationKinds,
      matchStrategy: "semantic-vector-image-query",
      queryText: `[image] ${imageFile.file_name}`,
      queryNotes: [`image query file: ${imageFile.file_name}`],
    });
  }

  return {
    search,
    searchByImage,
  };
}
