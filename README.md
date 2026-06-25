# Media Vector Index

CLI local-first để index và tìm kiếm ảnh/video trong Apple Photos bằng ngôn ngữ tự nhiên trên macOS Apple Silicon.

## Hiện trạng

Repo hiện đã ở mức MVP dùng được:

- đọc trực tiếp Apple Photos qua Photos framework
- xin quyền Photos của macOS qua native flow
- index ảnh và video theo `PHAsset.localIdentifier`
- tạo embedding local-first
- search semantic qua vector backend local
- đẩy kết quả vào album `AI Search Results`
- optional Telegram long-poll bot cho text-query search local-first

## Yêu cầu

- macOS
- Apple Silicon là target chính
- Node.js `>= 22`
- Python 3 có thể cài `PyObjC`
- Apple Photos có library hợp lệ
- `Qdrant` chạy local tại `127.0.0.1:6333`

## Cài đặt

### 1. Cài Python dependencies

```bash
python3 -m pip install -r python/requirements.txt
```

### 2. Chạy Qdrant local

```bash
docker run -p 6333:6333 -v "$(pwd)/.data/qdrant:/qdrant/storage" qdrant/qdrant
```

### 3. Khởi tạo config và storage

```bash
node ./src/cli/main.js init
```

### 4. Kiểm tra vector backend

```bash
node ./src/cli/main.js storage vector-check
```

## Quickstart

### Xin quyền Photos

```bash
node ./src/cli/main.js photos check
node ./src/cli/main.js photos request-access
```

Nếu muốn probe runtime native trước:

```bash
node ./src/cli/main.js photos capabilities
```

### Index library

Index mặc định ưu tiên cache nếu local catalog/vector đã có sẵn:

```bash
node ./src/cli/main.js index --progress-every 10 --profile
```

Ép refresh từ Photos:

```bash
node ./src/cli/main.js index --no-cache --limit 1000 --progress-every 10 --profile
```

Refresh trực tiếp bằng command riêng:

```bash
node ./src/cli/main.js reindex --limit 1000 --progress-every 10 --profile
```

Ghi chú:

- `index --no-cache` và `reindex` đều đi theo refresh path.
- `reindex` không cần thêm `--no-cache`.
- `reindex --limit N` chỉ refresh phạm vi đó, không xóa asset ngoài phạm vi refresh.
- Nếu đổi `embedding.candidate_preset`, `embedding.model`, `embedding.pretrained`, hoặc `embedding.target_resolution`, hãy chạy `reindex` hoặc `index --no-cache` để build vector mới dưới `model_identity` mới.
- Cache read chỉ reuse embedding khớp đúng `model_identity` đang active; không cần cleanup tay khi quay lại baseline model.

### Search bằng text

```bash
node ./src/cli/main.js search "sunset beach"
```

Chỉ test retrieval, không ghi album:

```bash
node ./src/cli/main.js search "sunset beach" --skip-album
```

### Search bằng ảnh query

```bash
node ./src/cli/main.js index file /absolute/path/to/exported-image.jpg
node ./src/cli/main.js search image /absolute/path/to/exported-image.jpg --skip-album
```

### Mở local web search

```bash
node ./src/cli/main.js serve --port 4173
```

Sau đó mở `http://127.0.0.1:4173`.

### Chạy Telegram bot bằng long polling

Tạo file local từ mẫu:

```bash
cp telegram.config.example.json telegram.config.json
```

Sau đó điền `bot_token` và `allowed_chat_ids` trong `telegram.config.json`, rồi chạy:

```bash
node ./src/cli/main.js telegram listen
```

### Chạy wrapper chung cho web và Telegram

Wrapper mới giúp bật web search và Telegram long polling bằng một lệnh foreground duy nhất, tiện để gán vào Apple Shortcut.

Mặc định, nếu không truyền cờ nào thì wrapper sẽ bật cả hai:

```bash
node ./src/cli/main.js launch
```

Chỉ bật web:

```bash
node ./src/cli/main.js launch --web --port 4173
```

Chỉ bật Telegram long polling:

```bash
node ./src/cli/main.js launch --tele
```

Nếu muốn Apple Shortcut gọi một file wrapper ổn định thay vì nhớ nguyên lệnh Node, dùng:

```bash
zsh /absolute/path/to/VectorDBImage/scripts/mvi-shortcut-wrapper.sh
```

Ví dụ cho Shortcut:

```bash
zsh /absolute/path/to/VectorDBImage/scripts/mvi-shortcut-wrapper.sh --web
zsh /absolute/path/to/VectorDBImage/scripts/mvi-shortcut-wrapper.sh --tele
zsh /absolute/path/to/VectorDBImage/scripts/mvi-shortcut-wrapper.sh
```

Bot hiện hỗ trợ:

- `/start` và `/help`
- `/search <query>`
- plain text message như text query
- cập nhật `AI Search Results` trong Photos bằng đúng shared search workflow hiện có
- lưu `update_id` tại `telegram.offset_store_path` để restart không xử lý lại message cũ
- `telegram.config.json` được ignore khỏi git; commit `telegram.config.example.json` để chia sẻ cấu trúc mẫu

## Command reference

### Core commands

```bash
node ./src/cli/main.js init [--force]
node ./src/cli/main.js index [--limit 200] [--timeout-seconds 30] [--progress-every 10] [--profile] [--no-cache]
node ./src/cli/main.js reindex [--limit 200] [--timeout-seconds 30] [--progress-every 10] [--profile]
node ./src/cli/main.js search "<query>" [--limit 50] [--skip-album]
node ./src/cli/main.js search image /absolute/path/to/image.jpg [--limit 50] [--skip-album]
node ./src/cli/main.js index file /absolute/path/to/image.jpg
node ./src/cli/main.js serve [--port 4173]
node ./src/cli/main.js launch [--web] [--tele] [--port 4173]
node ./src/cli/main.js telegram listen
node ./src/cli/main.js storage vector-check
```

### Photos diagnostics

```bash
node ./src/cli/main.js photos check
node ./src/cli/main.js photos request-access
node ./src/cli/main.js photos scan
node ./src/cli/main.js photos debug
node ./src/cli/main.js photos capabilities
node ./src/cli/main.js photos probe-originals
node ./src/cli/main.js photos extract
```

### Embedding diagnostics

```bash
node ./src/cli/main.js embedding capabilities
```

## Cách dùng theo workflow

### Workflow 1: máy mới, chưa cấp quyền

```bash
node ./src/cli/main.js init
node ./src/cli/main.js storage vector-check
node ./src/cli/main.js photos capabilities
node ./src/cli/main.js photos request-access
node ./src/cli/main.js photos scan
node ./src/cli/main.js index --no-cache --limit 200 --profile
node ./src/cli/main.js search "dog on the beach"
```

### Workflow 2: reindex định kỳ

```bash
node ./src/cli/main.js reindex --limit 1000 --progress-every 25 --profile
```

Hợp khi muốn refresh nhóm asset mới nhất mà không đụng phần còn lại.

### Workflow 3: debug extraction native

```bash
node ./src/cli/main.js photos capabilities
node ./src/cli/main.js photos probe-originals
node ./src/cli/main.js photos extract --json
```

### Workflow 4: benchmark search/index

```bash
node ./src/cli/main.js storage vector-check
node ./src/cli/main.js index --limit 100 --no-cache --profile
node ./src/cli/main.js index --limit 300 --no-cache --profile
node ./src/cli/main.js index --limit 1000 --no-cache --profile
```

## Config

File config mặc định là:

```text
media-vector-index.config.json
```

Những field đáng chú ý:

- `app.results_album_name`: tên album output trong Photos
- `storage.vector_service_url`: URL của `Qdrant`
- `extractor.image_thumbnail_size`: kích thước thumbnail ảnh
- `extractor.video_strategy`: hiện hỗ trợ `storyboard` hoặc `poster-frame`
- `retriever.write_to_photos_results_album`: cho phép tắt ghi album khi test
- `telegram.enabled`: bật/tắt Telegram bot
- `telegram.bot_token`: bot token từ BotFather
- `telegram.allowed_chat_ids`: allowlist chat id được phép dùng bot
- `telegram.offset_store_path`: file lưu `update_id` đã xử lý để restart không bị đọc lại
- `telegram.config.json`: file local override riêng cho section `telegram`; nếu tồn tại sẽ được merge đè lên `media-vector-index.config.json`
- `embedding.candidate_preset`: preset rung đang active, ví dụ `baseline` hoặc `fallback-safe`
- `embedding.provider`, `embedding.model`, `embedding.pretrained`: model setup hiện tại
- `embedding.target_resolution`: resolution phải đi cùng model hiện tại để benchmark/reindex fair

Sau khi đổi `DEFAULT_CONFIG`, không sửa sample config bằng tay. Dùng:

```bash
npm run config:sync-sample
npm run config:check-sample
```

## Test và verify

```bash
npm run test:storage
npm run verify:storage
npm run verify:index-cache
npm run verify:embedding
npm run verify:search-core
npm run verify:image-search -- /absolute/path/to/exported-image.jpg
```

`npm run verify:index-cache` hiện verify cả rollback flow cơ bản: cache hit với config hiện tại, refresh với preset nâng cấp, rồi refresh lại sau khi restore baseline config.

## Hành vi runtime quan trọng

- Apple Photos là source of truth; không dùng filesystem mirror.
- Asset có thể nằm trên iCloud.
- Pipeline chuẩn không lưu thumbnail/video proxy ra SSD.
- `index` mặc định dùng cache nếu có.
- `reindex` mặc định luôn refresh.
- Video hiện mặc định dùng representation `storyboard`; runtime vẫn tương thích với dữ liệu `video-poster-frame` cũ.
- Search có thể ghi kết quả vào album `AI Search Results`; dùng `--skip-album` khi chỉ muốn verify retrieval.

## Troubleshooting

### `Photos permission must be authorized or limited`

Chạy:

```bash
node ./src/cli/main.js photos request-access
```

### `Qdrant` không reachable

Chạy lại sidecar rồi verify:

```bash
node ./src/cli/main.js storage vector-check
```

### Thiếu runtime embedding

Chạy:

```bash
node ./src/cli/main.js embedding capabilities
```

Command này sẽ chỉ ra thư viện Python còn thiếu và command cài tương ứng.

### Muốn dùng Python interpreter khác

```bash
MVI_PYTHON_BIN=/path/to/python3 node ./src/cli/main.js photos debug
```

### Tự load `.env`

Repo hiện tự load file `.env` ở project root nếu file này tồn tại. Có thể bắt đầu từ mẫu:

```bash
cp .env.example .env
```

Ví dụ:

```env
MVI_PROJECT_ROOT=/absolute/path/to/VectorDBImage
MVI_PYTHON_BIN=/opt/homebrew/bin/python3
```

### Muốn chạy command từ ngoài thư mục repo

```bash
MVI_PROJECT_ROOT=/absolute/path/to/VectorDBImage node ./src/cli/main.js search "sunset beach"
```

## Tài liệu liên quan

- [AGENTS.md](./AGENTS.md)
- [docs/product.md](./docs/product.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/mvp-checklist.md](./docs/mvp-checklist.md)
