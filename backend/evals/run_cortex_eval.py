"""Project Cortex — Phase 4: offline Cortex-decision eval.

Runs every scenario in scenarios.json through the Sales Cortex (NO LLM calls —
pure decision check) and asserts the brain picked the right stage / persona /
objection / buying-signal. Prints a scorecard. Gate: >= 90% pass.

Run:  python backend/evals/run_cortex_eval.py
For the FULL live conversation eval (LLM-played buyers vs the deployed backend),
see run_certification.py.
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # import backend/
import sales_cortex as sc

HERE = os.path.dirname(os.path.abspath(__file__))


def build_messages(turns):
    """Interleave visitor turns with stub assistant replies -> messages list."""
    msgs = []
    for i, t in enumerate(turns):
        msgs.append({"role": "user", "content": t})
        if i < len(turns) - 1:
            msgs.append({"role": "assistant", "content": "(reply)"})
    return msgs


def persona_for(scn, msgs):
    # mirror chat_endpoint: persona detected by MAIE heuristic
    try:
        import learning_engine as maie
        return maie.detect_persona(msgs)
    except Exception:
        return "browser"


def run():
    data = json.load(open(os.path.join(HERE, "scenarios.json"), encoding="utf-8"))
    scenarios = data["scenarios"]
    passed, failed = 0, []

    for scn in scenarios:
        msgs = build_messages(scn["turns"])
        persona = persona_for(scn, msgs)
        trace = sc.debug_trace(msgs, persona)
        exp = scn["expect"]
        problems = []
        if "stage" in exp and trace.get("stage") != exp["stage"]:
            problems.append(f"stage {trace.get('stage')} != {exp['stage']}")
        if "persona" in exp and persona != exp["persona"]:
            problems.append(f"persona {persona} != {exp['persona']}")
        if "objection" in exp and trace.get("objection") != exp["objection"]:
            problems.append(f"objection {trace.get('objection')} != {exp['objection']}")
        if "buying_signal" in exp and bool(trace.get("buying_signal")) != exp["buying_signal"]:
            problems.append(f"buying_signal {trace.get('buying_signal')} != {exp['buying_signal']}")
        # Every non-greet turn must produce a non-empty doctrine block when enabled
        if scn["turns"]:
            blk = sc.build_cortex_block(msgs, persona)
            if sc.ENABLED and not blk:
                problems.append("empty cortex block")
        if problems:
            failed.append((scn["id"], problems))
        else:
            passed += 1

    total = len(scenarios)
    pct = round(100 * passed / total, 1) if total else 0
    print("==== CORTEX DECISION SCORECARD ====")
    print(f"Passed: {passed}/{total}  ({pct}%)")
    for sid, probs in failed:
        print(f"  FAIL {sid}: {'; '.join(probs)}")
    print("===================================")
    gate = pct >= 90
    print("GATE PASS" if gate else "GATE FAIL (target >= 90%)")
    return gate


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
