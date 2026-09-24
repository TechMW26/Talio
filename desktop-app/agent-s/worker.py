"""Local Agent S3 planner. Model requests travel over private stdin/stdout IPC.

No API key, HTTP listener, generated-code execution, or local shell agent.
"""
import base64
import contextlib
import json
import logging
import sys
from actions import SafeACI, parse_action

PROTOCOL = sys.stdout
logging.disable(logging.CRITICAL)  # Do not persist screenshots, message content or plans.


def emit(value):
    PROTOCOL.write(json.dumps(value, ensure_ascii=True) + "\n")
    PROTOCOL.flush()


def read():
    line = sys.stdin.readline(12 * 1024 * 1024 + 1)
    if not line or len(line) > 12 * 1024 * 1024:
        raise EOFError("IPC closed")
    return json.loads(line)


class PipeEngine:
    model = "deepseek-flash"

    def generate(self, messages, **_kwargs):
        # Upstream labels all byte screenshots PNG; Electron supplies JPEG.
        # Keep the real encoding and bound image history to two observations.
        images = [part for message in messages for part in message['content'] if part.get('type') == 'image_url']
        for part in images:
            part['image_url']['url'] = part['image_url']['url'].replace('data:image/png;base64,/9j/', 'data:image/jpeg;base64,/9j/')
        for message in messages:
            message['content'] = [part for part in message['content'] if part.get('type') != 'image_url' or any(part is recent for recent in images[-2:])]
        emit({"kind": "model_request", "messages": messages})
        result = read()
        if result.get("operation") != "model_response" or not isinstance(result.get("text"), str) or len(result["text"]) > 16000:
            raise ValueError("Invalid model response")
        return result["text"]


def planner():
    # Replace BOTH upstream references before importing the Worker. The upstream
    # formatter invokes action creation too; leaving either reference permits eval.
    from gui_agents.s3.utils import common_utils, formatters
    common_utils.create_pyautogui_code = parse_action
    formatters.create_pyautogui_code = parse_action
    from gui_agents.s3.agents import worker as worker_module
    worker_module.create_pyautogui_code = parse_action
    from gui_agents.s3.agents.agent_s import AgentS3
    from gui_agents.s3.core.mllm import LMMAgent
    from gui_agents.s3.core.engine import LMMEngineOpenAI

    class CompatiblePipeEngine(PipeEngine, LMMEngineOpenAI):
        def __init__(self):
            pass  # Only use upstream message formatting, never its network client.

    class LocalWorker(worker_module.Worker):
        def _create_agent(self, system_prompt=None, engine_params=None):
            return LMMAgent(engine=CompatiblePipeEngine(), system_prompt=system_prompt)

    class LocalAgentS(AgentS3):
        def reset(self):
            self.executor = LocalWorker(self.worker_engine_params, self.grounding_agent,
                                        self.platform, max_trajectory_length=2,
                                        enable_reflection=False)

    return LocalAgentS({"engine_type": "openai", "model": "deepseek-flash"}, SafeACI(),
                      platform={"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux"),
                      max_trajectory_length=2, enable_reflection=False)


def main():
    agent = None
    goal = None
    while True:
        try:
            command = read()
            with contextlib.redirect_stdout(sys.stderr):
                if command.get("operation") == "begin":
                    goal = command["goal"]
                    agent = planner()
                    emit({"kind": "ready"})
                elif command.get("operation") == "predict" and agent and goal:
                    observation = {"screenshot": base64.b64decode(command["image"], validate=True)}
                    agent.grounding_agent.notes = ["Foreground app: " + str(command.get("app", ""))[:100]]
                    # Remove old screenshots before the next inference, not only after it.
                    agent.executor.flush_messages()
                    _info, actions = agent.predict(goal, observation)
                    if len(actions) != 1 or not isinstance(actions[0], dict):
                        raise ValueError("Invalid plan")
                    value = actions[0]
                    emit({"kind": "result", **(value if "done" in value or "question" in value else {"action": value})})
                else:
                    raise ValueError("Unsupported operation")
        except EOFError:
            return
        except Exception:
            emit({"kind": "error", "message": "The local desktop planner stopped. Please retry or update Talio."})


if __name__ == "__main__":
    if sys.argv[1:] == ["--control"]:
        from control import main as control_main
        control_main()
    else:
        main()
