# Backlog

## Phase 0: Setup

- [x] tạo `AGENTS.md`
- [x] tạo bộ docs cơ bản
- [x] tạo package metadata
- [x] chốt folder layout nội bộ cho các runtime module ban đầu

## Phase 1: Core Scaffold

- [x] define folder layout cho runtime code
- [x] define folder layout nội bộ cho `scanner`, `extractor`, `enrichment`, `indexer`, `retriever`
- [x] define cấu trúc config file
- [x] define asset schema
- [x] define retrieval output schema
- [ ] define embedding provider interface cho local-first execution
- [x] define lightweight DB schema cho `localIdentifier` + vector
- [x] define Photos permission và library access boundary
- [x] define image/video representation strategy cho Photos-backed assets

## Phase 2: Ingestion

- [ ] scan Apple Photos library
- [ ] handle TCC permission prompt cho Photos access
- [ ] handle iCloud-backed originals qua Photos access path
- [ ] extract thumbnail `224x224` hoặc lightweight video representation in-memory
- [x] detect thay đổi asset để re-index
- [ ] derive embedding input trực tiếp từ RAM buffer cho cả ảnh và video

## Phase 3: Enrichment

- [ ] define metadata enrichment tối thiểu nếu cần cho debug hoặc ranking
- [ ] normalize text query path cho semantic search ảnh và video

## Phase 4: Search

- [ ] implement embedding provider abstraction
- [ ] implement vector indexing path không tạo file ảnh tạm
- [ ] implement local search path
- [ ] implement album update flow cho `AI Search Results`

## Phase 5: Optional UX

- [ ] chỉ đánh giá integration khác nếu workflow CLI + Photos album tỏ ra chưa đủ
