import unittest

from python.embedding_bridge.bridge import chunk_items, maybe_clear_runtime_cache


class _FakeMpsRuntime:
    def __init__(self):
        self.calls = 0

    def empty_cache(self):
        self.calls += 1


class _FakeTorchModule:
    def __init__(self):
        self.mps = _FakeMpsRuntime()


class EmbeddingBridgeBatchingTest(unittest.TestCase):
    def test_chunk_items_respects_requested_batch_size(self):
        chunks = chunk_items([1, 2, 3, 4, 5], 2)
        self.assertEqual(chunks, [[1, 2], [3, 4], [5]])

    def test_chunk_items_normalizes_invalid_batch_size(self):
        chunks = chunk_items([1, 2, 3], 0)
        self.assertEqual(chunks, [[1], [2], [3]])

    def test_maybe_clear_runtime_cache_only_for_mps(self):
        fake_torch = _FakeTorchModule()

        maybe_clear_runtime_cache(fake_torch, "cpu")
        self.assertEqual(fake_torch.mps.calls, 0)

        maybe_clear_runtime_cache(fake_torch, "mps")
        self.assertEqual(fake_torch.mps.calls, 1)


if __name__ == "__main__":
    unittest.main()
