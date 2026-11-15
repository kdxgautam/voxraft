"""Measure authenticated local planner latency without external provider calls."""

import argparse
import asyncio
import os
import statistics
import tempfile
import time
from pathlib import Path

import httpx


async def benchmark(samples: int) -> None:
    with tempfile.TemporaryDirectory(prefix='voxraft-latency-') as directory:
        for name in ('DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
            os.environ.pop(name, None)
        os.environ['BOLCANVAS_DB_PATH'] = str(Path(directory) / 'benchmark.sqlite3')
        os.environ['AUTH_SECRET_KEY'] = 'local-latency-benchmark-secret-' * 2
        os.environ['OPENAI_API_KEY'] = 'local-test-key'

        from auth import init_db
        from main import app

        init_db()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver') as client:
            response = await client.post('/api/auth/sign-up', json={'email': 'benchmark@example.test', 'password': 'benchmark-password-2026'})
            response.raise_for_status()
            cases = (
                ('Add Redis', {'text': 'Add Redis', 'diagram_context': {'type': 'architecture'}}, [{'type': 'ADD_NODE', 'label': 'Redis'}]),
                ('Add Redis on Mixed canvas', {'text': 'Add Redis', 'diagram_context': {'type': 'mixed'}, 'nodes': [{'id': 'api', 'label': 'API'}]}, [{'type': 'ADD_NODE', 'label': 'Redis'}]),
                ('Connect Frontend to API Gateway', {
                    'text': 'Connect Frontend to API Gateway', 'diagram_context': {'type': 'architecture'},
                    'nodes': [{'id': 'front', 'label': 'Frontend'}, {'id': 'gate', 'label': 'API Gateway'}],
                }, [{'type': 'ADD_EDGE', 'source': 'front', 'target': 'gate'}]),
            )
            for label, request, expected in cases:
                durations = []
                for _ in range(samples):
                    start = time.perf_counter()
                    response = await client.post('/api/plan', json=request)
                    durations.append((time.perf_counter() - start) * 1000)
                    response.raise_for_status()
                    if response.json() != {'actions': expected, 'mode': 'fallback'}:
                        raise RuntimeError(f'Unexpected planner response for {label}: {response.text}')
                ordered = sorted(durations)
                p95 = ordered[max(0, (95 * samples + 99) // 100 - 1)]
                print(f'{label}: n={samples}, median={statistics.median(durations):.1f} ms, '
                      f'p95={p95:.1f} ms, range={ordered[0]:.1f}–{ordered[-1]:.1f} ms')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.samples <= 20:
        parser.error('--samples must be between 1 and 20 to stay below the hourly request quota')
    asyncio.run(benchmark(args.samples))
