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

Xây dựng một công cụ dòng lệnh (CLI) chạy hoàn toàn local trên MacBook Air dùng Apple Silicon để tìm kiếm ảnh và video trong ứng dụng Apple Photos bằng ngôn ngữ tự nhiên.

Mục tiêu cốt lõi của bản đầu:

1. đọc thư viện Photos qua API hệ thống và kích hoạt được quyền truy cập Photos của macOS
2. đọc trực tiếp thư viện Apple Photos trên macOS qua Photos framework, kể cả khi ảnh hoặc video gốc đang nằm trên iCloud
3. lấy thumbnail hoặc representation kích thước nhỏ trực tiếp vào RAM cùng với `PHAsset.localIdentifier`
4. tạo vector từ thumbnail hoặc video representation bằng mô hình multimodal local tối ưu cho Apple Silicon
5. chỉ lưu database rất nhẹ gồm vector và `localIdentifier`
6. đẩy kết quả tìm kiếm vào album `AI Search Results` trong app Photos để người dùng xem bằng giao diện native

## Giai đoạn hiện tại

Ưu tiên trạng thái và phase theo `docs/mvp-checklist.md`.

Hiện tại đã hoàn tất `Phase 0: Scope And Decisions` và `Phase 1: Core Design`.

Pha đang chuẩn bị bắt đầu là `Phase 2: Scaffold`.

## Nguyên tắc làm việc

1. Ưu tiên kiến trúc CLI-first.
2. Không tạo UI riêng; dùng chính app Photos làm giao diện hiển thị kết quả.
3. Giữ storage layer đầu tiên ở mức local, rất nhẹ, và không lưu file ảnh nháp ra SSD.
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

## Non-Goals cho bản build đầu tiên

1. cloud deployment
2. multi-user auth
3. desktop UI riêng, Electron, hoặc local HTTP API
4. training custom models
5. transcript pipeline, desktop review UI riêng, hoặc mirror/export toàn bộ library từ iCloud về local disk
6. production-scale distributed vector infrastructure

## Định hướng kỹ thuật ban đầu

### Candidate runtime

- Primary: Node.js CLI
- Optional về sau: chỉ cân nhắc thêm integration khác khi workflow với Photos app đã không đủ

### Retrieval surface đầu tiên

- Chốt dùng `CLI only` cho MVP đầu tiên.
- Chưa thêm local HTTP API ở giai đoạn project setup.
- Output review flow mặc định phải đi qua album trong app Photos, không qua UI riêng.

### Candidate storage

- metadata catalog: SQLite hoặc file DB local rất nhẹ
- vector layer: bắt đầu local, abstract phía sau một repository interface
- không lưu preview artifacts, thumbnail cache, hoặc video proxy cache ra ổ đĩa trong MVP

### Candidate indexing model

- image unit: một asset Photos cho mỗi `PHAsset.localIdentifier`
- video unit: một asset Photos cho mỗi `PHAsset.localIdentifier`, với representation phục vụ semantic retrieval được trích trực tiếp từ Photos access path
- indexing input ban đầu là thumbnail hoặc representation cỡ nhỏ được nạp trực tiếp vào RAM
- source of truth cho media gốc và hiển thị kết quả là app Photos, không phải filesystem mirror

### Workflow mục tiêu cho MVP

1. `index`: người dùng chạy lệnh CLI để quét thư viện Photos và cập nhật vector DB cho cả ảnh lẫn video
2. `search`: người dùng gõ truy vấn ngôn ngữ tự nhiên trên Terminal
3. `output`: hệ thống tạo hoặc cập nhật album `AI Search Results` trong app Photos bằng chính các asset gốc hoặc asset tham chiếu từ iCloud-backed library

## Tài liệu bắt buộc

Trước khi implement, luôn giữ các file sau được cập nhật:

- `README.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/mvp-checklist.md`

## Checklist vận hành

- File checklist chính cho MVP là `docs/mvp-checklist.md`.
- `docs/mvp-checklist.md` là nguồn công việc và phase duy nhất cho MVP; không duy trì thêm backlog song song.
- Mỗi khi hoàn thành một task, phải cập nhật checklist này ngay trong cùng lần làm việc.
- Nếu một task được break nhỏ hơn để dễ triển khai, thêm sub-task hoặc tách lại wording trong checklist trước khi tiếp tục.
- Không coi task là xong nếu code đã đổi nhưng checklist chưa được cập nhật.
- Repo có local Spec Kit hook `speckit.checklist.remind` để nhắc cập nhật checklist sau các `after_*` workflow outputs.
- Hook này chỉ bao phủ các command trong workflow Spec Kit; với các output ngoài workflow đó, agent vẫn phải tự tuân thủ quy ước cập nhật checklist.

## Thứ tự thực hiện chuẩn

Thứ tự thực hiện chuẩn bám theo `docs/mvp-checklist.md`:

1. `Phase 0: Scope And Decisions`
2. `Phase 1: Core Design`
3. `Phase 2: Scaffold`
4. `Phase 3: Ingestion`
5. `Phase 4: Search And Retrieval`
6. `Phase 5: Validation And Docs`

Khi cần diễn giải chi tiết hơn, ưu tiên dùng đúng task wording trong checklist thay vì tự đặt phase mới.

## Ghi chú cho các agent sau này

Đừng nhảy thẳng vào Electron hay HTTP API.

Nếu chưa có nhu cầu rõ ràng vượt quá Photos app, hãy ưu tiên effort cho TCC permissions, iCloud-backed Photos access, in-memory thumbnail or representation pipeline, `localIdentifier` stability, và album output workflow trước.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
