import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from replay import CASES, compare


def test_replay_cases_have_checkable_expectations():
    cases = json.loads(CASES.read_text())
    assert len(cases) >= 5
    assert all(case['request']['text'] and case['expected']['actions'] for case in cases)


def test_replay_comparison_catches_merged_nodes_and_wrong_targets():
    expected = {'actions':[{'type':'ADD_NODE','label':'Frontend'},{'type':'ADD_NODE','label':'API Gateway'}]}
    assert compare({'actions':[{'type':'ADD_NODE','label':'Frontend API Gateway'}]}, expected)
    assert not compare({'actions':[{'type':'ADD_NODE','label':'frontend'},{'type':'ADD_NODE','label':'api gateway'}]}, expected)
