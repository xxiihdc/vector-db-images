# MVP Checklist

Checklist này là nguồn trạng thái chính cho MVP đầu tiên của Media Vector Index.

Quy ước:
- Mỗi task hoàn thành phải được cập nhật ngay trong file này.
- Nếu task lớn bị tách nhỏ hơn, thêm sub-task mới ngay dưới task cha.
- Chỉ tick `[x]` khi outcome đã hoàn tất ở mức dùng được cho MVP.
- Nếu có quyết định làm đổi phạm vi, cập nhật lại task wording thay vì để checklist lệch với thực tế.

## Phase 0: Scope And Decisions

- [x] Chốt phạm vi MVP và định nghĩa "done" cho bản đầu tiên
- [x] Chốt retrieval surface đầu tiên: CLI only
- [x] Chốt source library đầu tiên: Apple Photos trên macOS, đọc trực tiếp qua Photos app access path
- [x] Chốt scope asset đầu tiên: index cả ảnh và video trong Photos
- [x] Chốt iCloud assumption: asset gốc có thể nằm trên iCloud, không giả định filesystem local copy
- [x] Chốt zero-storage rule: thumbnail hoặc video representation chỉ đi qua RAM, không lưu file nháp ra SSD
- [x] Chốt embedding strategy đầu tiên: giữ abstraction; provider đầu tiên là multimodal embedding local-first trên Apple Silicon
- [x] Chốt storage strategy đầu tiên: DB local rất nhẹ chỉ lưu vector + `PHAsset.localIdentifier`
- [x] Chốt output workflow đầu tiên: đẩy kết quả vào album `AI Search Results` trong Photos
- [x] Chốt deterministic asset identity baseline
- [x] Chốt retrieval output contract v1 cho agent

## Phase 1: Core Design

- [x] Thiết kế folder layout cho các layer `scanner`, `extractor`, `enrichment`, `indexer`, `retriever`
- [ ] Thiết kế cấu trúc config file
- [ ] Định nghĩa schema cho asset record
- [ ] Định nghĩa schema cho embedding record
- [ ] Định nghĩa schema output cho retrieval result
- [ ] Định nghĩa deterministic asset identity từ `PHAsset.localIdentifier`
- [ ] Định nghĩa boundary cho Photos permission và library access
- [ ] Định nghĩa strategy lấy image thumbnail và video representation hoàn toàn in-memory
- [ ] Định nghĩa strategy xử lý asset gốc nằm trên iCloud
- [ ] Định nghĩa chiến lược detect thay đổi asset để re-index an toàn

## Phase 2: Scaffold

- [ ] Scaffold package Node.js CLI
- [ ] Tạo các module rỗng theo kiến trúc đã chốt
- [ ] Tạo lệnh CLI khởi tạo project config và local storage
- [ ] Tạo lệnh CLI scan thư viện Photos và liệt kê asset hợp lệ

## Phase 3: Ingestion

- [ ] Implement Photos permission flow và xác thực popup TCC
- [ ] Implement access path cho asset gốc nằm trên iCloud qua Photos framework
- [ ] Implement thumbnail extraction `224x224` và video representation chạy hoàn toàn in-memory
- [ ] Implement repository interface cho local DB và vector layer
- [ ] Implement index pipeline tối thiểu: scan Photos -> extract representation -> normalize -> persist
- [ ] Implement re-index command để chạy lặp lại không tạo duplicate

## Phase 4: Search And Retrieval

- [ ] Tích hợp embedding provider abstraction với 1 provider hoạt động được
- [ ] Implement vector indexing path cho ảnh và video không tạo file tạm
- [ ] Implement local semantic search cho asset image và video
- [ ] Implement album output flow cho `AI Search Results`
- [ ] Implement lệnh CLI `search "..."` với output đủ cho debug

## Phase 5: Validation And Docs

- [ ] Tạo fixture hoặc test strategy phù hợp cho Photos access, iCloud-backed assets, và in-memory representation flow
- [ ] Viết test cho identity, re-index, zero-storage representation path, retrieval output, album update flow
- [ ] Cập nhật `README.md` với quickstart và workflow CLI
- [x] Cập nhật `docs/product.md` theo các quyết định MVP đã chốt
- [x] Cập nhật `docs/architecture.md` theo storage boundary, indexing boundary, retrieval contract
- [x] Cập nhật `docs/backlog.md` để phản ánh lại phần MVP và Photos-native workflow
