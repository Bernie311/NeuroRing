"""First-run states must be actionable and must not create Codex data."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import data_source
import launcher_support as support
from observer import Observer
from server import App


class FirstRunTests(unittest.TestCase):
    def test_missing_data_does_not_create_a_database(self):
        with tempfile.TemporaryDirectory() as directory:
            source = data_source.Source(Observer(), base=directory)
            with self.assertRaises(data_source.DataUnavailable) as caught:
                source.collect()
            self.assertEqual(caught.exception.code, 'missing')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_other_database_version_is_explicitly_incompatible(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'state_6.sqlite').touch()
            source = data_source.Source(Observer(), base=directory)
            with self.assertRaises(data_source.DataUnavailable) as caught:
                source.collect()
            self.assertEqual(caught.exception.code, 'incompatible')

    def test_schema_failure_is_visible_and_scan_recovers(self):
        app = App()
        valid = {'ok': True, 'threads': []}
        with patch('server.Source') as factory:
            factory.return_value.collect.side_effect = [sqlite3.OperationalError('no such table'), valid]
            seen = []
            def tick(_):
                seen.append(dict(app.state))
                if len(seen) == 2:
                    app.observer.stop.set()
            with patch.object(app.observer.stop, 'wait', side_effect=tick):
                app.scan()
        self.assertEqual(seen[0]['code'], 'incompatible')
        self.assertEqual(seen[1], valid)

    def test_bundled_service_never_reuses_a_different_installation(self):
        import contextlib
        import io
        for instance, expected in [('other-copy', False), ('this-copy', True), (None, False)]:
            body = json.dumps({'app':'codex-live-screen', 'instance':instance})
            with patch.object(support, 'INSTANCE', 'this-copy'), patch.object(
                support.HTTP, 'open', return_value=contextlib.closing(io.StringIO(body))):
                self.assertEqual(support.healthy(28791), expected)


if __name__ == '__main__':
    unittest.main()
