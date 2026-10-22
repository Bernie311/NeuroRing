"""Synthetic stream metadata only: these tests never connect to Codex IPC."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observer import Observer


APPROVAL = {'id': 'approval-1', 'method': 'item/commandExecution/requestApproval'}
ORDINARY = {'id': 'input-1', 'method': 'item/tool/requestUserInput'}


class ObserverApprovalTests(unittest.TestCase):
    def setUp(self):
        self.observer = Observer()
        self.observer.connected = True
        self.observer.targets = ['synthetic-thread']
        self.revision = 0

    def consume(self, change):
        self.observer.consume({
            'type': 'broadcast', 'sourceClientId': 'owner', 'version': 11,
            'method': 'thread-stream-state-changed',
            'params': {'conversationId': 'synthetic-thread', 'hostId': 'local',
                       'change': change}}, 'reader')

    def snapshot(self, requests):
        self.revision += 1
        self.consume({'type': 'snapshot', 'revision': self.revision,
                      'conversationState': {'threadRuntimeStatus': {'type': 'active'},
                                            'requests': requests}})

    def patches(self, *patches):
        previous = self.revision
        self.revision += 1
        self.consume({'type': 'patches', 'baseRevision': previous,
                      'revision': self.revision, 'patches': list(patches)})

    def approval(self):
        return self.observer.get('synthetic-thread')['approval']

    def test_added_approval_matches_equivalent_snapshot(self):
        for empty, key, expected in [([], 0, [APPROVAL]), ({}, 'a', {'a': APPROVAL})]:
            with self.subTest(collection=type(empty).__name__):
                self.snapshot(empty)
                self.patches({'op': 'add', 'path': ['requests', key], 'value': APPROVAL})
                self.assertTrue(self.approval())
                patched = self.approval()
                self.snapshot(expected)
                self.assertEqual(patched, self.approval())

    def test_removing_one_of_multiple_approvals_keeps_waiting_until_last_is_removed(self):
        for requests, first, last in [([APPROVAL, APPROVAL], 0, 0),
                                      ({'a': APPROVAL, 'b': APPROVAL}, 'a', 'b')]:
            with self.subTest(collection=type(requests).__name__):
                self.snapshot(requests)
                self.patches({'op': 'remove', 'path': ['requests', first]})
                self.assertTrue(self.approval())
                self.patches({'op': 'remove', 'path': ['requests', last]})
                self.assertFalse(self.approval())

    def test_ordinary_request_changes_do_not_clear_another_approval(self):
        self.snapshot([APPROVAL])
        self.patches({'op': 'add', 'path': ['requests', 0], 'value': ORDINARY})
        self.assertTrue(self.approval())
        self.patches({'op': 'replace', 'path': ['requests', 0], 'value': ORDINARY})
        self.assertTrue(self.approval())
        self.patches({'op': 'remove', 'path': ['requests', 0]})
        self.assertTrue(self.approval())
        self.patches({'op': 'replace', 'path': ['requests', 0], 'value': ORDINARY})
        self.assertFalse(self.approval())

    def test_whole_collection_replacement_and_removal(self):
        self.snapshot([])
        self.patches({'op': 'replace', 'path': ['requests'], 'value': {'a': APPROVAL}})
        self.assertTrue(self.approval())
        self.patches({'op': 'replace', 'path': ['requests'], 'value': [ORDINARY]})
        self.assertFalse(self.approval())
        self.patches({'op': 'add', 'path': ['requests', 1], 'value': APPROVAL})
        self.assertTrue(self.approval())
        self.patches({'op': 'remove', 'path': ['requests']})
        self.assertFalse(self.approval())

    def test_dictionary_entry_replacement(self):
        self.snapshot({'a': APPROVAL, 'b': ORDINARY})
        self.patches({'op': 'replace', 'path': ['requests', 'b'], 'value': APPROVAL},
                     {'op': 'replace', 'path': ['requests', 'a'], 'value': ORDINARY})
        self.assertTrue(self.approval())
        self.patches({'op': 'replace', 'path': ['requests', 'b'], 'value': ORDINARY})
        self.assertFalse(self.approval())

    def test_method_field_changes_recompute_approval(self):
        self.snapshot([ORDINARY])
        self.patches({'op': 'replace', 'path': ['requests', 0, 'method'],
                      'value': APPROVAL['method']})
        self.assertTrue(self.approval())
        self.patches({'op': 'remove', 'path': ['requests', 0, 'method']})
        self.assertFalse(self.approval())
        self.patches({'op': 'add', 'path': ['requests', 0, 'method'],
                      'value': APPROVAL['method']})
        self.assertTrue(self.approval())

    def test_unrelated_patches_preserve_approval(self):
        self.snapshot([APPROVAL])
        self.patches({'op': 'replace', 'path': ['hasUnreadTurn'], 'value': True})
        self.assertTrue(self.approval())

    def test_unsupported_or_invalid_request_patch_invalidates_until_snapshot(self):
        bad_patches = [
            {'op': 'move', 'path': ['requests', 0]},
            {'op': 'add', 'path': ['requests', 2], 'value': APPROVAL},
            {'op': 'remove', 'path': ['requests', -1]},
            {'op': 'remove', 'path': ['requests', '0']},
            {'op': 'replace', 'path': ['requests', 9], 'value': APPROVAL},
            {'op': 'replace', 'path': ['requests', 0, 'unknown'], 'value': True},
            {'op': 'replace', 'path': ['requests', 0, 'method'], 'value': {}},
            {'op': 'replace', 'path': ['requests'], 'value': 'invalid'},
            {'op': 'replace', 'path': ['requests', 0], 'value': 'invalid'},
            {'op': 'replace', 'path': ['requests']},
            {'op': 'replace', 'path': '/requests/0', 'value': ORDINARY},
            {'op': 'replace', 'path': [], 'value': {}},
        ]
        for patch in bad_patches:
            with self.subTest(patch=patch):
                self.snapshot([APPROVAL])
                self.patches(patch)
                self.assertIsNone(self.observer.get('synthetic-thread'))
                self.patches({'op': 'replace', 'path': ['threadRuntimeStatus'],
                              'value': {'type': 'active'}})
                self.assertIsNone(self.observer.get('synthetic-thread'))
                self.snapshot([APPROVAL])
                self.assertTrue(self.approval())

    def test_malformed_snapshot_invalidates_previous_view(self):
        self.snapshot([APPROVAL])
        self.snapshot(['invalid request'])
        self.assertIsNone(self.observer.get('synthetic-thread'))

    def test_only_approval_bits_survive_snapshot_and_patch(self):
        private = {'id': 'secret-id', 'method': APPROVAL['method'],
                   'params': {'command': 'PRIVATE_COMMAND', 'text': 'PRIVATE_BODY'}}
        self.snapshot([private])
        self.patches({'op': 'add', 'path': ['requests', 1], 'value': private})
        self.assertEqual(self.observer.views['synthetic-thread']['_requests'], [True, True])
        self.assertNotIn('_requests', self.observer.get('synthetic-thread'))
        for secret in ('PRIVATE_COMMAND', 'PRIVATE_BODY', 'secret-id', APPROVAL['method']):
            self.assertNotIn(secret, repr(self.observer.views))


if __name__ == '__main__':
    unittest.main()
