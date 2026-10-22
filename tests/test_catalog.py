"""Public checkouts must start without the author's private project catalog."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import data_source


class CatalogTests(unittest.TestCase):
    def create_source(self, directory):
        with patch.object(data_source, '__file__', str(Path(directory) / 'data_source.py')):
            return data_source.Source(observer=None, base=directory)

    def test_missing_catalog_uses_empty_metadata_without_writing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.create_source(directory)
            self.assertEqual(source.catalog, {'capturedAt': None, 'projects': []})
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_existing_catalog_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = {'capturedAt': '2026-01-01T00:00:00Z', 'projects': [
                {'projectId': 'example', 'projectKind': 'local', 'label': 'Example'}]}
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(catalog), encoding='utf-8')
            before = path.read_bytes()
            self.assertEqual(self.create_source(directory).catalog, catalog)
            self.assertEqual(path.read_bytes(), before)

    def test_invalid_catalog_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text('invalid json', encoding='utf-8')
            with self.assertRaises(json.JSONDecodeError):
                self.create_source(directory)
            self.assertEqual(path.read_text(encoding='utf-8'), 'invalid json')


if __name__ == '__main__':
    unittest.main()
