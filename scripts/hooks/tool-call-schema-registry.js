'use strict';

const MODEL_PROFILE_ALIASES = Object.freeze({
  generic: ['generic'],
  'gpt-5.4': ['gpt-5.4', 'gpt-5.4 (copilot)', 'gpt 5.4', 'gpt5.4'],
  'kimi-2.5': ['kimi-2.5', 'kimi 2.5', 'kimi-k2.5', 'umans-kimi-k2.5', 'umans-kimi-k2.5 (oaicopilot)'],
});

const TOOL_SCHEMAS = Object.freeze({
  get_errors: {
    required: [],
    properties: {
      filePaths: 'string[]',
    },
    aliases: {
      file_paths: 'filePaths',
    },
  },
  grep_search: {
    required: ['query', 'isRegexp'],
    properties: {
      query: 'string',
      isRegexp: 'boolean',
      includePattern: 'string',
      maxResults: 'number',
      includeIgnoredFiles: 'boolean',
    },
    aliases: {
      include_pattern: 'includePattern',
      include_ignored_files: 'includeIgnoredFiles',
      is_regexp: 'isRegexp',
      max_results: 'maxResults',
    },
    profiles: {
      'gpt-5.4': {
        aliases: {
          pattern: 'query',
        },
      },
    },
  },
  manage_todo_list: {
    required: ['todoList'],
    properties: {
      explanation: 'string',
      todoList: 'object[]',
    },
    aliases: {
      todo_list: 'todoList',
    },
  },
  read_file: {
    required: ['filePath', 'startLine', 'endLine'],
    properties: {
      filePath: 'string',
      startLine: 'number',
      endLine: 'number',
    },
    aliases: {
      file_path: 'filePath',
      start_line: 'startLine',
      end_line: 'endLine',
    },
  },
  runSubagent: {
    required: ['prompt', 'description'],
    properties: {
      prompt: 'string',
      description: 'string',
      agentName: 'string',
    },
    aliases: {
      agent_name: 'agentName',
    },
    profiles: {
      'kimi-2.5': {
        aliases: {
          message: 'prompt',
          task: 'description',
        },
      },
    },
  },
  vscode_listCodeUsages: {
    required: ['symbol', 'lineContent'],
    oneOfRequired: [['filePath', 'uri']],
    properties: {
      symbol: 'string',
      uri: 'string',
      filePath: 'string',
      lineContent: 'string',
    },
    aliases: {
      symbol_name: 'symbol',
      symbolName: 'symbol',
      file_path: 'filePath',
      file: 'filePath',
      path: 'filePath',
      file_uri: 'uri',
      line_content: 'lineContent',
      line_text: 'lineContent',
    },
  },
});

function cloneSchema(schema) {
  if (!schema) {
    return null;
  }

  return {
    required: [...(schema.required || [])],
    oneOfRequired: (schema.oneOfRequired || []).map((group) => [...group]),
    properties: { ...(schema.properties || {}) },
    aliases: { ...(schema.aliases || {}) },
    profiles: { ...(schema.profiles || {}) },
  };
}

function normalizeModelProfile(modelProfile) {
  if (!modelProfile) {
    return 'generic';
  }

  const normalized = String(modelProfile).trim().toLowerCase();
  for (const [profileName, aliases] of Object.entries(MODEL_PROFILE_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return profileName;
    }
  }

  return 'generic';
}

function getToolSchema(toolName, options = {}) {
  if (!toolName) {
    return null;
  }

  const schema = TOOL_SCHEMAS[String(toolName).trim()];
  if (!schema) {
    return null;
  }

  const mergedSchema = cloneSchema(schema);
  const modelProfile = normalizeModelProfile(options.modelProfile);
  const profileOverrides = mergedSchema.profiles[modelProfile] || null;

  if (profileOverrides && profileOverrides.aliases) {
    mergedSchema.aliases = {
      ...mergedSchema.aliases,
      ...profileOverrides.aliases,
    };
  }

  mergedSchema.modelProfile = modelProfile;
  return mergedSchema;
}

module.exports = {
  MODEL_PROFILE_ALIASES,
  TOOL_SCHEMAS,
  getToolSchema,
  normalizeModelProfile,
};