# Media Vector Index

Project scaffold local-first cho semantic search ảnh và video trong Apple Photos bằng CLI, tối ưu cho MacBook Air dùng Apple Silicon.

## Trạng thái

Đã hoàn tất `Phase 0: Scope And Decisions`, `Phase 1: Core Design`, và `Phase 2: Scaffold`. Bước kế tiếp ưu tiên là `Phase 3: Ingestion` theo [docs/mvp-checklist.md](/Users/hoaiduc/Documents/VectorDB Image/docs/mvp-checklist.md).

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
- [docs/mvp-checklist.md](/Users/hoaiduc/Documents/VectorDB Image/docs/mvp-checklist.md)

## Bước Tiếp Theo

Thực hiện `Phase 3: Ingestion`: nối Python bridge với Photos framework thật, xin quyền TCC, đọc asset từ Apple Photos, và thay payload scaffold bằng dữ liệu thực cho flow scan và debug.

## Scaffold CLI

Scaffold phase 2 hiện đã có CLI chạy được với command surface ban đầu:

```bash
node ./src/cli/main.js init
node ./src/cli/main.js photos check
node ./src/cli/main.js photos scan
node ./src/cli/main.js photos debug
```

Ghi chú:

- `init` tạo `media-vector-index.config.json` và local storage placeholder trong `.data/`
- các lệnh `photos *` đã nối được sang Python bridge placeholder
- direct Photos framework access, TCC flow, và asset traversal thật sẽ được implement ở `Phase 3: Ingestion`

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

## Config File Đã Chốt

Runtime config đầu tiên được chốt theo hướng một file local duy nhất:

- tên file: `media-vector-index.config.json`
- vị trí mặc định: thư mục làm việc của CLI
- mục tiêu: cấu hình album output, local storage paths, scan/extract/index/retrieve defaults, và embedding provider selection

Config sample và field rules được ghi tại [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md).

## Schema Đã Chốt

Ba contract nền cho bước scaffold tiếp theo đã được chốt:

- `asset record`: catalog nhẹ cho từng `PHAsset.localIdentifier`
- `embedding record`: catalog cho từng representation đã embed
- `retrieval result`: output contract cho CLI và agent workflow

Chi tiết schema v1, field rules, và boundary được ghi tại [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md).

## Photos Bridge Đã Chốt

Runtime integration với Apple Photos được chốt theo hướng:

- `Node.js CLI` cho orchestration
- `Python photos-bridge` cho native Photos access
- `PyObjC` làm bridge vào Photos framework của macOS

Các decision liên quan tới deterministic identity, direct Photos connection, in-memory extraction, iCloud-backed access, và album write-back được ghi tại [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md).

## Re-Index Safety Đã Chốt

Chiến lược re-index đầu tiên đã được chốt theo hướng an toàn cho iCloud-backed assets:

- cùng `PHAsset.localIdentifier` thì giữ nguyên identity
- detect thay đổi bằng fingerprint từ metadata nhẹ + extraction settings + model identity
- nếu refresh mới lỗi tạm thời, giữ embedding cũ ở trạng thái searchable và đánh dấu `stale`

Chi tiết rule được ghi tại [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md).
