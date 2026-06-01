"""
One-time SQLite → PostgreSQL data migration for Mark.

Usage (from the backend/ folder):

    # 1. Point at your Postgres (Render Starter) and run:
    DATABASE_URL="postgres://user:pass@host:5432/dbname" python migrate_to_pg.py

    # Optional: pass a custom path to the old SQLite file:
    DATABASE_URL="postgres://..." python migrate_to_pg.py /path/to/mark.db

What it does:
    • Ensures the Postgres schema exists (imports database.py in PG mode → init_db()).
    • Copies every table from the local SQLite file into Postgres,
      parents first (stores before its children) to satisfy foreign keys.
    • Idempotent: re-running skips rows that already exist (ON CONFLICT DO NOTHING).
    • Resets each table's id sequence so future inserts don't collide.

It is SAFE to run multiple times. If no SQLite file exists, it just
ensures the Postgres schema and exits.
"""

import os
import sys
import sqlite3
from pathlib import Path

# Tables in foreign-key-safe order (parents before children).
TABLE_ORDER = [
    "admin_users",
    "stores",
    "conversations",
    "analytics_events",
    "leads",
    "learning_signals",
    "store_playbooks",
]

# Tables whose id is an auto-increment serial (sequence must be reset).
SERIAL_TABLES = [
    "admin_users", "conversations", "analytics_events",
    "leads", "learning_signals", "store_playbooks",
]


def main():
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url.startswith(("postgres://", "postgresql://")):
        print("ERROR: set DATABASE_URL to a postgres:// connection string first.")
        sys.exit(1)

    sqlite_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (Path(__file__).parent / "mark.db")

    # Importing database in PG mode (DATABASE_URL is set) creates the schema.
    import database as db  # noqa: E402
    print("PostgreSQL schema ensured.")

    if not sqlite_path.exists():
        print(f"No SQLite file at {sqlite_path} — schema is ready, nothing to copy.")
        return

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    total_copied = 0
    for table in TABLE_ORDER:
        # Does this table exist in the old SQLite DB?
        exists = src.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            print(f"  - {table}: not in SQLite, skipping")
            continue

        rows = src.execute(f"SELECT * FROM {table}").fetchall()
        if not rows:
            print(f"  - {table}: 0 rows")
            continue

        cols = rows[0].keys()
        col_list = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))
        insert_sql = (
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT DO NOTHING"
        )
        data = [tuple(r[c] for c in cols) for r in rows]

        with db.get_db() as conn:
            cur = conn._raw.cursor()
            cur.executemany(insert_sql, data)
            cur.close()
        print(f"  - {table}: copied {len(data)} rows")
        total_copied += len(data)

    # Reset id sequences so the next INSERT gets a fresh id.
    with db.get_db() as conn:
        for table in SERIAL_TABLES:
            cur = conn._raw.cursor()
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), true)"
            )
            cur.close()
    print(f"\nDone. {total_copied} rows copied. Sequences reset.")
    src.close()


if __name__ == "__main__":
    main()
