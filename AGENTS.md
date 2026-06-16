# AGENTS.md

## Project

Media Vector Index

## Mục tiêu

Xây dựng một công cụ local-first để index image và video vào một catalog vector-oriented có thể search, để các AI agent về sau có thể:

1. tìm ra media asset phù hợp theo semantic intent
2. kiểm tra video resource theo segment hoặc timestamp
3. lấy đủ metadata, transcript, và preview reference để chọn đúng source material

## Giai đoạn hiện tại

Chỉ đang ở giai đoạn project setup.

Chưa nên implement indexing pipeline, UI, hoặc embedding provider cho đến khi project structure và decision record ổn định.

## Nguyên tắc làm việc

1. Ưu tiên kiến trúc CLI-first.
2. Chỉ thêm Electron nếu visual review, manual tagging, hoặc timeline browsing thật sự cần thiết.
3. Giữ storage layer đầu tiên ở mức local và đơn giản.
4. Tách rõ các concern sau:
   - media discovery
   - metadata extraction
   - transcript và caption enrichment
   - embedding generation
   - vector search
   - agent-facing retrieval API
5. Mọi design choice nên cải thiện ít nhất một trong các outcome sau:
   - reliable re-indexing
   - deterministic asset identity
   - searchable video segments
   - easy future integration with AI agents

## Non-Goals cho bản build đầu tiên

1. cloud deployment
2. multi-user auth
3. polished desktop UI
4. training custom models
5. production-scale distributed vector infrastructure

## Định hướng kỹ thuật ban đầu

### Candidate runtime

- Primary: Node.js CLI
- Optional về sau: Electron shell cho asset browsing

### Candidate storage

- metadata catalog: SQLite
- vector layer: bắt đầu local, abstract phía sau một repository interface
- preview artifacts: local generated cache

### Candidate indexing model

- image unit: một asset cho mỗi file, có thể kèm derived captions/tags
- video unit: một asset cho mỗi file cộng với segment-level records
- segment identity nên giữ lại:
  - source path
  - start time
  - end time
  - transcript excerpt
  - preview frame path

## Tài liệu bắt buộc

Trước khi implement, luôn giữ các file sau được cập nhật:

- `README.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/backlog.md`

## Thứ tự thực hiện

1. define product và retrieval requirements
2. define storage và indexing boundaries
3. define folder layout
4. scaffold package và empty modules
5. implement ingestion cho image và video metadata
6. implement segment và transcript indexing
7. implement embedding provider abstraction
8. implement search và agent retrieval surface

## Ghi chú cho các agent sau này

Đừng nhảy thẳng vào Electron.

Nếu chưa có nhu cầu rõ ràng cho visual review workflow, hãy ưu tiên effort cho ingestion quality, segment retrieval quality, và deterministic local storage trước.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
