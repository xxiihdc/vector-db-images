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
- Sau khi hoàn thành một task, trước khi chốt output cuối, luôn tự review nhanh workflow vừa chạy:
  - có step nào chưa ổn hoặc còn thủ công quá không
  - có step nào tốn thời gian bất thường không
  - có step nào có thể tối ưu bằng hook, checklist, script, hay đổi flow không
- Nếu phát hiện ít nhất 1 điểm tối ưu có thể sửa ngay trong task hiện tại và ảnh hưởng đến latency, độ tin cậy, hoặc DX, hãy hỏi Đức ngay trong output cuối bằng 1 câu đề xuất cụ thể.

## Mục tiêu

Xây dựng và duy trì một công cụ CLI chạy hoàn toàn local trên MacBook Air dùng Apple Silicon để tìm kiếm ảnh và video trong Apple Photos bằng ngôn ngữ tự nhiên.

Baseline hiện tại đã được Đức đánh giá là đã đạt mức MVP dùng được.

## Trạng thái hiện tại

- MVP checklist trong `docs/mvp-checklist.md` được xem là đã hoàn thành và không còn là nguồn điều phối công việc hằng ngày.
- Từ thời điểm này, không bắt buộc phải tiếp tục cập nhật checklist đó sau mỗi task mới.
- Khi cần lập kế hoạch cho việc tiếp theo, ưu tiên dựa trên:
  - yêu cầu mới từ Đức
  - trạng thái runtime thực tế của repo
  - các vấn đề vận hành, chất lượng search, hiệu năng, độ ổn định, và DX
- `README.md` là tài liệu vận hành hiện tại cho command, cách chạy, và cách dùng.
- Các quyết định/phase/history đã chốt trước đây trong `README.md` được xem là ngữ cảnh legacy; nếu vẫn cần giữ lịch sử quyết định để agent hiểu ngữ cảnh, đặt nội dung đó vào `docs/architecture.md` thay vì tiếp tục mở rộng `README.md`.

## Nguyên tắc làm việc

**Khi hai nguyên tắc xung khắc**: Giữ nguyên tắc CLI-first và local-first; chỉ phá vỡ chúng khi Đức xác nhận hoặc khi task hiện tại yêu cầu rõ ràng.

1. Ưu tiên kiến trúc CLI-first.
2. Không tạo UI riêng để review media; dùng chính app Photos làm giao diện hiển thị kết quả mặc định.
3. Giữ storage layer nhẹ, local-first, và không lưu file ảnh/video nháp ra SSD trong workflow chuẩn.
4. Tách rõ các concern sau:
   - Photos library access
   - thumbnail và video representation extraction in-memory
   - embedding generation
   - vector search
   - album output back to Photos
5. Mọi design choice nên cải thiện ít nhất một trong các outcome sau:
   - reliable re-indexing
   - deterministic asset identity qua `PHAsset.localIdentifier`
   - zero-storage thumbnail và representation processing
   - native Photos review workflow
6. Khi cân bằng trade-off implementation, ưu tiên hiệu năng trước rồi mới tới tính tương thích môi trường.
7. Nếu thêm thư viện hoặc framework ngoài giúp cải thiện throughput hoặc latency ít nhất 20% trên workload local-first trên macOS so với dữ liệu thực tế trên máy Đức, ưu tiên sử dụng và cập nhật setup/docs tương ứng.

## Non-Goals

1. cloud deployment
2. multi-user auth
3. desktop UI riêng để duyệt media
4. training custom models
5. transcript pipeline hoặc mirror/export toàn bộ library từ iCloud về local disk
6. production-scale distributed vector infrastructure

**Khi người dùng yêu cầu mục nằm trong Non-Goals**: Trả lời rằng đây là ngoài phạm vi của repo hiện tại, giải thích ngắn gọn tại sao, và đề xuất một thay thế nằm trong phạm vi CLI/local-Photos.

## Tài liệu cần giữ cập nhật

- `AGENTS.md`
- `README.md`
- `docs/product.md`
- `docs/architecture.md`

`docs/mvp-checklist.md` vẫn có thể giữ như hồ sơ lịch sử MVP, nhưng không còn là tài liệu bắt buộc phải đồng bộ theo từng task mới.

## Script workflow bắt buộc cho config/storage

Nếu task thay đổi `DEFAULT_CONFIG`, storage layout, hoặc sample config:
1. Chạy `npm run config:sync-sample`, `npm run config:check-sample`, và `npm run test:storage` trước khi kết thúc task.
2. Nếu `npm run verify:storage` là cần thiết, chạy nó sau đó.

Agent không nên sửa tay `media-vector-index.config.json` nếu thay đổi đó thực chất xuất phát từ `DEFAULT_CONFIG`; ưu tiên update source config rồi gọi script sync tương ứng.

## Legacy context từ README cũ

Các điểm dưới đây đã từng được ghi khá dài trong `README.md`; từ nay xem chúng là ngữ cảnh legacy/decision history cho agent:

### Runtime direction đã chốt

- Primary runtime: `Node.js CLI`
- Native bridge: `Python photos-bridge -> PyObjC -> Photos framework`
- Retrieval surface chính: CLI
- Local web search chỉ là convenience layer mỏng, không phải source of truth

### Source of truth và storage

- Apple Photos trên macOS là source of truth cho media
- Asset gốc có thể nằm trên iCloud
- Chỉ lưu local DB nhẹ gồm vector, `localIdentifier`, và metadata tối thiểu cần cho indexing/search/debug
- Không lưu thumbnail cache, preview artifacts, video proxy cache, hay filesystem mirror

### Retrieval workflow

1. `index`: quét Photos và cập nhật vector DB
2. `search`: nhận query ngôn ngữ tự nhiên hoặc ảnh query
3. `output`: tạo/cập nhật album `AI Search Results` trong Photos

### Search/index implementation đã chốt

- Image representation baseline: `image-thumbnail`
- Video representation baseline hiện tại: `video-storyboard`
- Legacy video representation vẫn cần tương thích: `video-poster-frame`
- `index` mặc định ưu tiên cache; `--no-cache` ép refresh
- `reindex` mặc định luôn bypass cache
- `reindex --limit N` chỉ refresh phạm vi đó, không xóa asset ngoài phạm vi

### Runtime/verification notes đã chốt

- Không coi agent bắt buộc phải tự chạy test native thành công trong sandbox khi task phụ thuộc TCC, Photos framework, hoặc iCloud-backed assets
- Nếu TCC, Photos framework, hoặc iCloud access bị chặn, hãy dừng ở mức báo cáo blocker, mô tả rõ giới hạn verify, hỏi Đức xem có nên tiếp tục với code-only validation hay defer native verification, và không tuyên bố task đã được verify thành công.
- Nếu Đức đã xác nhận một command native chạy đúng trên máy thật, coi đó là nguồn verify chính cho behavior native
- Với search quality hoặc latency, verify trên library thật quan trọng hơn test sandbox thuần

## Ghi chú cho các agent sau này

Đừng nhảy thẳng vào Electron hay HTTP API nặng nếu chưa có nhu cầu rõ ràng vượt quá Photos app.

Nếu cần chọn ưu tiên kỹ thuật tiếp theo, hãy ưu tiên:

- TCC permissions
- iCloud-backed Photos access
- in-memory thumbnail/video representation pipeline
- `localIdentifier` stability
- search quality
- indexing throughput
- album output workflow

Repo hiện có skill nội bộ `specialist-agent-flow`, nhưng chỉ dùng khi task thực sự cần route qua vai trò chuyên biệt; không bắt buộc cho mọi task.

Khi cần rà nhanh một `plan.md` đã được impl đến đâu so với code hiện tại, ưu tiên dùng skill nội bộ `.agents/skills/plan-coverage-check/` và giữ mọi script kiểm tra ở đó thay vì thêm vào runtime surface của dự án.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read `docs/product.md`, `docs/architecture.md`, and `README.md`.
Use this active plan file when the task matches model-upgrade work: `specs/001-stronger-embedding-model/plan.md`.
If a separate plan file does not match the current task, state that no relevant plan file is available.
<!-- SPECKIT END -->
