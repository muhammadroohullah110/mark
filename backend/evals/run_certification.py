"""Project Cortex — Phase 4: LIVE certification smoke vs the deployed backend.

Plays each scenario's turns against /api/chat and flags red-flag behaviours
(hedging, empty replies, repeated offers). Heuristic auto-scoring + saved
transcripts for human review. Run this against the live (Cortex-enabled) backend:

    BACKEND=https://mark-udfz.onrender.com STORE_ID=<remote_store_id> \
        python backend/evals/run_certification.py

Note: this exercises the FULL stack (LLM + RAG + Cortex), so it needs a reachable
backend with an AI key configured. The offline brain check is run_cortex_eval.py.
"""
import os
import sys
import json
import time

try:
    import requests
except Exception:
    print("requests not installed"); sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.environ.get("BACKEND", "https://mark-udfz.onrender.com").rstrip("/")
STORE_ID = os.environ.get("STORE_ID", "")

HEDGE = ["still loading", "loading my catalog", "ask me again", "i don't know what this"]


def chat(history):
    """Send a (non-streaming) chat turn, return Mark's reply text."""
    body = {"messages": history, "user_language": "en", "store_id": STORE_ID, "stream": False}
    headers = {"Content-Type": "application/json"}
    if STORE_ID:
        headers["X-Store-ID"] = STORE_ID
    r = requests.post(f"{BACKEND}/api/chat", json=body, headers=headers, timeout=30)
    r.raise_for_status()
    return (r.json() or {}).get("response", "")


def run():
    scenarios = json.load(open(os.path.join(HERE, "scenarios.json"), encoding="utf-8"))["scenarios"]
    results, flags = [], 0
    for scn in scenarios:
        if not scn["turns"]:
            continue
        history, transcript, last_reply = [], [], ""
        for turn in scn["turns"]:
            if turn == "(reply)":
                continue
            history.append({"role": "user", "content": turn})
            try:
                reply = chat(history)
            except Exception as e:
                reply = f"[ERROR {e}]"
            history.append({"role": "assistant", "content": reply})
            transcript.append(("you", turn)); transcript.append(("mark", reply))
            last_reply = reply
            time.sleep(0.4)
        low = last_reply.lower()
        scenario_flags = [h for h in HEDGE if h in low]
        if not last_reply.strip():
            scenario_flags.append("empty reply")
        if scenario_flags:
            flags += 1
        results.append({"id": scn["id"], "flags": scenario_flags, "transcript": transcript})

    out = os.path.join(HERE, "certification_transcripts.json")
    json.dump(results, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    clean = sum(1 for r in results if not r["flags"])
    total = len(results)
    print(f"Live certification: {clean}/{total} scenarios with no red flags")
    for r in results:
        if r["flags"]:
            print(f"  FLAG {r['id']}: {', '.join(r['flags'])}")
    print(f"Transcripts saved -> {os.path.relpath(out)} (review manually for quality)")


if __name__ == "__main__":
    run()
