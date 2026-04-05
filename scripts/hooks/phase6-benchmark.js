#!/usr/bin/env node
'use strict';

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeAreaReport(area, report = {}) {
  const total = toFiniteNumber(report.total, 0);
  const hits = toFiniteNumber(report.hits, 0);
  const missCount = Number.isFinite(report.missCount)
    ? report.missCount
    : Math.max(total - hits, 0);
  const hitRate = Number.isFinite(report.hitRate)
    ? report.hitRate
    : (total === 0 ? 0 : hits / total);

  return {
    area,
    total,
    hits,
    missCount,
    hitRate,
    usedEmbeddings: Boolean(report.usedEmbeddings),
    notes: Array.isArray(report.notes) ? [...report.notes] : [],
  };
}

function buildSummary(reports) {
  const total = reports.reduce((sum, report) => sum + report.total, 0);
  const hits = reports.reduce((sum, report) => sum + report.hits, 0);
  const missCount = reports.reduce((sum, report) => sum + report.missCount, 0);

  return {
    total,
    hits,
    missCount,
    hitRate: total === 0 ? 0 : hits / total,
    usedEmbeddings: reports.some((report) => report.usedEmbeddings),
  };
}

function aggregateReports(reports, metadata = {}) {
  const normalizedAreas = (reports || []).map((report) => normalizeAreaReport(report.area, report));

  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    summary: buildSummary(normalizedAreas),
    areas: normalizedAreas,
  };
}

function compareMetrics(current, baseline) {
  const currentMetrics = current || {};
  const baselineMetrics = baseline || {};

  return {
    total: toFiniteNumber(currentMetrics.total, 0),
    hits: toFiniteNumber(currentMetrics.hits, 0),
    missCount: toFiniteNumber(currentMetrics.missCount, 0),
    hitRate: toFiniteNumber(currentMetrics.hitRate, 0),
    deltaTotal: toFiniteNumber(currentMetrics.total, 0) - toFiniteNumber(baselineMetrics.total, 0),
    deltaHits: toFiniteNumber(currentMetrics.hits, 0) - toFiniteNumber(baselineMetrics.hits, 0),
    deltaMissCount: toFiniteNumber(currentMetrics.missCount, 0) - toFiniteNumber(baselineMetrics.missCount, 0),
    deltaHitRate: toFiniteNumber(currentMetrics.hitRate, 0) - toFiniteNumber(baselineMetrics.hitRate, 0),
    usedEmbeddings: Boolean(currentMetrics.usedEmbeddings),
    baselineUsedEmbeddings: Boolean(baselineMetrics.usedEmbeddings),
  };
}

function compareToBaseline(current, baseline = {}) {
  const currentAggregate = aggregateReports(current.areas || []);
  const baselineAreas = Array.isArray(baseline.areas) ? baseline.areas : [];
  const baselineByArea = new Map(baselineAreas.map((report) => [report.area, report]));

  const comparedAreas = currentAggregate.areas.map((report) => ({
    area: report.area,
    ...compareMetrics(report, baselineByArea.get(report.area)),
  }));

  return {
    generatedAt: current.generatedAt || currentAggregate.generatedAt,
    baselineGeneratedAt: baseline.generatedAt || null,
    summary: compareMetrics(current.summary || currentAggregate.summary, baseline.summary),
    areas: comparedAreas,
  };
}

module.exports = {
  aggregateReports,
  compareToBaseline,
  normalizeAreaReport,
};