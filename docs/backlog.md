# Backlog

## Phase 0: Setup

- [x] tạo `AGENTS.md`
- [x] tạo bộ docs cơ bản
- [x] tạo package metadata
- [ ] chốt các runtime module ban đầu

## Phase 1: Core Scaffold

- [ ] define folder layout cho runtime code
- [ ] define cấu trúc config file
- [ ] define asset schema
- [ ] define segment schema
- [ ] define retrieval output schema
- [ ] define embedding provider interface cho local-first execution
- [ ] define shot-aware segmentation config và max segment duration rule

## Phase 2: Ingestion

- [ ] scan các thư mục image và video
- [ ] detect thay đổi file để re-index
- [ ] extract image metadata
- [ ] extract video metadata
- [ ] derive segment windows
- [ ] derive visual representation cho asset và segment để phục vụ embedding

## Phase 3: Enrichment

- [ ] import transcript sidecars nếu có
- [ ] attach captions hoặc descriptions như enrichment layer
- [ ] normalize textual context cho từng asset và segment

## Phase 4: Search

- [ ] implement embedding provider abstraction
- [ ] implement vector indexing path không phụ thuộc transcript/caption
- [ ] implement local search path
- [ ] implement agent-facing retrieval command

## Phase 5: Optional UX

- [ ] đánh giá nhu cầu cho Electron viewer
- [ ] chỉ thêm timeline và preview workflow nếu CLI cho thấy chưa đủ
