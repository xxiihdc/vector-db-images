# Media Vector Index

Project scaffold local-first cho semantic search ảnh và video trong Apple Photos bằng CLI, tối ưu cho MacBook Air dùng Apple Silicon.

## Trạng thái

Đã hoàn tất `Phase 0: Scope And Decisions`, `Phase 1: Core Design`, `Phase 2: Scaffold`, và hai bước đầu của `Phase 3: Ingestion` là connect path vào Photos framework và Photos permission flow. Bước kế tiếp ưu tiên là asset enumeration theo [docs/mvp-checklist.md](/Users/hoaiduc/Documents/VectorDB Image/docs/mvp-checklist.md).

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

## Agent Workflow

Repo hiện có skill nội bộ [specialist-agent-flow](/Users/hoaiduc/Documents/VectorDB Image/.agents/skills/specialist-agent-flow/SKILL.md) để route task qua các vai trò `triage-agent`, `planner-agent`, `implementer-agent`, và `verifier-agent`.

Skill này ưu tiên flow `assess -> plan if needed -> implement -> test/visualize summary`, và dùng câu `Chưa có gì để visualize.` khi task không tạo ra artifact có thể preview.

## Bước Tiếp Theo

Tiếp tục `Phase 3: Ingestion`: implement asset enumeration thật sau khi quyền Photos đã được cấp, rồi chuyển sang iCloud-backed access path.

## Scaffold CLI

Scaffold phase 2 hiện đã có CLI chạy được với command surface ban đầu:

```bash
node ./src/cli/main.js init
node ./src/cli/main.js photos check
node ./src/cli/main.js photos request-access
node ./src/cli/main.js photos scan
node ./src/cli/main.js photos debug
```

Ghi chú:

- `init` tạo `media-vector-index.config.json` và local storage placeholder trong `.data/`
- `photos check` và `photos debug` hiện chạy native runtime probe qua Python bridge để kiểm tra `PyObjC`, `Photos.framework`, và trạng thái quyền hiện tại
- `photos request-access` chủ động gọi native Photos authorization request để kích hoạt popup TCC khi trạng thái đang là `not_determined`
- `photos scan` hiện chỉ probe connection readiness; asset enumeration thật vẫn là checklist step riêng trong `Phase 3`
- asset traversal thật và extraction in-memory vẫn tiếp tục được implement ở các step sau của `Phase 3`

## Python Bridge Runtime

Bridge Python hiện cần `PyObjC` để kết nối `Photos.framework`:

```bash
python3 -m pip install -r python/requirements.txt
```

Nếu muốn dùng một interpreter khác với `python3` mặc định của hệ thống, có thể override bằng biến môi trường:

```bash
MVI_PYTHON_BIN=/path/to/python3 node ./src/cli/main.js photos debug
```

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
