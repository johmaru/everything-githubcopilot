#!/usr/bin/env node
'use strict';

/**
 * Embedding module — local ONNX-based sentence embeddings.
 * Uses Xenova/all-MiniLM-L6-v2 via @huggingface/transformers.
 * Cold-start: 3-10s on first load. Use only in prompts, not hooks.
 */

const path = require('path');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EXPECTED_DIM = 384;
const CACHE_DIR = path.resolve(__dirname, '..', '..', '.github', 'sessions', '.model-cache');

let _pipeline = null;
let _loading = null;
let _available = null;

/**
 * Check if @huggingface/transformers is installed.
 * Result is cached after first call.
 * @returns {boolean}
 */
function isAvailable() {
  if (_available !== null) return _available;
  try {
    require.resolve('@huggingface/transformers');
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

/**
 * Initialize the feature-extraction pipeline (async, cached singleton).
 * Resolves to the pipeline instance or null if unavailable.
 * @returns {Promise<object|null>}
 */
async function init() {
  if (_pipeline) return _pipeline;
  if (_loading) return _loading;
  if (!isAvailable()) return null;

  _loading = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = CACHE_DIR;
      env.localModelPath = CACHE_DIR;

      _pipeline = await pipeline('feature-extraction', MODEL_ID, {
        cache_dir: CACHE_DIR,
      });
      return _pipeline;
    } catch (err) {
      _pipeline = null;
      _available = false;
      console.error('[embedding] Failed to load model:', err.message);
      return null;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

/**
 * Check if pipeline is loaded and ready for inference.
 * @returns {boolean}
 */
function isReady() {
  return _pipeline !== null;
}

/**
 * Generate embedding for a single text string.
 * @param {string} text
 * @returns {Promise<Float32Array|null>} 384-dim embedding or null
 */
async function embed(text) {
  if (!text || typeof text !== 'string') return null;
  if (!_pipeline) await init();
  if (!_pipeline) return null;

  try {
    const result = await _pipeline(text, { pooling: 'mean', normalize: true });
    const data = result.data instanceof Float32Array
      ? result.data
      : new Float32Array(result.data);

    if (data.length !== EXPECTED_DIM) {
      console.error(`[embedding] Unexpected dimension: ${data.length} (expected ${EXPECTED_DIM})`);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[embedding] embed() failed:', err.message);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in a single batch.
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>} Array of 384-dim embeddings (empty on failure)
 */
async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  if (!_pipeline) await init();
  if (!_pipeline) return [];

  try {
    const results = [];
    for (const text of texts) {
      if (!text || typeof text !== 'string') {
        results.push(null);
        continue;
      }
      const result = await _pipeline(text, { pooling: 'mean', normalize: true });
      const data = result.data instanceof Float32Array
        ? result.data
        : new Float32Array(result.data);
      results.push(data.length === EXPECTED_DIM ? data : null);
    }
    return results;
  } catch (err) {
    console.error('[embedding] embedBatch() failed:', err.message);
    return [];
  }
}

/**
 * Dispose the pipeline to free memory.
 */
function dispose() {
  _pipeline = null;
  _loading = null;
}

module.exports = { isAvailable, init, isReady, embed, embedBatch, dispose, MODEL_ID, EXPECTED_DIM };
