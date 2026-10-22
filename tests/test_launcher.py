"""Regression checks for reserved/occupied ports and local launcher state."""
import contextlib
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launcher_support as support


class LauncherTests(unittest.TestCase):
    def test_occupied_default_port_uses_another_loopback_port(self):
        with socket.socket() as blocker:
            blocker.bind(('127.0.0.1', 0))
            blocker.listen()
            occupied = blocker.getsockname()[1]
            with patch.object(support, 'DEFAULT_PORT', occupied):
                selected = support.free_port()
            self.assertNotEqual(selected, occupied)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', selected))

    def test_windows_reserved_port_permission_error_falls_back(self):
        class Probe:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def bind(self, address):
                attempts.append(address)
                if address[1] != 0:
                    raise PermissionError(10013, 'Reserved port')
            def getsockname(self):
                return ('127.0.0.1', 28791)
        attempts = []
        with patch.object(support.socket, 'socket', side_effect=Probe):
            self.assertEqual(support.free_port(), 28791)
        self.assertEqual(attempts, [('127.0.0.1', support.DEFAULT_PORT), ('127.0.0.1', 0)])

    def test_state_round_trip_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.neuroring-runtime.json'
            with patch.object(support, 'STATE', path):
                self.assertIsNone(support.saved_port())
                support.remember(28791, 123)
                self.assertEqual(support.saved_port(), 28791)
                for value in ([], True, '28791', 0, 65536):
                    path.write_text(json.dumps({'port': value}), encoding='utf-8')
                    self.assertIsNone(support.saved_port())
                path.write_text('broken JSON', encoding='utf-8')
                self.assertIsNone(support.saved_port())

    def test_active_saved_port_is_reused(self):
        with patch.object(support, 'saved_port', return_value=28791), patch.object(support, 'healthy', return_value=True) as check:
            self.assertEqual(support.running_port(), 28791)
            check.assert_called_once_with(28791)

    def test_stale_saved_port_falls_back_to_default_service(self):
        with patch.object(support, 'saved_port', return_value=28791), patch.object(support, 'healthy', side_effect=[False, True]):
            self.assertEqual(support.running_port(), support.DEFAULT_PORT)

    def test_foreign_or_malformed_health_is_not_accepted(self):
        for payload in ('[]', '{}', '{"app":"another-app"}', 'not JSON'):
            with patch.object(support.HTTP, 'open', return_value=contextlib.closing(io.StringIO(payload))):
                self.assertFalse(support.healthy(28791))


if __name__ == '__main__':
    unittest.main()
