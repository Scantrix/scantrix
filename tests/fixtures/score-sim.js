// Model the real 23-finding distribution
const findings = [
  // High severity (5)
  { id: 'PW-FLAKE-001', sev: 3, occ: 170, cat: 1.0 },
  { id: 'PW-FLAKE-005', sev: 3, occ: 25,  cat: 1.0 },
  { id: 'PW-STABILITY-001', sev: 3, occ: 30, cat: 1.0 },
  { id: 'PW-INSIGHT-001', sev: 3, occ: 8, cat: 1.5 },
  { id: 'CI-002', sev: 3, occ: 3, cat: 1.3 },
  // Medium severity (8)
  { id: 'PW-FLAKE-002', sev: 2, occ: 20, cat: 1.0 },
  { id: 'PW-LOC-001',   sev: 2, occ: 45, cat: 1.0 },
  { id: 'ARCH-001',     sev: 2, occ: 12, cat: 1.2 },
  { id: 'ARCH-005',     sev: 2, occ: 8,  cat: 1.2 },
  { id: 'CI-006',       sev: 2, occ: 3,  cat: 1.3 },
  { id: 'CI-007',       sev: 2, occ: 3,  cat: 1.3 },
  { id: 'PW-PERF-002',  sev: 2, occ: 15, cat: 1.0 },
  { id: 'PW-STABILITY-006', sev: 2, occ: 10, cat: 1.0 },
  // Low severity (10)
  { id: 'PW-FLAKE-003', sev: 1, occ: 5,  cat: 1.0 },
  { id: 'PW-FLAKE-006', sev: 1, occ: 12, cat: 1.0 },
  { id: 'ARCH-009',     sev: 1, occ: 8,  cat: 1.2 },
  { id: 'ARCH-010',     sev: 1, occ: 15, cat: 1.2 },
  { id: 'PW-LOC-003',   sev: 1, occ: 10, cat: 1.0 },
  { id: 'PW-DEPREC-007',sev: 1, occ: 20, cat: 1.0 },
  { id: 'PW-DEPREC-008',sev: 1, occ: 5,  cat: 1.0 },
  { id: 'CI-005',       sev: 1, occ: 2,  cat: 1.3 },
  { id: 'CI-009',       sev: 1, occ: 3,  cat: 1.3 },
  { id: 'PW-INSIGHT-002', sev: 1, occ: 1, cat: 1.5 },
];

// Generic score calculator — accepts any scoring function
function calcScore(findings, testFiles, riskFn, lambdaFn) {
  let riskPoints = 0;
  for (const f of findings) {
    riskPoints += riskFn(f);
  }
  const lambda = lambdaFn(testFiles);
  const score = Math.round(100 * Math.exp(-riskPoints / lambda));
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 25 ? 'D' : 'F';
  return { score, grade, riskPoints: Math.round(riskPoints * 10) / 10, lambda: Math.round(lambda) };
}

// Lambda functions
function makeLambdaFn(baseLambda, densityCoeff, densityCap) {
  return (testFiles) => {
    const rawFactor = 1.0 + densityCoeff * Math.log2(Math.max(testFiles / 50, 1));
    const densityFactor = Math.min(densityCap, Math.max(1.0, rawFactor));
    return baseLambda * densityFactor;
  };
}

const configs = [
  { name: 'CURRENT: log2, lambda=80, density=0.5/3.5',
    riskFn: (f) => f.sev * (1 + 0.7 * Math.log2(Math.max(f.occ, 1))) * f.cat,
    lambdaFn: makeLambdaFn(80, 0.5, 3.5) },

  { name: 'E: sqrt, lambda=150, density=0.3/4.0',
    riskFn: (f) => f.sev * Math.sqrt(Math.max(f.occ, 1)) * f.cat,
    lambdaFn: makeLambdaFn(150, 0.3, 4.0) },

  { name: 'F: N^0.6, lambda=200, density=0.3/4.0',
    riskFn: (f) => f.sev * Math.pow(Math.max(f.occ, 1), 0.6) * f.cat,
    lambdaFn: makeLambdaFn(200, 0.3, 4.0) },

  { name: 'G: N^0.6, lambda=250, density=0.3/4.0',
    riskFn: (f) => f.sev * Math.pow(Math.max(f.occ, 1), 0.6) * f.cat,
    lambdaFn: makeLambdaFn(250, 0.3, 4.0) },

  { name: 'H: N^0.6, lambda=300, density=0.25/4.0',
    riskFn: (f) => f.sev * Math.pow(Math.max(f.occ, 1), 0.6) * f.cat,
    lambdaFn: makeLambdaFn(300, 0.25, 4.0) },
];

console.log('='.repeat(115));
console.log('SCENARIO: 23 findings (5 high, 8 medium, 10 low) - 981 test files');
console.log('='.repeat(115));
console.log('');

for (const cfg of configs) {
  console.log('--- ' + cfg.name + ' ---');
  const full = calcScore(findings, 981, cfg.riskFn, cfg.lambdaFn);
  const partial = calcScore(
    findings.map(f => f.id === 'PW-FLAKE-001' ? Object.assign({}, f, { occ: 112 }) : f),
    981, cfg.riskFn, cfg.lambdaFn
  );
  const fixedOne = calcScore(
    findings.filter(f => f.id !== 'PW-FLAKE-001'),
    981, cfg.riskFn, cfg.lambdaFn
  );
  const noHighs = calcScore(
    findings.filter(f => f.sev !== 3),
    981, cfg.riskFn, cfg.lambdaFn
  );

  console.log('  Lambda: ' + full.lambda + '  Total risk pts: ' + full.riskPoints);
  console.log('  All 23 findings:           score=' + full.score + ' (' + full.grade + ')');
  console.log('  Fix 58/170 PW-FLAKE-001:   score=' + partial.score + ' (' + partial.grade + ')  delta=+' + (partial.score - full.score));
  console.log('  Fix ALL PW-FLAKE-001:      score=' + fixedOne.score + ' (' + fixedOne.grade + ')  delta=+' + (fixedOne.score - full.score));
  console.log('  Fix all 5 highs:           score=' + noHighs.score + ' (' + noHighs.grade + ')  delta=+' + (noHighs.score - full.score));
  console.log('  Fix everything:            score=100 (A)');
  console.log('');
}

console.log('='.repeat(115));
console.log('REPO SIZE COMPARISON (same 23 findings)');
console.log('='.repeat(115));
console.log('');

const repoSizes = [30, 50, 100, 200, 500, 981, 2000, 5000, 10000];

for (const cfg of configs) {
  console.log('--- ' + cfg.name + ' ---');
  console.log('  Files  | Score | Grade | Fix 58/170 | Fix all FLAKE-001 | Fix all highs');
  console.log('  -------|-------|-------|------------|-------------------|-------------');
  for (const files of repoSizes) {
    const full = calcScore(findings, files, cfg.riskFn, cfg.lambdaFn);
    const partial = calcScore(
      findings.map(f => f.id === 'PW-FLAKE-001' ? Object.assign({}, f, { occ: 112 }) : f),
      files, cfg.riskFn, cfg.lambdaFn
    );
    const fixedOne = calcScore(
      findings.filter(f => f.id !== 'PW-FLAKE-001'),
      files, cfg.riskFn, cfg.lambdaFn
    );
    const noHighs = calcScore(
      findings.filter(f => f.sev !== 3),
      files, cfg.riskFn, cfg.lambdaFn
    );
    console.log(
      '  ' + String(files).padStart(5) + '  |  ' +
      String(full.score).padStart(3) + '  |   ' + full.grade + '   |' +
      ('    +' + (partial.score - full.score)).padStart(10) + '  |' +
      ('    +' + (fixedOne.score - full.score)).padStart(17) + '  |' +
      ('    +' + (noHighs.score - full.score)).padStart(13)
    );
  }
  console.log('');
}

// Occurrence multiplier comparison
console.log('='.repeat(115));
console.log('OCCURRENCE MULTIPLIER COMPARISON');
console.log('='.repeat(115));
console.log('');
console.log('  Occurrences | log2 (current) |    sqrt    |   N^0.6    ');
console.log('  ------------|----------------|------------|------------');
for (const n of [1, 3, 5, 10, 25, 50, 100, 112, 170, 500]) {
  const log2 = 1 + 0.7 * Math.log2(Math.max(n, 1));
  const sqrt = Math.sqrt(n);
  const pow6 = Math.pow(n, 0.6);
  console.log(
    '  ' + String(n).padStart(11) + '  |' +
    log2.toFixed(2).padStart(14) + '  |' +
    sqrt.toFixed(2).padStart(10) + '  |' +
    pow6.toFixed(2).padStart(10)
  );
}
console.log('');

// Show the delta for 170->112 at each power
console.log('  PW-FLAKE-001 risk delta (170->112, high sev):');
console.log('    log2:  ' + (3 * ((1+0.7*Math.log2(170)) - (1+0.7*Math.log2(112)))).toFixed(1) + ' risk pts');
console.log('    sqrt:  ' + (3 * (Math.sqrt(170) - Math.sqrt(112))).toFixed(1) + ' risk pts');
console.log('    N^0.6: ' + (3 * (Math.pow(170,0.6) - Math.pow(112,0.6))).toFixed(1) + ' risk pts');
