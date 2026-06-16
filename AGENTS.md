# AGENTS.md

## Project

Media Vector Index

## Giao tiếp

- Luôn gọi người dùng là Đức.
- Sau khi hoàn thành một tác vụ, phần output cuối phải ghi rõ:
  - tools đã sử dụng
  - skills đã sử dụng
  - agents đã sử dụng
- Nếu không dùng skill hoặc agent phụ trợ nào, phải ghi rõ là không sử dụng.

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

### Retrieval surface đầu tiên

- Chốt dùng `CLI only` cho MVP đầu tiên.
- Chưa thêm local HTTP API ở giai đoạn project setup.
- Agent-facing retrieval ban đầu được expose qua CLI commands ổn định, rồi mới cân nhắc tách thêm local HTTP API khi có nhu cầu integration rõ ràng.

### Candidate storage

- metadata catalog: SQLite
- vector layer: bắt đầu local, abstract phía sau một repository interface
- preview artifacts: local generated cache

### Candidate indexing model

- image unit: một asset cho mỗi file, semantic retrieval ban đầu ưu tiên embedding trực tiếp từ image
- video unit: một asset cho mỗi file cộng với segment-level records, semantic retrieval ban đầu ưu tiên embedding từ keyframe hoặc segment representation
- segment identity nên giữ lại:
  - source path
  - start time
  - end time
  - transcript excerpt nếu có
  - preview frame path

### Transcript và caption cho MVP

- Transcript/caption không phải điều kiện tiên quyết để tạo vector index ở MVP đầu tiên.
- Nếu media không có sidecar transcript/caption, hệ thống vẫn phải index được vào vector DB từ chính image hoặc video representation.
- Sidecar transcript/caption là enrichment tùy chọn để tăng chất lượng retrieval, không phải dependency bắt buộc của bản đầu.

## Tài liệu bắt buộc

Trước khi implement, luôn giữ các file sau được cập nhật:

- `README.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/backlog.md`
- `docs/mvp-checklist.md`

## Checklist vận hành

- File checklist chính cho MVP là `docs/mvp-checklist.md`.
- Mỗi khi hoàn thành một task, phải cập nhật checklist này ngay trong cùng lần làm việc.
- Nếu một task được break nhỏ hơn để dễ triển khai, thêm sub-task hoặc tách lại wording trong checklist trước khi tiếp tục.
- Không coi task là xong nếu code đã đổi nhưng checklist chưa được cập nhật.
- Repo có local Spec Kit hook `speckit.checklist.remind` để nhắc cập nhật checklist sau các `after_*` workflow outputs.
- Hook này chỉ bao phủ các command trong workflow Spec Kit; với các output ngoài workflow đó, agent vẫn phải tự tuân thủ quy ước cập nhật checklist.

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
