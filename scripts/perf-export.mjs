import assert from 'node:assert/strict';
import { buildExport } from '../src/shared/export.ts';
import { createSyntheticDeployment } from '../tests/fixtures/synthetic-deployment.ts';

// 3,000 Comments is several times the real deployment. The full 5,000-Comment
// fixture exceeds the budget, because JSON.stringify time grows with output size.
const commentCount = 3000;
const fixture = createSyntheticDeployment();
const deployment = {
  ...fixture,
  comments: fixture.comments.slice(0, commentCount),
};
const exportedAt = new Date('2026-02-01T00:00:00.000Z');
const warmupRuns = 10;
const measuredRuns = 21;
const budgetMs = 5;

function serializeExport() {
  return JSON.stringify(buildExport(deployment, exportedAt));
}

for (let run = 0; run < warmupRuns; run++) {
  serializeExport();
}

const samplesMs = [];
for (let run = 0; run < measuredRuns; run++) {
  const start = process.cpuUsage();
  serializeExport();
  const { user, system } = process.cpuUsage(start);
  samplesMs.push((user + system) / 1_000);
}

samplesMs.sort((a, b) => a - b);
const medianMs = samplesMs[Math.floor(samplesMs.length / 2)];
console.log(
  `JSON export for ${deployment.comments.length} Comments on Node ${process.versions.node}: ` +
    `median ${medianMs.toFixed(3)} ms CPU (${measuredRuns} samples after ${warmupRuns} warm-ups, ` +
    `range ${samplesMs[0].toFixed(3)}–${samplesMs.at(-1).toFixed(3)} ms, budget ${budgetMs} ms)`,
);
assert.ok(medianMs <= budgetMs, 'JSON export exceeded its median CPU budget');
