const assert = require('assert');

const knowledge = require('../../scripts/hooks/session-stop-knowledge');

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

console.log('session-stop-knowledge.js tests');

const results = [];

results.push(test('extractObservationPatterns records static exploration workflows for repo-internal dependency tracing', () => {
  const patterns = knowledge.extractObservationPatterns([
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"scripts/hooks/tool-call-correction.js","lineContent":"function buildCorrectionPlan() {}"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"scripts/hooks/tool-call-correction.js"}',
      tool_output: "function buildCorrectionPlan() { return 'TypeError'; }",
    },
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"tests/hooks/tool-call-correction.test.js","lineContent":"buildCorrectionPlan()"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"tests/hooks/tool-call-correction.test.js"}',
      tool_output: "assert.ok(plan.validation.ok);",
    },
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"tests/fixtures/tool-call-correction/eval-cases.json","lineContent":"vscode_listCodeUsages"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"tests/fixtures/tool-call-correction/eval-cases.json"}',
      tool_output: '{"cases":[{"toolName":"vscode_listCodeUsages"}]}',
    },
  ]);

  const staticWorkflow = patterns.find((pattern) =>
    pattern.kind === 'workflow' && pattern.content.includes('static usage search')
  );

  assert.ok(staticWorkflow, 'expected a workflow pattern for static usage search');
  assert.ok(staticWorkflow.content.includes('dependency tracing'));
  assert.ok(!patterns.some((pattern) => pattern.kind === 'error_resolution'));
}));

results.push(test('extractObservationPatterns ignores static exploration attempts that end in errors', () => {
  const patterns = knowledge.extractObservationPatterns([
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"missingSymbol"}',
      tool_output: 'Error: symbol not found',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"README.md"}',
      tool_output: 'completed',
    },
    {
      tool_name: 'grep_search',
      tool_input: '{"query":"missingSymbol","isRegexp":false}',
      tool_output: 'completed',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"README.md"}',
      tool_output: 'completed',
    },
    {
      tool_name: 'manage_todo_list',
      tool_input: '{"todoList":[]}',
      tool_output: 'completed',
    },
  ]);

  assert.ok(!patterns.some((pattern) => pattern.content.includes('static usage search')));
}));

results.push(test('extractObservationPatterns ignores unrelated reads after static exploration results', () => {
  const patterns = knowledge.extractObservationPatterns([
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"scripts/hooks/tool-call-correction.js","lineContent":"function buildCorrectionPlan() {}"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"README.md"}',
      tool_output: '# unrelated',
    },
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"scripts/hooks/tool-call-correction.js","lineContent":"function buildCorrectionPlan() {}"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"README.md"}',
      tool_output: '# still unrelated',
    },
    {
      tool_name: 'vscode_listCodeUsages',
      tool_input: '{"symbol":"buildCorrectionPlan"}',
      tool_output: '[{"filePath":"scripts/hooks/tool-call-correction.js","lineContent":"function buildCorrectionPlan() {}"}]',
    },
    {
      tool_name: 'read_file',
      tool_input: '{"filePath":"README.md"}',
      tool_output: '# unrelated again',
    },
  ]);

  assert.ok(!patterns.some((pattern) => pattern.content.includes('static usage search')));
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}