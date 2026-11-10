"""Run saved real commands against the configured planner: uv run --env-file .env python replay.py."""
import argparse
import asyncio
import json
from pathlib import Path

from main import PlanRequest, plan

CASES = Path(__file__).with_name("replay_cases.json")


def compare(actual: dict, expected: dict) -> list[str]:
    errors = []
    if expected.get("mode") and actual.get("mode") != expected["mode"]:
        errors.append(f"mode: expected {expected['mode']}, got {actual.get('mode')}")
    actions = actual.get("actions", [])
    wanted = expected["actions"]
    if len(actions) != len(wanted):
        errors.append(f"action count: expected {len(wanted)}, got {len(actions)}")
    for index, (action, target) in enumerate(zip(actions, wanted)):
        for field, value in target.items():
            got = action.get(field)
            if isinstance(value, str) and isinstance(got, str):
                same = " ".join(value.casefold().split()) == " ".join(got.casefold().split())
            else:
                same = got == value
            if not same: errors.append(f"action {index + 1} {field}: expected {value!r}, got {got!r}")
    return errors


async def run(selected: str | None = None) -> int:
    cases = json.loads(CASES.read_text())
    failures = 0
    count = 0
    for case in cases:
        if selected and selected not in case["name"]: continue
        count += 1
        actual = None
        try:
            actual = await plan(PlanRequest(**case["request"]))
            errors = compare(actual, case["expected"])
        except Exception as exc:
            errors = [str(exc)]
        print(f"{'PASS' if not errors else 'FAIL'} {case['name']}")
        for error in errors: print(f"  {error}")
        if errors and actual is not None: print(f"  actual: {json.dumps(actual, ensure_ascii=False)}")
        failures += bool(errors)
    if not count:
        print(f"No replay case matched {selected!r}")
        return 1
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", help="run cases whose name contains this text")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.case)))
