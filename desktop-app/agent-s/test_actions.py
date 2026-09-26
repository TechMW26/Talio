import unittest
from actions import SafeACI, parse_action


class ActionsTest(unittest.TestCase):
    def test_supported(self):
        self.assertEqual(parse_action(SafeACI(), 'agent.click(0.2, 0.7)', {}), {"type": "click", "x": 0.2, "y": 0.7})
        self.assertEqual(parse_action(SafeACI(), 'agent.type("hello")', {}), {"type": "type", "text": "hello"})
        self.assertEqual(parse_action(SafeACI(), 'agent.open_app("WhatsApp")', {}), {"type": "open_app", "name": "WhatsApp"})
        self.assertEqual(parse_action(SafeACI(), 'agent.create_file("note.txt", "Hello")', {}), {"type": "create_file", "name": "note.txt", "content": "Hello"})
        self.assertEqual(parse_action(SafeACI(), 'agent.key("open_location")', {}), {"type": "key", "key": "open_location"})
        self.assertEqual(parse_action(SafeACI(), 'agent.drag(0.1, 0.2, 0.8, 0.9)', {})['type'], 'drag')

    def test_reject_code(self):
        for code in ['__import__("os").system("id")', 'agent.click(0,0); agent.lock()',
                     'agent.__class__()', 'agent.type(str(123))', 'agent.type(**{})',
                     'agent.click(-1,0)', 'agent.key("command")', 'agent.scroll(True)',
                     'agent.open_app("foo;bar")', 'agent.type("a"*3000)',
                     'agent.assign_screenshot({})', 'agent.click(x=0,y=0,x=1)']:
            with self.subTest(code=code), self.assertRaises(Exception):
                parse_action(SafeACI(), code, {})

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
