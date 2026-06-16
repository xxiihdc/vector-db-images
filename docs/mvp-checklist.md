# MVP Checklist

Checklist này là nguồn trạng thái chính cho MVP đầu tiên của Media Vector Index.

Quy ước:
- Mỗi task hoàn thành phải được cập nhật ngay trong file này.
- Nếu task lớn bị tách nhỏ hơn, thêm sub-task mới ngay dưới task cha.
- Chỉ tick `[x]` khi outcome đã hoàn tất ở mức dùng được cho MVP.
- Nếu có quyết định làm đổi phạm vi, cập nhật lại task wording thay vì để checklist lệch với thực tế.

## Phase 0: Scope And Decisions

- [x] Chốt phạm vi MVP và định nghĩa "done" cho bản đầu tiên
- [x] Chốt retrieval surface đầu tiên: CLI only hay CLI + local HTTP API
- [x] Chốt transcript/caption là enrichment tùy chọn; MVP vẫn phải vector-index được khi không có sidecar
- [x] Chốt embedding strategy đầu tiên: giữ abstraction; provider đầu tiên là multimodal embedding local-first trên Apple Silicon, index trực tiếp image và video segment representation
- [x] Chốt storage strategy đầu tiên: SQLite catalog + vector backend local sau repository interface
- [x] Chốt video segmentation baseline: shot-aware segmentation trước, fallback bằng max-duration split để giữ độ chi tiết
- [x] Chốt deterministic asset identity baseline
- [x] Chốt retrieval output contract v1 cho agent

## Phase 1: Core Design

- [ ] Thiết kế folder layout cho các layer `scanner`, `extractor`, `enrichment`, `indexer`, `retriever`
- [ ] Thiết kế cấu trúc config file
- [ ] Định nghĩa schema cho asset record
- [ ] Định nghĩa schema cho segment record
- [ ] Định nghĩa schema cho embedding record
- [ ] Định nghĩa schema output cho retrieval result
- [ ] Định nghĩa deterministic asset identity
- [ ] Định nghĩa chiến lược detect thay đổi file để re-index an toàn

## Phase 2: Scaffold

- [ ] Scaffold package Node.js CLI
- [ ] Tạo các module rỗng theo kiến trúc đã chốt
- [ ] Tạo lệnh CLI khởi tạo project config và local storage
- [ ] Tạo lệnh CLI scan thư mục và liệt kê media hợp lệ

## Phase 3: Ingestion

- [ ] Implement image metadata extraction cơ bản
- [ ] Implement video metadata extraction cơ bản
- [ ] Implement repository interface cho catalog và vector layer
- [ ] Implement index pipeline tối thiểu: scan -> extract -> enrich -> normalize -> persist
- [ ] Implement re-index command để chạy lặp lại không tạo duplicate

## Phase 4: Transcript And Segments

- [ ] Implement transcript sidecar discovery và import nếu có
- [ ] Định nghĩa rule tạo video segment ban đầu
- [ ] Implement segment generation từ transcript hoặc time window fallback
- [ ] Chuẩn hóa text context cho asset và segment trước khi embed
- [ ] Tạo preview reference tối thiểu cho image và keyframe reference cho video segment

## Phase 5: Search And Retrieval

- [ ] Tích hợp embedding provider abstraction với 1 provider hoạt động được
- [ ] Implement vector indexing path cho image và video không phụ thuộc transcript/caption
- [ ] Implement local semantic search cho asset và segment
- [ ] Implement filter cơ bản theo media type, path, và time range
- [ ] Implement agent-facing retrieval command

## Phase 6: Validation And Docs

- [ ] Tạo fixture dataset nhỏ để test end-to-end image + video, kèm transcript sidecar optional
- [ ] Viết test cho identity, re-index, segment creation, transcript linking optional, retrieval output
- [ ] Cập nhật `README.md` với quickstart và workflow CLI
- [ ] Cập nhật `docs/product.md` theo các quyết định MVP đã chốt
- [ ] Cập nhật `docs/architecture.md` theo storage boundary, indexing boundary, retrieval contract
- [ ] Cập nhật `docs/backlog.md` để phản ánh lại phần MVP, post-MVP, và optional Electron
