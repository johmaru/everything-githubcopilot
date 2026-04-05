const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const correction = require('../../scripts/hooks/tool-call-correction');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

console.log('tool-call-correction.js tests');

const results = [];

results.push(test('drops unknown properties for registry-backed schemas', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'read_file',
    toolInput: {
      filePath: 'README.md',
      startLine: 1,
      endLine: 20,
      extraField: 'remove-me',
    },
  });

  assert.strictEqual(plan.status, 'suggested');
  assert.strictEqual(plan.failureType, 'validation_unknown_property');
  assert.deepStrictEqual(plan.correctedInput, {
    filePath: 'README.md',
    startLine: 1,
    endLine: 20,
  });
  assert.deepStrictEqual(plan.appliedFixes, [
    {
      type: 'drop_unknown_property',
      from: 'extraField',
    },
  ]);
}));

results.push(test('renames known aliases without overwriting canonical fields', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'read_file',
    toolInput: {
      file_path: 'README.md',
      start_line: 2,
      end_line: 30,
    },
  });

  assert.strictEqual(plan.status, 'suggested');
  assert.strictEqual(plan.failureType, 'validation_alias_match');
  assert.deepStrictEqual(plan.correctedInput, {
    filePath: 'README.md',
    startLine: 2,
    endLine: 30,
  });
  assert.deepStrictEqual(plan.appliedFixes, [
    { type: 'rename_alias', from: 'file_path', to: 'filePath' },
    { type: 'rename_alias', from: 'start_line', to: 'startLine' },
    { type: 'rename_alias', from: 'end_line', to: 'endLine' },
  ]);
}));

results.push(test('prefers canonical fields when alias and canonical keys coexist', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'read_file',
    toolInput: {
      file_path: 'alias.md',
      filePath: 'canonical.md',
      start_line: 2,
      startLine: 4,
      end_line: 30,
      endLine: 40,
    },
  });

  assert.strictEqual(plan.status, 'suggested');
  assert.strictEqual(plan.failureType, 'validation_alias_match');
  assert.deepStrictEqual(plan.correctedInput, {
    filePath: 'canonical.md',
    startLine: 4,
    endLine: 40,
  });
  assert.deepStrictEqual(plan.appliedFixes, [
    { type: 'drop_shadowed_alias', from: 'file_path', to: 'filePath' },
    { type: 'drop_shadowed_alias', from: 'start_line', to: 'startLine' },
    { type: 'drop_shadowed_alias', from: 'end_line', to: 'endLine' },
  ]);
}));

results.push(test('coerces lossless scalar strings to schema types', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'read_file',
    toolInput: {
      filePath: 'README.md',
      startLine: '10',
      endLine: '25',
    },
  });

  assert.strictEqual(plan.status, 'suggested');
  assert.strictEqual(plan.failureType, 'validation_type_mismatch');
  assert.deepStrictEqual(plan.correctedInput, {
    filePath: 'README.md',
    startLine: 10,
    endLine: 25,
  });
  assert.deepStrictEqual(plan.appliedFixes, [
    { type: 'coerce_scalar', field: 'startLine', from: 'string', to: 'number' },
    { type: 'coerce_scalar', field: 'endLine', from: 'string', to: 'number' },
  ]);
}));

results.push(test('blocks when required values would need guessing', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'read_file',
    toolInput: {
      startLine: 1,
      endLine: 20,
    },
  });

  assert.strictEqual(plan.status, 'blocked');
  assert.strictEqual(plan.failureType, 'validation_missing_required');
  assert.strictEqual(plan.correctedInput, null);
  assert.strictEqual(plan.blockedReason, 'missing_required_value');
  assert.deepStrictEqual(plan.missingRequired, ['filePath']);
}));

results.push(test('fails open with suggestion-only when the tool is not in the registry', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'imaginary_tool',
    modelProfile: 'GPT-5.4 (copilot)',
    toolInput: {
      anything: true,
    },
  });

  assert.strictEqual(plan.status, 'suggestion_only');
  assert.strictEqual(plan.failureType, 'no_schema');
  assert.strictEqual(plan.modelProfile, 'gpt-5.4');
  assert.strictEqual(plan.correctedInput, null);
  assert.strictEqual(plan.canRedispatch, false);
  assert.ok(plan.suggestedFixes.some((fix) => fix.type === 'registry_missing'));
}));

results.push(test('preserves unknown model profiles for no-schema plans', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'imaginary_tool',
    modelProfile: 'custom-lab-model',
    toolInput: {
      anything: true,
    },
  });

  assert.strictEqual(plan.status, 'suggestion_only');
  assert.strictEqual(plan.failureType, 'no_schema');
  assert.strictEqual(plan.modelProfile, 'custom-lab-model');
}));

results.push(test('blocks root scalar tool input as a type mismatch instead of pretending it is an empty object', () => {
  const plan = correction.buildCorrectionPlan({
    toolName: 'grep_search',
    toolInput: false,
  });

  assert.strictEqual(plan.status, 'blocked');
  assert.strictEqual(plan.failureType, 'validation_type_mismatch');
  assert.strictEqual(plan.blockedReason, 'unsafe_type_mismatch');
  assert.deepStrictEqual(plan.missingRequired, []);
  assert.deepStrictEqual(plan.typeMismatches, [
    {
      field: '$root',
      expectedType: 'object',
      actualType: 'boolean',
    },
  ]);
}));

results.push(test('treats explicit null and empty-string root inputs as invalid root values', () => {
  const nullPlan = correction.buildCorrectionPlan({
    toolName: 'grep_search',
    toolInput: null,
  });
  const emptyStringPlan = correction.buildCorrectionPlan({
    toolName: 'grep_search',
    toolInput: '',
  });

  assert.strictEqual(nullPlan.failureType, 'validation_type_mismatch');
  assert.deepStrictEqual(nullPlan.typeMismatches, [
    {
      field: '$root',
      expectedType: 'object',
      actualType: 'null',
    },
  ]);
  assert.strictEqual(emptyStringPlan.failureType, 'validation_type_mismatch');
  assert.deepStrictEqual(emptyStringPlan.typeMismatches, [
    {
      field: '$root',
      expectedType: 'object',
      actualType: 'string',
    },
  ]);
}));

results.push(test('applies GPT-5.4 specific aliases when a matching model profile is selected', () => {
  const genericPlan = correction.buildCorrectionPlan({
    toolName: 'grep_search',
    toolInput: {
      pattern: 'todo|plan',
      is_regexp: 'true',
    },
  });
  const gptPlan = correction.buildCorrectionPlan({
    toolName: 'grep_search',
    modelProfile: 'GPT-5.4 (copilot)',
    toolInput: {
      pattern: 'todo|plan',
      is_regexp: 'true',
    },
  });

  assert.strictEqual(genericPlan.status, 'blocked');
  assert.deepStrictEqual(genericPlan.missingRequired, ['query']);
  assert.strictEqual(gptPlan.status, 'suggested');
  assert.deepStrictEqual(gptPlan.correctedInput, {
    query: 'todo|plan',
    isRegexp: true,
  });
  assert.ok(gptPlan.appliedFixes.some((fix) => fix.type === 'rename_alias' && fix.from === 'pattern' && fix.to === 'query'));
}));

results.push(test('applies Kimi specific aliases when a matching model profile is selected', () => {
  const genericPlan = correction.buildCorrectionPlan({
    toolName: 'runSubagent',
    toolInput: {
      message: 'Investigate correction cases',
      task: 'review proxy results',
    },
  });
  const kimiPlan = correction.buildCorrectionPlan({
    toolName: 'runSubagent',
    modelProfile: 'umans-kimi-k2.5 (oaicopilot)',
    toolInput: {
      message: 'Investigate correction cases',
      task: 'review proxy results',
    },
  });

  assert.strictEqual(genericPlan.status, 'blocked');
  assert.deepStrictEqual(genericPlan.missingRequired.sort(), ['description', 'prompt']);
  assert.strictEqual(kimiPlan.status, 'suggested');
  assert.deepStrictEqual(kimiPlan.correctedInput, {
    prompt: 'Investigate correction cases',
    description: 'review proxy results',
  });
  assert.ok(kimiPlan.appliedFixes.some((fix) => fix.type === 'rename_alias' && fix.from === 'message' && fix.to === 'prompt'));
  assert.ok(kimiPlan.appliedFixes.some((fix) => fix.type === 'rename_alias' && fix.from === 'task' && fix.to === 'description'));
}));

results.push(test('evaluates correction cases and reports hit rate', () => {
  const report = correction.evaluateCorrectionCases([
    {
      name: 'gpt alias case',
      toolName: 'grep_search',
      modelProfile: 'gpt-5.4',
      toolInput: {
        pattern: 'fix hooks',
        is_regexp: 'false',
      },
      expected: {
        status: 'suggested',
        failureType: 'validation_type_mismatch',
        correctedInput: {
          query: 'fix hooks',
          isRegexp: false,
        },
      },
    },
    {
      name: 'kimi alias case',
      toolName: 'runSubagent',
      modelProfile: 'kimi-2.5',
      toolInput: {
        message: 'trace dependencies',
        task: 'collect findings',
      },
      expected: {
        status: 'suggested',
        failureType: 'validation_alias_match',
        correctedInput: {
          prompt: 'trace dependencies',
          description: 'collect findings',
        },
      },
    },
  ]);

  assert.strictEqual(report.total, 2);
  assert.strictEqual(report.hits, 2);
  assert.strictEqual(report.missCount, 0);
  assert.strictEqual(report.hitRate, 1);
  assert.ok(report.cases.every((testCase) => testCase.hit));
}));

results.push(test('records dry-run correction observations with the required output shape', () => {
  const observations = [];

  const result = correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
        start_line: '1',
        end_line: '20',
        extraField: 'remove-me',
      },
      tool_output: 'validation failed',
      session_id: 'sess-correction',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        return 'proj-correction';
      },
      upsertSession() {},
      insertObservation(_handle, observation) {
        observations.push(observation);
        return 1;
      },
      close() {},
    },
  });

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(observations.length, 1);
  assert.strictEqual(observations[0].eventType, 'tool_correction_dry_run');
  const recordedOutput = JSON.parse(observations[0].toolOutput);
  assert.strictEqual(recordedOutput.toolName, 'read_file');
  assert.strictEqual(recordedOutput.status, 'suggested');
  assert.strictEqual(recordedOutput.canRedispatch, false);
  assert.ok(Array.isArray(recordedOutput.appliedFixes));
  assert.deepStrictEqual(recordedOutput.correctedInput, {
    filePath: 'README.md',
    startLine: 1,
    endLine: 20,
  });
}));

results.push(test('preserves falsey tool outputs in correction observations', () => {
  const observations = [];

  correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
        start_line: '1',
        end_line: '20',
      },
      tool_output: false,
      session_id: 'sess-correction-false-output',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        return 'proj-correction';
      },
      upsertSession() {},
      insertObservation(_handle, observation) {
        observations.push(observation);
        return 1;
      },
      close() {},
    },
  });

  assert.strictEqual(observations.length, 1);
  const recordedOutput = JSON.parse(observations[0].toolOutput);
  assert.strictEqual(recordedOutput.originalToolOutput, 'false');
}));

results.push(test('fails open when database observation writes throw during hook processing', () => {
  const result = correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
        start_line: '1',
        end_line: '20',
      },
      tool_output: 'validation failed',
      session_id: 'sess-correction-db-failure',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        throw new Error('db read failed');
      },
      insertObservation() {
        throw new Error('db write failed');
      },
      close() {},
    },
  });

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.plan, 'plan should still be returned when observation persistence fails');
  assert.strictEqual(result.observation, null, 'observation should be omitted on best-effort DB failure');
}));

results.push(test('fails open when database close throws after best-effort processing', () => {
  const result = correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
        start_line: '1',
        end_line: '20',
      },
      tool_output: 'validation failed',
      session_id: 'sess-correction-close-failure',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        return 'proj-correction';
      },
      insertObservation() {},
      close() {
        throw new Error('db close failed');
      },
    },
  });

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.plan, 'plan should still be returned when close fails');
}));

results.push(test('sanitizes secrets and personal paths before storing correction observations', () => {
  const observations = [];

  correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        file_path: 'C:\\Users\\hatun\\secret.txt',
        start_line: '1',
        end_line: '20',
        token: 'ghp_abcdefghijklmnopqrstuvwxyz',
        includePattern: '/home/hatun/private/config.json',
        backupPath: '/Users/hatun/private/backup.json',
      },
      tool_output: 'Bearer super-secret-token /Users/hatun/private/output.json',
      session_id: 'sess-correction-sanitize',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        return 'proj-correction';
      },
      upsertSession() {},
      insertObservation(_handle, observation) {
        observations.push(observation);
        return 1;
      },
      close() {},
    },
  });

  assert.strictEqual(observations.length, 1);
  assert.ok(!observations[0].toolInput.includes('ghp_abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!observations[0].toolInput.includes('C:\\Users\\hatun'));
  assert.ok(!observations[0].toolInput.includes('/home/hatun/private/config.json'));
  assert.ok(!observations[0].toolInput.includes('/Users/hatun/private/backup.json'));
  assert.ok(observations[0].toolInput.includes('<redacted>'));
  assert.ok(observations[0].toolInput.includes('<redacted-path>'));
  assert.ok(!observations[0].toolOutput.includes('super-secret-token'));
  assert.ok(!observations[0].toolOutput.includes('/Users/hatun/private/output.json'));
  assert.ok(observations[0].toolOutput.includes('Bearer <redacted>'));
  assert.ok(observations[0].toolOutput.includes('<redacted-path>'));
}));

results.push(test('sanitizes JSON-style secret key/value pairs before storing correction observations', () => {
  const observations = [];

  correction.processFailurePayload({
    payload: {
      tool_name: 'read_file',
      tool_input: {
        filePath: 'README.md',
        startLine: 1,
        endLine: 20,
        token: 'plain-secret',
        password: 'hunter2',
        apiKey: 'abc123',
      },
      tool_output: JSON.stringify({ token: 'response-secret', secret: 'response-secret-2' }),
      session_id: 'sess-correction-json-sanitize',
      cwd: process.cwd(),
    },
    dbModule: {
      isAvailable() {
        return true;
      },
      open() {
        return { prepare() { return { get() { return { 1: 1 }; } }; } };
      },
      detectProjectId() {
        return 'proj-correction';
      },
      upsertSession() {},
      insertObservation(_handle, observation) {
        observations.push(observation);
        return 1;
      },
      close() {},
    },
  });

  assert.strictEqual(observations.length, 1);
  assert.ok(!observations[0].toolInput.includes('plain-secret'));
  assert.ok(!observations[0].toolInput.includes('hunter2'));
  assert.ok(!observations[0].toolInput.includes('abc123'));
  assert.ok(observations[0].toolInput.includes('"token":"<redacted>"'));
  assert.ok(observations[0].toolInput.includes('"password":"<redacted>"'));
  assert.ok(observations[0].toolInput.includes('"apiKey":"<redacted>"'));
  assert.ok(!observations[0].toolOutput.includes('response-secret'));
  assert.ok(!observations[0].toolOutput.includes('response-secret-2'));
  assert.ok(observations[0].toolOutput.includes('\\"token\\":\\"<redacted>\\"'));
  assert.ok(observations[0].toolOutput.includes('\\"secret\\":\\"<redacted>\\"'));
}));

results.push(test('hook mode stays silent while recording a dry-run correction observation', () => {
  const observations = [];
  const writes = [];
  const originalStdoutWrite = process.stdout.write;

  try {
    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };

    const exitCode = correction.runCli(['node', 'tool-call-correction.js'], {
      contextPayload: {
        tool_name: 'read_file',
        tool_input: {
          file_path: 'README.md',
          start_line: '1',
          end_line: '20',
        },
        tool_output: 'validation failed',
        session_id: 'sess-correction-hook-mode',
        cwd: process.cwd(),
      },
      dbModule: {
        isAvailable() {
          return true;
        },
        open() {
          return { prepare() { return { get() { return { 1: 1 }; } }; } };
        },
        detectProjectId() {
          return 'proj-correction';
        },
        upsertSession() {},
        insertObservation(_handle, observation) {
          observations.push(observation);
          return 1;
        },
        close() {},
      },
    });

    assert.strictEqual(exitCode, 0);
    assert.strictEqual(observations.length, 1);
    assert.deepStrictEqual(writes, []);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}));

results.push(test('eval CLI reads cases from disk and prints a deterministic report', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egc-correction-eval-'));
  const casesPath = path.join(tempDir, 'cases.json');
  const writes = [];
  const originalStdoutWrite = process.stdout.write;

  try {
    fs.writeFileSync(casesPath, JSON.stringify([
      {
        name: 'gpt cli eval',
        toolName: 'grep_search',
        modelProfile: 'gpt-5.4',
        toolInput: {
          pattern: 'review output',
          is_regexp: 'true',
        },
        expected: {
          status: 'suggested',
          failureType: 'validation_type_mismatch',
          correctedInput: {
            query: 'review output',
            isRegexp: true,
          },
        },
      },
    ], null, 2));

    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };

    const exitCode = correction.runCli([
      'node',
      'tool-call-correction.js',
      'eval',
      '--cases',
      casesPath,
    ]);

    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(writes.join('').trim());
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.hits, 1);
    assert.strictEqual(output.hitRate, 1);
  } finally {
    process.stdout.write = originalStdoutWrite;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}));

results.push(test('classify CLI preserves explicit null and empty-string root inputs as invalid-root mismatches', () => {
  const writes = [];
  const originalStdoutWrite = process.stdout.write;

  try {
    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };

    let exitCode = correction.runCli([
      'node',
      'tool-call-correction.js',
      'classify',
      '--tool',
      'grep_search',
      '--input',
      'null',
    ]);
    assert.strictEqual(exitCode, 0);
    let output = JSON.parse(writes.join('').trim());
    assert.strictEqual(output.failureType, 'validation_type_mismatch');
    assert.deepStrictEqual(output.typeMismatches, [
      {
        field: '$root',
        expectedType: 'object',
        actualType: 'null',
      },
    ]);

    writes.length = 0;
    exitCode = correction.runCli([
      'node',
      'tool-call-correction.js',
      'classify',
      '--tool',
      'grep_search',
      '--input',
      '',
    ]);
    assert.strictEqual(exitCode, 0);
    output = JSON.parse(writes.join('').trim());
    assert.strictEqual(output.failureType, 'validation_type_mismatch');
    assert.deepStrictEqual(output.typeMismatches, [
      {
        field: '$root',
        expectedType: 'object',
        actualType: 'string',
      },
    ]);

    writes.length = 0;
    exitCode = correction.runCli([
      'node',
      'tool-call-correction.js',
      'classify',
      '--tool',
      'grep_search',
      '--input',
    ]);
    assert.strictEqual(exitCode, 0);
    output = JSON.parse(writes.join('').trim());
    assert.strictEqual(output.failureType, 'validation_type_mismatch');
    assert.deepStrictEqual(output.typeMismatches, [
      {
        field: '$root',
        expectedType: 'object',
        actualType: 'string',
      },
    ]);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}));

results.push(test('shipped correction eval fixture covers at least five benchmark cases', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'tool-call-correction', 'eval-cases.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 5, `expected at least 5 shipped cases, received ${cases.length}`);
  assert.ok(cases.every((testCase) => testCase.toolName && testCase.expected));
}));

results.push(test('eval CLI uses the shipped correction fixture when cases are omitted', () => {
  const output = JSON.parse(execFileSync('node', [
    path.join(__dirname, '..', '..', 'scripts', 'hooks', 'tool-call-correction.js'),
    'eval',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  }));

  assert.ok(output.total >= 5);
  assert.strictEqual(output.missCount, 0);
  assert.strictEqual(output.hitRate, 1);
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}