# Media Vector Index

Project scaffold local-first cho semantic search ảnh và video trong Apple Photos bằng CLI, tối ưu cho MacBook Air dùng Apple Silicon.

## Trạng thái

Đang ở giai đoạn planning và project setup.

## Mục tiêu

Project này được định hướng trở thành một công cụ CLI-first có khả năng:

1. xin quyền truy cập Photos của macOS và đọc thư viện Apple Photos
2. đọc trực tiếp asset từ app Photos trên macOS, kể cả khi media gốc đang nằm trên iCloud
3. lấy thumbnail hoặc representation cỡ nhỏ trực tiếp vào RAM, không ghi file tạm ra SSD
4. biến thumbnail hoặc video representation thành vector bằng mô hình multimodal local trên Apple Silicon
5. chỉ lưu database nhẹ gồm vector và `PHAsset.localIdentifier`
6. cho phép tìm kiếm ảnh và video bằng câu lệnh tự nhiên trên Terminal
7. đẩy kết quả vào album `AI Search Results` trong app Photos để xem bằng giao diện native

## Vì Sao CLI-First

Rủi ro chính không nằm ở UI. Rủi ro chính nằm ở integration và data flow:

- xin quyền Photos của macOS có hoạt động ổn định không
- Photos access path có làm việc đúng khi asset gốc đang ở iCloud không
- thumbnail hoặc representation có đi thẳng vào RAM mà không phát sinh file tạm không
- `PHAsset.localIdentifier` có đủ ổn định cho re-index không
- kết quả có quay lại Photos app mượt mà qua album native không

Vì vậy, deliverable đầu tiên nên là một indexing và search core ổn định bám sát Photos app, thay vì mở rộng sớm sang UI riêng hoặc media pipeline quá rộng.

## Scope Guardrails

- Đọc thẳng qua Apple Photos trên macOS; không dựa vào filesystem mirror của thư viện.
- Asset gốc có thể đang nằm trên iCloud; hệ thống phải thiết kế theo giả định đó.
- Bản đầu index cả ảnh và video trong Photos.
- Không làm transcript pipeline hoặc UI review riêng ở MVP này.
- Không tạo desktop UI riêng; Photos app là nơi hiển thị kết quả.
- Không lưu thumbnail, preview, video proxy, hay file media nháp ra ổ đĩa.
- Chỉ lưu dữ liệu tối thiểu cần cho semantic search: vector + `localIdentifier`.

## Tài Liệu Dự Kiến

- [AGENTS.md](/Users/hoaiduc/Documents/VectorDB Image/AGENTS.md)
- [docs/product.md](/Users/hoaiduc/Documents/VectorDB Image/docs/product.md)
- [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md)
- [docs/backlog.md](/Users/hoaiduc/Documents/VectorDB Image/docs/backlog.md)

## Bước Tiếp Theo

Hoàn thiện product và architecture docs theo scope Apple Photos trực tiếp + iCloud-backed assets, sau đó scaffold CLI và các runtime module rỗng.

## Folder Layout Đã Chốt

Folder layout baseline cho runtime đã được chốt ở mức thiết kế:

```text
src/
  cli/
  config/
  scanner/
  extractor/
  enrichment/
  indexer/
  retriever/
  storage/
  shared/
```

Layout nội bộ cho các layer cũng đã được chốt để bước scaffold sau không phải đoán lại boundary:

```text
src/
  scanner/{contracts,photos,services}
  extractor/{contracts,image,video}
  enrichment/{contracts,metadata,normalizers}
  indexer/{contracts,pipeline,records}
  retriever/{contracts,query,album}
```

Chi tiết trách nhiệm từng folder được ghi tại [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md).
