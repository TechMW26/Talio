import unittest
from actions import SafeACI, parse_action


class ActionsTest(unittest.TestCase):
    def test_provider_messages_drop_old_ax_buffers_not_actions_or_task(self):
        from worker import compact_observation_messages
        import copy
        messages = [{'role': 'system', 'content': [{'type': 'text', 'text': 'Keep the task and safety policy.'}]}]
        for index in range(24):
            messages.extend([
                {'role': 'user', 'content': [{'type': 'text', 'text': f'Observation {index}\nCurrent Text Buffer = [old-tree-{index}-' + 'x' * 12000 + ']\n'}]},
                {'role': 'assistant', 'content': [{'type': 'text', 'text': f'Action {index}, verify result before retrying.'}]},
            ])
        before = copy.deepcopy(messages)
        compacted = compact_observation_messages(messages)
        text = str(compacted)
        self.assertEqual(messages, before)
        self.assertEqual(compacted[0], messages[0])
        self.assertNotIn('old-tree-0-', text)
        self.assertNotIn('old-tree-22-', text)
        self.assertIn('old-tree-23-', text)
        self.assertIn('Action 0, verify result before retrying.', text)
        self.assertIn('Action 23, verify result before retrying.', text)
        self.assertLess(len(text), 22000)
        self.assertEqual(compact_observation_messages(compacted), compacted)

    def test_compaction_preserves_formatter_and_non_observation_messages(self):
        from worker import compact_observation_messages
        messages = [{'role': 'user', 'content': 'Format this action'},
                    {'role': 'assistant', 'content': [{'type': 'text', 'text': 'agent.done("Verified")'}]}]
        self.assertEqual(compact_observation_messages(messages), messages)

    def test_current_targets_replace_stale_trees_but_retain_compact_outcomes(self):
        from worker import observation_notes
        notes = []
        for index in range(20):
            notes = observation_notes(notes, f'current-ref-{index}', f'input {index} delivered; verify')
        text = '\n'.join(notes)
        self.assertIn('current-ref-19', text)
        self.assertNotIn('current-ref-18', text)
        self.assertIn('input 18 delivered', text)
        self.assertEqual(len(notes), 9)
        self.assertLess(len(text), 1000)

    def test_bounded_literal_sequences(self):
        self.assertEqual(parse_action(SafeACI(), 'agent.navigate("https://example.com")', {})['type'], 'navigate')
        result = parse_action(SafeACI(), 'agent.batch([{"type":"key","key":"find"},{"type":"type","text":"Mansi"}])', {})
        self.assertEqual(len(result['actions']), 2)
        for code in [
            'agent.navigate("javascript:alert(1)")',
            'agent.navigate("https://user:pass@example.com")',
            'agent.batch([{"type":"type","text":"Hi"},{"type":"key","key":"enter"}])',
            'agent.batch([{"type":"click","x":0.2,"y":0.3},{"type":"type","text":"Hi\\n"}])',
            'agent.batch([agent.key("find"),agent.type("Mansi")])',
            'agent.batch([{"type":"open_app","name":"Notes"},{"type":"type","text":"Hi"}])',
        ]:
            with self.subTest(code=code), self.assertRaises(Exception):
                parse_action(SafeACI(), code, {})

    def test_supported(self):
        self.assertEqual(parse_action(SafeACI(), 'agent.click_target("current-ref")', {}), {"type": "semantic", "operation": "click", "ref": "current-ref"})
        self.assertEqual(parse_action(SafeACI(), 'agent.click(0.2, 0.7)', {}), {"type": "click", "x": 0.2, "y": 0.7})
        self.assertEqual(parse_action(SafeACI(), 'agent.type("hello")', {}), {"type": "type", "text": "hello"})
        self.assertEqual(parse_action(SafeACI(), 'agent.open_app("WhatsApp")', {}), {"type": "open_app", "name": "WhatsApp"})
        self.assertEqual(parse_action(SafeACI(), 'agent.create_file("note.txt", "Hello")', {}), {"type": "create_file", "name": "note.txt", "content": "Hello"})
        self.assertEqual(parse_action(SafeACI(), 'agent.key("open_location")', {}), {"type": "key", "key": "open_location"})
        for shortcut in ("space", "app_switch", "app_search", "browser_address", "new_tab", "close_tab", "refresh", "save", "undo", "redo"):
            with self.subTest(shortcut=shortcut):
                self.assertEqual(parse_action(SafeACI(), f'agent.key("{shortcut}")', {}), {"type": "key", "key": shortcut})
        self.assertEqual(parse_action(SafeACI(), 'agent.drag(0.1, 0.2, 0.8, 0.9)', {})['type'], 'drag')

    def test_reject_code(self):
        for code in ['__import__("os").system("id")', 'agent.click(0,0); agent.lock()',
                     'agent.__class__()', 'agent.type(str(123))', 'agent.type(**{})',
                     'agent.click(-1,0)', 'agent.key("command")', 'agent.scroll(True)',
                     'agent.open_app("foo;bar")', 'agent.type("a"*3000)',
                     'agent.assign_screenshot({})', 'agent.click(x=0,y=0,x=1)',
                     'agent.click_target("stale ref;code")', 'agent.click_target(1)']:
            with self.subTest(code=code), self.assertRaises(Exception):
                parse_action(SafeACI(), code, {})

    def test_keyboard_shortcuts_follow_host_platform(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        import control
        pyautogui = SimpleNamespace(hotkey=lambda *keys: calls.append(keys), press=lambda key: calls.append((key,)))
        for platform, action, expected in (
            ("win32", "app_switch", ("alt", "tab")),
            ("win32", "browser_address", ("ctrl", "l")),
            ("linux", "app_search", ("win",)),
            ("linux", "redo", ("ctrl", "shift", "z")),
        ):
            calls = []
            with self.subTest(platform=platform, action=action), patch.object(control, "status", return_value={"success": True}), patch.object(sys, "platform", platform), patch.dict(sys.modules, {"pyautogui": pyautogui}):
                result = control.control({"type": "key", "key": action})
            self.assertTrue(result["success"])
            self.assertEqual(calls, [expected])

    def test_wait_is_recoverable_without_input(self):
        result = parse_action(SafeACI(), 'agent.wait(1)', {})
        self.assertTrue(result['retryable'])
        self.assertNotIn('question', result)
        for seconds in [-1, 6, float('nan'), True]:
            with self.assertRaises(ValueError):
                SafeACI().wait(seconds)

    def test_invalid_upstream_plan_recovers_on_next_observation(self):
        import io
        from PIL import Image
        from unittest.mock import patch
        from worker import planner, PipeEngine
        png = io.BytesIO()
        Image.new('RGB', (30, 30), 'white').save(png, format='PNG')
        instance = planner()
        with patch.object(PipeEngine, 'generate', return_value='invalid plan'):
            _, actions = instance.predict('Find a contact', {'screenshot': png.getvalue()})
        self.assertTrue(actions[0]['retryable'])
        with patch.object(PipeEngine, 'generate', return_value='```python\nagent.key("find")\n```'):
            _, actions = instance.predict('Find a contact', {'screenshot': png.getvalue()})
        self.assertEqual(actions, [{'type': 'key', 'key': 'find'}])

    def test_worker_retains_agent_s(self):
        from worker import planner
        from gui_agents.s3.agents.agent_s import AgentS3
        from gui_agents.s3.utils import common_utils, formatters
        from gui_agents.s3.agents import worker
        instance = planner()
        self.assertIsInstance(instance, AgentS3)
        self.assertIs(common_utils.create_pyautogui_code, parse_action)
        self.assertIs(formatters.create_pyautogui_code, parse_action)
        self.assertIs(worker.create_pyautogui_code, parse_action)

    def test_upstream_prediction_and_history(self):
        import io
        from PIL import Image
        from unittest.mock import patch
        from worker import planner, PipeEngine
        png = io.BytesIO()
        Image.new('RGB', (30, 30), 'white').save(png, format='PNG')
        instance = planner()
        with patch.object(PipeEngine, 'generate', return_value='```python\nagent.open_app("WhatsApp")\n```'):
            _, actions = instance.predict('Open WhatsApp', {"screenshot": png.getvalue()})
        self.assertEqual(actions, [{"type": "open_app", "name": "WhatsApp"}])
        self.assertEqual(instance.executor.turn_count, 1)
        with patch.object(PipeEngine, 'generate', return_value='```python\nagent.done("WhatsApp is open.")\n```'):
            _, actions = instance.predict('Open WhatsApp', {"screenshot": png.getvalue()})
        self.assertTrue(actions[0]['done'])
        self.assertEqual(instance.executor.turn_count, 2)


if __name__ == '__main__':
    unittest.main()
