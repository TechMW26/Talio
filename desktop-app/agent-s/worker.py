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


def compact_observation_messages(messages):
    """Keep current AX evidence, but retain task/policy and prior action turns.

    Agent S flush_messages removes images, not the text buffers embedded in old
    user turns. Those buffers contain expiring AX references and can be large.
    Work on a copy: upstream may reuse its message objects for later formatting.
    """
    marker = '\nCurrent Text Buffer = ['
    latest = max((index for index, message in enumerate(messages)
                  if message.get('role') == 'user' and isinstance(message.get('content'), list)
                  and any(part.get('type') == 'text' and marker in part.get('text', '')
                          for part in message['content'])), default=-1)
    result = []
    for index, message in enumerate(messages):
        if not isinstance(message.get('content'), list):
            result.append(dict(message))
            continue
        parts = []
        for part in message['content']:
            item = dict(part)
            if index < latest and message.get('role') == 'user' and item.get('type') == 'text' and marker in item.get('text', ''):
                # Our SafeACI never runs a code agent, so this generated buffer
                # ends the observation text. Other action/policy turns stay intact.
                item['text'] = item['text'].split(marker, 1)[0] + '\n[Earlier UI evidence omitted. Use only the latest observation for control references.]'
            if item.get('type') == 'image_url':
                item['image_url'] = dict(item['image_url'])
            parts.append(item)
        result.append({**message, 'content': parts})
    return result


class PipeEngine:
    model = "deepseek-flash"

    def generate(self, messages, **_kwargs):
        messages = compact_observation_messages(messages)
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


def planner(policy=''):
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
            prompt = (str(system_prompt or '') + '\n' + policy) if policy else system_prompt
            return LMMAgent(engine=CompatiblePipeEngine(), system_prompt=prompt)

    class LocalAgentS(AgentS3):
        def reset(self):
            self.executor = LocalWorker(self.worker_engine_params, self.grounding_agent,
                                        self.platform, max_trajectory_length=2,
                                        enable_reflection=False)

    return LocalAgentS({"engine_type": "openai", "model": "deepseek-flash"}, SafeACI(),
                      platform={"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux"),
                      max_trajectory_length=2, enable_reflection=False)


def observation_notes(previous, current, evidence=''):
    # Old AX references are invalid after every observation. Keep compact input
    # outcomes/recovery notes, not twelve copies of stale full accessibility trees.
    prefix = 'Untrusted observation/tool evidence: '
    notes = [str(note)[:500] for note in previous if not str(note).startswith(prefix)]
    if evidence:
        item = 'Prior input evidence (not task completion): ' + str(evidence)[:400]
        if not notes or notes[-1] != item:
            notes.append(item)
    return notes[-8:] + [prefix + str(current)[:12000]]


def main():
    agent = None
    goal = None
    policy = ''
    while True:
        try:
            command = read()
            with contextlib.redirect_stdout(sys.stderr):
                if command.get("operation") == "begin":
                    goal = command["goal"]
                    policy = str(command.get('policy', ''))[:6000]
                    agent = planner(policy)
                    emit({"kind": "ready"})
                elif command.get("operation") == "predict" and agent and goal:
                    observation = {"screenshot": base64.b64decode(command["image"], validate=True)}
                    agent.grounding_agent.notes = observation_notes(agent.grounding_agent.notes, command.get("app", ""), command.get("evidence", ""))
                    # Remove old screenshots before the next inference, not only after it.
                    agent.executor.flush_messages()
                    _info, actions = agent.predict(goal, observation)
                    if len(actions) != 1 or not isinstance(actions[0], dict):
                        raise ValueError("Invalid plan")
                    value = actions[0]
                    if value.get("retryable"):
                        agent.grounding_agent.notes.append("The previous plan was not executed. Return one valid documented agent action using literal arguments and normalized 0..1 coordinates. Observe the current screen again; do not claim completion.")
                    emit({"kind": "result", **(value if "done" in value or "question" in value or "retryable" in value else {"action": value})})
                else:
                    raise ValueError("Unsupported operation")
        except EOFError:
            return
        except (ValueError, SyntaxError, TypeError):
            if agent:
                agent.grounding_agent.notes.append('No input was executed: invalid plan. Choose a different supported action with literal arguments, normalized coordinates, or a documented keyboard shortcut.')
            emit({"kind": "result", "retryable": True, "retryAfterMs": 200,
                  "message": "Rechecking the screen and choosing another input method."})
        except Exception:
            emit({"kind": "error", "message": "The local desktop planner stopped. Please retry or update Talio."})


if __name__ == "__main__":
    if sys.argv[1:] in (["--control"], ["--control-serve"]):
        from control import main as control_main
        control_main(serve=sys.argv[1:] == ["--control-serve"])
    else:
        main()
