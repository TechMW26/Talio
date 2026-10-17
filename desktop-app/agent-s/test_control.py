"""Persistent native protocol tests; never send real desktop inputs."""
import io
import json
import unittest
from unittest.mock import patch

import control


class ControlProtocolTest(unittest.TestCase):
    def invoke(self, text, serve=True, side_effect=None):
        output = io.StringIO()
        with patch.object(control.sys, 'stdin', io.StringIO(text)), \
                patch.object(control.sys, 'stdout', output), \
                patch.object(control, 'control', side_effect=side_effect, return_value={'success': True}) as execute:
            control.main(serve=serve)
        return execute, [json.loads(line) for line in output.getvalue().splitlines()]

    def test_reuses_process_for_sequential_commands_and_preserves_unicode(self):
        actions = [{'type': 'status'}, {'type': 'type', 'text': 'नमस्ते'}]
        execute, replies = self.invoke(''.join(json.dumps(action) + '\n' for action in actions))
        self.assertEqual([call.args[0] for call in execute.call_args_list], actions)
        self.assertEqual(replies, [{'success': True}, {'success': True}])

    def test_legacy_mode_consumes_one_command_only(self):
        execute, replies = self.invoke('{"type":"status"}\n{"type":"click"}\n', serve=False)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(len(replies), 1)

    def test_oversized_or_partial_input_is_not_executed(self):
        for text in ['x' * 10001 + '\n{"type":"click"}\n', '{"type":"click"}']:
            execute, replies = self.invoke(text)
            execute.assert_not_called()
            self.assertEqual(replies, [])

    def test_error_is_not_marked_retryable_or_replayed(self):
        execute, replies = self.invoke('{"type":"click"}\n', side_effect=RuntimeError('private content'))
        self.assertEqual(execute.call_count, 1)
        self.assertFalse(replies[0]['success'])
        self.assertNotIn('notExecuted', replies[0])
        self.assertNotIn('private content', json.dumps(replies))


if __name__ == '__main__':
    unittest.main()
