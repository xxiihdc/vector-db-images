# Media Vector Index

Project scaffold local-first để index image và video vào một media catalog có thể search, thân thiện với agent.

## Trạng thái

Đang ở giai đoạn planning và project setup.

## Mục tiêu

Project này được định hướng trở thành một công cụ CLI-first có khả năng:

1. quét các thư mục image và video
2. trích xuất metadata và tham chiếu video segment
3. gắn thêm transcript hoặc caption context
4. lưu các record vector-oriented có thể search
5. cung cấp các retrieval primitive để AI agent chọn đúng media resource

## Vì Sao CLI-First

Rủi ro chính không nằm ở UI. Rủi ro chính nằm ở data modeling:

- asset là gì
- video segment là gì
- record được re-index an toàn như thế nào
- AI agent cần context nào để chọn đúng source clip

Vì vậy, deliverable đầu tiên nên là một indexing và retrieval core ổn định.

## Tài Liệu Dự Kiến

- [AGENTS.md](/Users/hoaiduc/Documents/VectorDB Image/AGENTS.md)
- [docs/product.md](/Users/hoaiduc/Documents/VectorDB Image/docs/product.md)
- [docs/architecture.md](/Users/hoaiduc/Documents/VectorDB Image/docs/architecture.md)
- [docs/backlog.md](/Users/hoaiduc/Documents/VectorDB Image/docs/backlog.md)

## Bước Tiếp Theo

Hoàn thiện product và architecture docs, sau đó scaffold package và các runtime module rỗng.
