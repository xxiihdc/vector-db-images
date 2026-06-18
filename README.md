# Media Vector Index

Project scaffold local-first cho semantic search ảnh và video trong Apple Photos bằng CLI, tối ưu cho MacBook Air dùng Apple Silicon.

## Trạng thái

Đã hoàn tất `Phase 0: Scope And Decisions`, `Phase 1: Core Design`, `Phase 2: Scaffold`, và toàn bộ `Phase 3: Ingestion` hiện tại gồm connect path vào Photos framework, Photos permission flow, asset enumeration, iCloud-backed original access path, in-memory thumbnail/video representation extraction, repository interface cho local catalog cùng vector layer, index pipeline tối thiểu, và re-index command chạy lặp lại không tạo duplicate theo [docs/mvp-checklist.md](/Users/hoaiduc/Documents/VectorDB Image/docs/mvp-checklist.md).

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

Sau mỗi task hoàn tất, agent cũng phải tự làm một retrospective ngắn: xem có bước nào chậm, thủ công, hoặc dễ tối ưu hơn không; nếu có, phải hỏi lại Đức ngay trong phần kết để đề xuất tối ưu workflow tiếp theo.

## Bước Tiếp Theo

Tiếp tục `Phase 5: Validation And Docs`: ưu tiên verify end-to-end flow `connect Photos -> xin quyền -> index -> search -> album output` trên máy thật.

## Scaffold CLI

Scaffold phase 2 hiện đã có CLI chạy được với command surface ban đầu:

```bash
node ./src/cli/main.js init
node ./src/cli/main.js index --progress-every 10 --profile
node ./src/cli/main.js index --no-cache --progress-every 10 --profile
node ./src/cli/main.js reindex --progress-every 10 --profile
node ./src/cli/main.js search "sunset beach"
node ./src/cli/main.js storage vector-check
node ./src/cli/main.js photos check
node ./src/cli/main.js photos request-access
node ./src/cli/main.js photos scan
node ./src/cli/main.js photos debug
node ./src/cli/main.js photos capabilities
node ./src/cli/main.js photos probe-originals
node ./src/cli/main.js photos extract
node ./src/cli/main.js embedding capabilities
```

Ghi chú:

- `init` tạo `media-vector-index.config.json`, bootstrap catalog store local trong `.data/`, và report trạng thái reachability của `Qdrant`
- `photos check` và `photos debug` hiện chạy native runtime probe qua Python bridge để kiểm tra `PyObjC`, `Photos.framework`, và trạng thái quyền hiện tại
- `photos request-access` chủ động gọi native Photos authorization request để kích hoạt popup TCC khi trạng thái đang là `not_determined`
- `photos scan` hiện enumerate asset thật từ Photos framework sau khi quyền đã được cấp và trả về normalized asset candidates
- `photos capabilities` là preflight probe để kiểm tra nhanh native bridge đang có `Photos`, `AppKit`, `Quartz`, `AVFoundation`, cùng trạng thái permission/library access trước khi debug extraction
- `embedding capabilities` là preflight probe cho `open-clip`; khi thiếu runtime, output sẽ nói rõ thiếu thư viện nào và đưa luôn command cài nếu đó là Python library
- `photos probe-originals` dùng Photos-managed resource request với `networkAccessAllowed` để thử chạm asset gốc cho cả asset local và iCloud-backed mà không export file ra workspace
- `photos extract` lấy batch 10 asset gần nhất theo mặc định, tạo thumbnail ảnh `224x224` và video poster frame hoàn toàn in-memory để verify extractor path mà không cần chạy full scan output
- `photos extract` và `index --no-cache` giờ stream progress trực tiếp từ Python Photos bridge qua `stderr` với prefix `[photos-bridge:extract-representations]`, nên nếu extraction chậm hoặc kẹt ở một asset cụ thể thì terminal sẽ hiện asset đang xử lý thay vì đứng im như hộp đen
- `index` mặc định ưu tiên dùng cache từ local catalog/vector state nếu đã có dữ liệu, để tránh rescan Photos lặp lại; thêm `--no-cache` khi cần ép refresh cache từ Photos
- khi `index --no-cache` chạy refresh thật, flow nối scan + extraction + normalize + persist vào local catalog + `Qdrant`, rồi gọi embedding provider abstraction để batch semantic vector cho cả image thumbnail và video poster frame hoàn toàn in-memory
- full-library extraction trong `index` hiện tự chia thành nhiều bridge batch nhỏ để tránh lỗi `PYTHON_BRIDGE_OUTPUT_TOO_LARGE` khi tổng JSON payload thumbnail/video quá lớn
- mỗi extraction batch giờ được `prepare -> embed -> persist` ngay, nên nếu một batch sau lỗi thì các batch trước vẫn đã được checkpoint vào local catalog và `Qdrant`
- persist vào `Qdrant` giờ dùng bulk upsert theo chunk thay vì từng embedding một, nên full-library run giảm đáng kể số HTTP round-trip tới vector backend
- khi `Qdrant` đóng socket hoặc chập chờn trong lúc bulk persist, pipeline sẽ retry ngắn cho từng sub-batch thay vì fail ngay ở lỗi transport đầu tiên
- `index` và `reindex` giờ in progress log theo stage; có thể chỉnh nhịp bằng `--progress-every <n>` để log sau mỗi `n` embeddings persist thành công
- thêm `--profile` để in timing breakdown, throughput, slowest stage, và skip breakdown phục vụ benchmark
- local semantic search core hiện normalize query, embed text query bằng cùng model identity, rồi query semantic trực tiếp qua `Qdrant` thay vì cosine ranking thuần trong app layer
- runtime hiện đã có album service và Python bridge command để tạo hoặc tìm lại album `AI Search Results`, rồi resolve ordered `local_identifier` list thành native `PHAsset` write-back ngay trong Photos bridge
- album output flow hiện normalize retrieval results thành ordered unique `local_identifier` write-set, giữ `album_write_mode`, gọi native album mutation qua stdin payload, và trả về `applied_asset_count` cùng `unresolved_results` cho debug
- `search "..."` giờ đã nối local semantic retrieval với album write-back: command sẽ load local catalog + vector backend config, query semantic matches từ `Qdrant`, update album `AI Search Results`, và in ra debug lines gồm query, counts, top match, cùng unresolved write-back rows nếu có
- `storage vector-check` là preflight command để tách lỗi reachability của `Qdrant` khỏi lỗi embedding/search logic

### Qdrant local sidecar

Semantic retrieval MVP hiện mặc định dùng `Qdrant` local tại `http://127.0.0.1:6333`.

Docker quickstart:

```bash
docker run -p 6333:6333 -v "$(pwd)/.data/qdrant:/qdrant/storage" qdrant/qdrant
node ./src/cli/main.js storage vector-check
```

Benchmark workflow gợi ý:

```bash
node ./src/cli/main.js storage vector-check
node ./src/cli/main.js index --limit 100 --no-cache --profile
node ./src/cli/main.js index --limit 300 --no-cache --profile
node ./src/cli/main.js index --limit 1000 --no-cache --profile
```

Ghi chú:

- flow hiện tại là `batch-per-stage`, chưa phải streaming pipeline
- timing breakdown chủ yếu giúp xác định bước tối ưu tiếp theo như extractor concurrency, true embedding batching, hoặc bulk Qdrant upsert
- `reindex` là command riêng cho forced refresh; nó luôn bypass cache và chạy lại refresh path nhưng vẫn giữ deterministic upsert để rerun không tạo duplicate asset hay embedding row
- khi CLI gặp lỗi, diagnostic log JSON sẽ được ghi vào `logs/` để giữ lại stacktrace và context điều tra
- provider mặc định hiện là `open-clip`; model pretrained sẽ được OpenCLIP tự download ở lần chạy đầu tiên nếu máy có internet và local cache chưa có

## Workflow Scripts

Khi đổi `DEFAULT_CONFIG`, storage path, hoặc config sample, dùng các script chuẩn sau thay vì sync tay:

```bash
npm run config:sync-sample
npm run config:check-sample
npm run test:storage
npm run verify:storage
npm run verify:index-cache
npm run verify:embedding
npm run verify:search-core
```

Ghi chú:

- `config:sync-sample` rewrite `media-vector-index.config.json` từ `DEFAULT_CONFIG`
- `config:check-sample` fail nếu sample config trong repo lệch khỏi `DEFAULT_CONFIG`
- `test:storage` hiện đã bao gồm check sync config sample trước khi chạy test storage
- `verify:storage` chạy full flow nhẹ cho storage gồm check sample config, test storage, rồi `init --force`
- `verify:index-cache` chạy test storage trước, rồi verify ngắn cả hai path `index`: cache hit mặc định và forced refresh với `--no-cache`
- `verify:embedding` chạy tuần tự `config:check-sample` rồi probe `embedding capabilities` để tránh false negative do chạy song song
- `verify:search-core` chạy `config:check-sample` rồi chỉ execute subset test cho text-query embedding và local semantic search image/video, để verify Phase 4 nhanh hơn mà không phải chạy cả suite storage

## Python Bridge Runtime

Bridge Python hiện cần `PyObjC` để kết nối `Photos.framework`:

```bash
python3 -m pip install -r python/requirements.txt
```

Ghi chú hiệu năng:

- image extraction ưu tiên path `Quartz/ImageIO` để downsample thumbnail trong RAM
- `AppKit` vẫn được giữ làm fallback compatibility path nếu interpreter thiếu `Quartz`

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
- mặc định Phase 4 hiện chốt `embedding.provider = "open-clip"` với `embedding.model = "ViT-B-32"` và `embedding.pretrained = "laion2b_s34b_b79k"`

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
