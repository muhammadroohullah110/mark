"""Phase 1 gate: validate every corpus card loads with stdlib json and has the
expected shape. Run: python backend/knowledge/validate_corpus.py"""
import json, glob, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")

def main():
    files = sorted(glob.glob(os.path.join(CORPUS, "*.json")))
    if not files:
        print("NO CORPUS FILES FOUND"); sys.exit(1)
    total_items = 0
    print(f"{'module':<18} {'version':<8} items  source")
    print("-" * 80)
    for f in files:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)                      # raises if invalid JSON
        assert "module" in data, f"{f}: missing 'module'"
        assert "version" in data, f"{f}: missing 'version'"
        # count the main collection in each card
        n = 0
        for k in ("items", "models", "techniques", "stages", "patterns", "ladder"):
            if isinstance(data.get(k), list):
                n = len(data[k]); break
        total_items += n
        src = (data.get("source", "") or "")[:46]
        print(f"{data['module']:<18} {str(data['version']):<8} {n:<6} {src}")
    print("-" * 80)
    print(f"OK — {len(files)} corpus files parsed, {total_items} doctrine items total.")

if __name__ == "__main__":
    main()
