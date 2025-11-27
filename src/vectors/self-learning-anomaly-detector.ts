/**
 * Self-Learning Anomaly Detection System
 * Uses vector similarity and GNN-learned patterns for intelligent anomaly detection
 */

import { logger } from '../core/logger.js';
import type { KpiMeasurement, Alarm, FaultEvent, PredictionResult } from '../types/ran-models.js';

export interface AnomalyConfig {
  windowSize: number;
  zScoreThreshold: number;
  minSamples: number;
  learningRate: number;
  adaptationRate: number;
  enableOnlineLearning: boolean;
  confidenceThreshold: number;
}

export interface AnomalyResult {
  id: string;
  timestamp: number;
  nodeId: string;
  cellId?: string;
  kpiName: string;
  value: number;
  expectedValue: number;
  anomalyScore: number;
  anomalyType: AnomalyType;
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: AnomalyContext;
  suggestedActions: string[];
}

export type AnomalyType =
  | 'spike'
  | 'dip'
  | 'trend_change'
  | 'level_shift'
  | 'variance_change'
  | 'pattern_deviation'
  | 'correlation_break'
  | 'seasonal_deviation';

export interface AnomalyContext {
  historicalMean: number;
  historicalStd: number;
  recentTrend: number;
  seasonalExpected?: number;
  correlatedKpis?: Array<{ kpiName: string; correlation: number; anomalyScore: number }>;
  relatedAlarms?: Alarm[];
  learnedPattern?: string;
}

export interface LearnedBaseline {
  kpiName: string;
  nodeId: string;
  cellId?: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  hourlyProfile: number[];
  weeklyProfile: number[];
  trend: number;
  lastUpdated: number;
  sampleCount: number;
}

export interface CorrelationMatrix {
  kpiNames: string[];
  matrix: number[][];
  lastUpdated: number;
}

export interface DetectionMetrics {
  totalDetections: number;
  truePositives: number;
  falsePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  avgDetectionLatency: number;
}

/**
 * Self-Learning Anomaly Detection System
 * Features:
 * - Adaptive baseline learning
 * - Multi-variate correlation analysis
 * - Pattern-based detection using learned vectors
 * - Online learning with drift adaptation
 * - Seasonal and trend-aware detection
 */
export class SelfLearningAnomalyDetector {
  private config: AnomalyConfig;
  private isInitialized = false;

  // Learned state
  private baselines: Map<string, LearnedBaseline> = new Map();
  private correlationMatrix: CorrelationMatrix | null = null;
  private recentAnomalies: AnomalyResult[] = [];
  private kpiHistory: Map<string, number[]> = new Map();

  // Performance metrics
  private detectionCount = 0;
  private feedbackCount = 0;
  private truePositives = 0;
  private falsePositives = 0;
  private detectionLatencies: number[] = [];

  // Pattern learning
  private learnedPatterns: Map<string, Float32Array> = new Map();
  private patternLabels: Map<string, string> = new Map();

  constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = {
      windowSize: 100,
      zScoreThreshold: 3.0,
      minSamples: 30,
      learningRate: 0.01,
      adaptationRate: 0.1,
      enableOnlineLearning: true,
      confidenceThreshold: 0.7,
      ...config
    };
  }

  /**
   * Initialize the anomaly detector
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing Self-Learning Anomaly Detector', { config: this.config });

    // Initialize default patterns
    this.initializeDefaultPatterns();

    this.isInitialized = true;
    logger.info('Self-Learning Anomaly Detector initialized');
  }

  /**
   * Detect anomalies in KPI measurements
   */
  async detectAnomalies(kpis: KpiMeasurement[]): Promise<AnomalyResult[]> {
    this.ensureInitialized();
    const startTime = performance.now();
    const anomalies: AnomalyResult[] = [];

    for (const kpi of kpis) {
      const result = await this.detectSingleAnomaly(kpi);
      if (result && result.anomalyScore >= this.config.confidenceThreshold) {
        anomalies.push(result);
        this.recentAnomalies.push(result);
      }

      // Update baseline with online learning
      if (this.config.enableOnlineLearning) {
        await this.updateBaseline(kpi);
      }
    }

    // Trim recent anomalies list
    if (this.recentAnomalies.length > 1000) {
      this.recentAnomalies = this.recentAnomalies.slice(-1000);
    }

    const latency = performance.now() - startTime;
    this.detectionLatencies.push(latency);
    if (this.detectionLatencies.length > 100) {
      this.detectionLatencies.shift();
    }

    this.detectionCount += anomalies.length;

    logger.debug('Anomaly detection completed', {
      inputCount: kpis.length,
      anomaliesFound: anomalies.length,
      latencyMs: latency.toFixed(2)
    });

    return anomalies;
  }

  /**
   * Detect anomaly for a single KPI measurement
   */
  private async detectSingleAnomaly(kpi: KpiMeasurement): Promise<AnomalyResult | null> {
    const baselineKey = this.getBaselineKey(kpi);
    const baseline = this.baselines.get(baselineKey);

    // Update history
    this.updateHistory(baselineKey, kpi.value);
    const history = this.kpiHistory.get(baselineKey) || [];

    if (!baseline || baseline.sampleCount < this.config.minSamples) {
      // Not enough data for detection
      return null;
    }

    // Multi-method anomaly detection
    const zScoreResult = this.detectByZScore(kpi.value, baseline);
    const trendResult = this.detectByTrendChange(history, baseline);
    const seasonalResult = this.detectBySeasonalDeviation(kpi, baseline);
    const patternResult = await this.detectByPattern(kpi, history);
    const varianceResult = this.detectByVarianceChange(history, baseline);

    // Combine results
    const combinedScore = this.combineAnomalyScores([
      { score: zScoreResult.score, weight: 0.3 },
      { score: trendResult.score, weight: 0.2 },
      { score: seasonalResult.score, weight: 0.2 },
      { score: patternResult.score, weight: 0.2 },
      { score: varianceResult.score, weight: 0.1 }
    ]);

    if (combinedScore < this.config.confidenceThreshold) {
      return null;
    }

    // Determine anomaly type
    const anomalyType = this.determineAnomalyType(
      zScoreResult,
      trendResult,
      seasonalResult,
      patternResult,
      varianceResult
    );

    // Calculate expected value
    const expectedValue = this.calculateExpectedValue(kpi, baseline);

    // Generate context
    const context = await this.generateAnomalyContext(kpi, baseline, history);

    // Determine severity
    const severity = this.calculateSeverity(combinedScore, anomalyType, kpi.kpiName);

    return {
      id: `anomaly_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: kpi.timestamp,
      nodeId: kpi.nodeId,
      cellId: kpi.cellId,
      kpiName: kpi.kpiName,
      value: kpi.value,
      expectedValue,
      anomalyScore: combinedScore,
      anomalyType,
      confidence: combinedScore,
      severity,
      context,
      suggestedActions: this.generateSuggestedActions(anomalyType, kpi, combinedScore)
    };
  }

  /**
   * Learn baseline from historical data
   */
  async learnBaseline(
    kpis: KpiMeasurement[],
    options: { windowDays?: number; minSamples?: number } = {}
  ): Promise<Map<string, LearnedBaseline>> {
    this.ensureInitialized();

    const { windowDays = 7, minSamples = 100 } = options;
    const cutoffTime = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    // Group KPIs by baseline key
    const kpiGroups = new Map<string, KpiMeasurement[]>();
    for (const kpi of kpis) {
      if (kpi.timestamp < cutoffTime) continue;

      const key = this.getBaselineKey(kpi);
      const group = kpiGroups.get(key) || [];
      group.push(kpi);
      kpiGroups.set(key, group);
    }

    // Learn baseline for each group
    for (const [key, group] of kpiGroups) {
      if (group.length < minSamples) continue;

      const baseline = this.computeBaseline(group);
      this.baselines.set(key, baseline);
    }

    logger.info('Baselines learned', {
      groupCount: kpiGroups.size,
      baselinesCreated: this.baselines.size
    });

    return this.baselines;
  }

  /**
   * Learn correlations between KPIs
   */
  async learnCorrelations(kpis: KpiMeasurement[]): Promise<CorrelationMatrix> {
    this.ensureInitialized();

    // Group by timestamp and node
    const timeGroups = new Map<string, Map<string, number>>();
    for (const kpi of kpis) {
      const timeKey = `${kpi.nodeId}_${Math.floor(kpi.timestamp / 3600000)}`; // Hourly
      const group = timeGroups.get(timeKey) || new Map();
      group.set(kpi.kpiName, kpi.value);
      timeGroups.set(timeKey, group);
    }

    // Get all KPI names
    const kpiNames = [...new Set(kpis.map(k => k.kpiName))];

    // Build correlation matrix
    const matrix: number[][] = [];
    for (let i = 0; i < kpiNames.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < kpiNames.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          matrix[i][j] = this.computeCorrelation(kpiNames[i], kpiNames[j], timeGroups);
        }
      }
    }

    this.correlationMatrix = {
      kpiNames,
      matrix,
      lastUpdated: Date.now()
    };

    logger.info('Correlation matrix learned', { kpiCount: kpiNames.length });

    return this.correlationMatrix;
  }

  /**
   * Learn patterns from labeled anomalies
   */
  async learnPatterns(
    labeledAnomalies: Array<{ kpis: KpiMeasurement[]; label: string }>
  ): Promise<number> {
    this.ensureInitialized();

    let learnedCount = 0;

    for (const { kpis, label } of labeledAnomalies) {
      if (kpis.length < 10) continue;

      const values = kpis.map(k => k.value);
      const patternEmbedding = this.createPatternEmbedding(values);
      const patternId = `pattern_${label}_${Date.now()}`;

      this.learnedPatterns.set(patternId, patternEmbedding);
      this.patternLabels.set(patternId, label);
      learnedCount++;
    }

    logger.info('Patterns learned', { count: learnedCount });

    return learnedCount;
  }

  /**
   * Provide feedback on anomaly detection (for online learning)
   */
  provideFeedback(anomalyId: string, isTrue: boolean): void {
    this.feedbackCount++;

    if (isTrue) {
      this.truePositives++;
    } else {
      this.falsePositives++;

      // Adjust thresholds based on false positives
      if (this.config.enableOnlineLearning) {
        this.config.zScoreThreshold *= 1.05; // Increase threshold slightly
      }
    }

    logger.debug('Feedback received', { anomalyId, isTrue });
  }

  /**
   * Get detection metrics
   */
  getMetrics(): DetectionMetrics {
    const precision = this.truePositives / (this.truePositives + this.falsePositives) || 0;
    const recall = this.truePositives / (this.truePositives + this.feedbackCount - this.falsePositives) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

    const avgLatency = this.detectionLatencies.length > 0
      ? this.detectionLatencies.reduce((a, b) => a + b, 0) / this.detectionLatencies.length
      : 0;

    return {
      totalDetections: this.detectionCount,
      truePositives: this.truePositives,
      falsePositives: this.falsePositives,
      precision,
      recall,
      f1Score,
      avgDetectionLatency: avgLatency
    };
  }

  /**
   * Get recent anomalies
   */
  getRecentAnomalies(limit: number = 100): AnomalyResult[] {
    return this.recentAnomalies.slice(-limit);
  }

  /**
   * Get baseline for a KPI
   */
  getBaseline(nodeId: string, kpiName: string, cellId?: string): LearnedBaseline | undefined {
    const key = cellId
      ? `${nodeId}_${cellId}_${kpiName}`
      : `${nodeId}_${kpiName}`;
    return this.baselines.get(key);
  }

  /**
   * Export learned state
   */
  exportState(): {
    baselines: Array<[string, LearnedBaseline]>;
    patterns: Array<[string, { embedding: number[]; label: string }]>;
    correlationMatrix: CorrelationMatrix | null;
    metrics: DetectionMetrics;
  } {
    const patterns: Array<[string, { embedding: number[]; label: string }]> = [];
    this.learnedPatterns.forEach((embedding, id) => {
      patterns.push([id, {
        embedding: Array.from(embedding),
        label: this.patternLabels.get(id) || 'unknown'
      }]);
    });

    return {
      baselines: Array.from(this.baselines.entries()),
      patterns,
      correlationMatrix: this.correlationMatrix,
      metrics: this.getMetrics()
    };
  }

  /**
   * Import learned state
   */
  importState(state: ReturnType<typeof this.exportState>): void {
    this.baselines = new Map(state.baselines);

    this.learnedPatterns.clear();
    this.patternLabels.clear();
    for (const [id, { embedding, label }] of state.patterns) {
      this.learnedPatterns.set(id, new Float32Array(embedding));
      this.patternLabels.set(id, label);
    }

    this.correlationMatrix = state.correlationMatrix;

    logger.info('State imported', {
      baselinesCount: this.baselines.size,
      patternsCount: this.learnedPatterns.size
    });
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Anomaly detector not initialized. Call initialize() first.');
    }
  }

  private initializeDefaultPatterns(): void {
    // Spike pattern
    const spikePattern = new Float32Array(50);
    for (let i = 0; i < 50; i++) {
      spikePattern[i] = i === 25 ? 1 : 0.1;
    }
    this.learnedPatterns.set('default_spike', spikePattern);
    this.patternLabels.set('default_spike', 'spike');

    // Dip pattern
    const dipPattern = new Float32Array(50);
    for (let i = 0; i < 50; i++) {
      dipPattern[i] = i === 25 ? 0 : 0.9;
    }
    this.learnedPatterns.set('default_dip', dipPattern);
    this.patternLabels.set('default_dip', 'dip');

    // Level shift pattern
    const shiftPattern = new Float32Array(50);
    for (let i = 0; i < 50; i++) {
      shiftPattern[i] = i < 25 ? 0.3 : 0.7;
    }
    this.learnedPatterns.set('default_shift', shiftPattern);
    this.patternLabels.set('default_shift', 'level_shift');
  }

  private getBaselineKey(kpi: KpiMeasurement): string {
    return kpi.cellId
      ? `${kpi.nodeId}_${kpi.cellId}_${kpi.kpiName}`
      : `${kpi.nodeId}_${kpi.kpiName}`;
  }

  private updateHistory(key: string, value: number): void {
    const history = this.kpiHistory.get(key) || [];
    history.push(value);

    if (history.length > this.config.windowSize) {
      history.shift();
    }

    this.kpiHistory.set(key, history);
  }

  private computeBaseline(kpis: KpiMeasurement[]): LearnedBaseline {
    const values = kpis.map(k => k.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);

    // Compute hourly profile (24 hours)
    const hourlyProfile = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);
    for (const kpi of kpis) {
      const hour = new Date(kpi.timestamp).getHours();
      hourlyProfile[hour] += kpi.value;
      hourlyCounts[hour]++;
    }
    for (let i = 0; i < 24; i++) {
      hourlyProfile[i] = hourlyCounts[i] > 0 ? hourlyProfile[i] / hourlyCounts[i] : mean;
    }

    // Compute weekly profile (7 days)
    const weeklyProfile = new Array(7).fill(0);
    const weeklyCounts = new Array(7).fill(0);
    for (const kpi of kpis) {
      const day = new Date(kpi.timestamp).getDay();
      weeklyProfile[day] += kpi.value;
      weeklyCounts[day]++;
    }
    for (let i = 0; i < 7; i++) {
      weeklyProfile[i] = weeklyCounts[i] > 0 ? weeklyProfile[i] / weeklyCounts[i] : mean;
    }

    // Compute trend
    let trend = 0;
    if (values.length > 1) {
      const xMean = (values.length - 1) / 2;
      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < values.length; i++) {
        numerator += (i - xMean) * (values[i] - mean);
        denominator += Math.pow(i - xMean, 2);
      }
      trend = denominator !== 0 ? numerator / denominator : 0;
    }

    return {
      kpiName: kpis[0].kpiName,
      nodeId: kpis[0].nodeId,
      cellId: kpis[0].cellId,
      mean,
      std,
      min: Math.min(...values),
      max: Math.max(...values),
      hourlyProfile,
      weeklyProfile,
      trend,
      lastUpdated: Date.now(),
      sampleCount: values.length
    };
  }

  private async updateBaseline(kpi: KpiMeasurement): Promise<void> {
    const key = this.getBaselineKey(kpi);
    const baseline = this.baselines.get(key);

    if (!baseline) {
      // Create new baseline
      this.baselines.set(key, {
        kpiName: kpi.kpiName,
        nodeId: kpi.nodeId,
        cellId: kpi.cellId,
        mean: kpi.value,
        std: 0,
        min: kpi.value,
        max: kpi.value,
        hourlyProfile: new Array(24).fill(kpi.value),
        weeklyProfile: new Array(7).fill(kpi.value),
        trend: 0,
        lastUpdated: Date.now(),
        sampleCount: 1
      });
      return;
    }

    // Online update using exponential moving average
    const alpha = this.config.adaptationRate;
    const newMean = (1 - alpha) * baseline.mean + alpha * kpi.value;
    const variance = (1 - alpha) * Math.pow(baseline.std, 2) +
      alpha * Math.pow(kpi.value - newMean, 2);

    baseline.mean = newMean;
    baseline.std = Math.sqrt(variance);
    baseline.min = Math.min(baseline.min, kpi.value);
    baseline.max = Math.max(baseline.max, kpi.value);
    baseline.sampleCount++;
    baseline.lastUpdated = Date.now();

    // Update hourly profile
    const hour = new Date(kpi.timestamp).getHours();
    baseline.hourlyProfile[hour] = (1 - alpha) * baseline.hourlyProfile[hour] + alpha * kpi.value;

    // Update weekly profile
    const day = new Date(kpi.timestamp).getDay();
    baseline.weeklyProfile[day] = (1 - alpha) * baseline.weeklyProfile[day] + alpha * kpi.value;
  }

  private detectByZScore(
    value: number,
    baseline: LearnedBaseline
  ): { score: number; zScore: number } {
    if (baseline.std === 0) {
      return { score: 0, zScore: 0 };
    }

    const zScore = Math.abs(value - baseline.mean) / baseline.std;
    const score = Math.min(zScore / this.config.zScoreThreshold, 1);

    return { score, zScore };
  }

  private detectByTrendChange(
    history: number[],
    baseline: LearnedBaseline
  ): { score: number; currentTrend: number } {
    if (history.length < 10) {
      return { score: 0, currentTrend: 0 };
    }

    // Compute recent trend
    const recentWindow = history.slice(-10);
    const recentMean = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;
    let currentTrend = 0;
    const xMean = (recentWindow.length - 1) / 2;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < recentWindow.length; i++) {
      numerator += (i - xMean) * (recentWindow[i] - recentMean);
      denominator += Math.pow(i - xMean, 2);
    }
    currentTrend = denominator !== 0 ? numerator / denominator : 0;

    // Compare with baseline trend
    const trendDiff = Math.abs(currentTrend - baseline.trend);
    const normalizedDiff = trendDiff / (Math.abs(baseline.trend) + 0.001);

    const score = Math.min(normalizedDiff, 1);

    return { score, currentTrend };
  }

  private detectBySeasonalDeviation(
    kpi: KpiMeasurement,
    baseline: LearnedBaseline
  ): { score: number; expectedSeasonal: number } {
    const date = new Date(kpi.timestamp);
    const hour = date.getHours();
    const day = date.getDay();

    // Combine hourly and weekly expectations
    const hourlyExpected = baseline.hourlyProfile[hour];
    const weeklyExpected = baseline.weeklyProfile[day];
    const expectedSeasonal = (hourlyExpected + weeklyExpected) / 2;

    const deviation = Math.abs(kpi.value - expectedSeasonal);
    const normalizedDeviation = deviation / (baseline.std + 0.001);

    const score = Math.min(normalizedDeviation / this.config.zScoreThreshold, 1);

    return { score, expectedSeasonal };
  }

  private async detectByPattern(
    kpi: KpiMeasurement,
    history: number[]
  ): Promise<{ score: number; matchedPattern?: string }> {
    if (history.length < 20) {
      return { score: 0 };
    }

    const recentValues = history.slice(-50);
    const queryEmbedding = this.createPatternEmbedding(recentValues);

    let maxSimilarity = 0;
    let matchedPattern: string | undefined;

    for (const [patternId, patternEmbedding] of this.learnedPatterns) {
      const similarity = this.cosineSimilarity(queryEmbedding, patternEmbedding);

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchedPattern = this.patternLabels.get(patternId);
      }
    }

    // High similarity to anomaly patterns means high anomaly score
    const score = maxSimilarity > 0.8 ? maxSimilarity : 0;

    return { score, matchedPattern };
  }

  private detectByVarianceChange(
    history: number[],
    baseline: LearnedBaseline
  ): { score: number; currentVariance: number } {
    if (history.length < 20) {
      return { score: 0, currentVariance: 0 };
    }

    const recentWindow = history.slice(-20);
    const recentMean = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;
    const currentVariance = recentWindow.reduce((sum, v) => sum + Math.pow(v - recentMean, 2), 0) / recentWindow.length;

    const baselineVariance = Math.pow(baseline.std, 2);
    const varianceRatio = currentVariance / (baselineVariance + 0.001);

    // Significant increase or decrease in variance is anomalous
    const score = varianceRatio > 2 || varianceRatio < 0.5
      ? Math.min(Math.abs(Math.log(varianceRatio)) / 2, 1)
      : 0;

    return { score, currentVariance };
  }

  private combineAnomalyScores(
    scores: Array<{ score: number; weight: number }>
  ): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const { score, weight } of scores) {
      totalScore += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  private determineAnomalyType(
    zScore: { score: number; zScore: number },
    trend: { score: number; currentTrend: number },
    seasonal: { score: number; expectedSeasonal: number },
    pattern: { score: number; matchedPattern?: string },
    variance: { score: number; currentVariance: number }
  ): AnomalyType {
    // Prioritize pattern match
    if (pattern.score > 0.8 && pattern.matchedPattern) {
      return pattern.matchedPattern as AnomalyType;
    }

    // Find dominant anomaly type
    const scores = [
      { type: 'spike' as AnomalyType, score: zScore.zScore > 0 ? zScore.score : 0 },
      { type: 'dip' as AnomalyType, score: zScore.zScore < 0 ? zScore.score : 0 },
      { type: 'trend_change' as AnomalyType, score: trend.score },
      { type: 'seasonal_deviation' as AnomalyType, score: seasonal.score },
      { type: 'variance_change' as AnomalyType, score: variance.score }
    ];

    scores.sort((a, b) => b.score - a.score);
    return scores[0].type;
  }

  private calculateExpectedValue(
    kpi: KpiMeasurement,
    baseline: LearnedBaseline
  ): number {
    const date = new Date(kpi.timestamp);
    const hour = date.getHours();
    const day = date.getDay();

    // Weighted combination of baseline mean and seasonal expectations
    const hourlyExpected = baseline.hourlyProfile[hour];
    const weeklyExpected = baseline.weeklyProfile[day];

    return 0.5 * baseline.mean + 0.3 * hourlyExpected + 0.2 * weeklyExpected;
  }

  private async generateAnomalyContext(
    kpi: KpiMeasurement,
    baseline: LearnedBaseline,
    history: number[]
  ): Promise<AnomalyContext> {
    const recentTrend = history.length >= 10
      ? (history[history.length - 1] - history[history.length - 10]) / 10
      : 0;

    const hour = new Date(kpi.timestamp).getHours();
    const day = new Date(kpi.timestamp).getDay();
    const seasonalExpected = (baseline.hourlyProfile[hour] + baseline.weeklyProfile[day]) / 2;

    // Find correlated KPIs
    const correlatedKpis: Array<{ kpiName: string; correlation: number; anomalyScore: number }> = [];
    if (this.correlationMatrix) {
      const kpiIndex = this.correlationMatrix.kpiNames.indexOf(kpi.kpiName);
      if (kpiIndex >= 0) {
        for (let i = 0; i < this.correlationMatrix.kpiNames.length; i++) {
          if (i !== kpiIndex && Math.abs(this.correlationMatrix.matrix[kpiIndex][i]) > 0.7) {
            correlatedKpis.push({
              kpiName: this.correlationMatrix.kpiNames[i],
              correlation: this.correlationMatrix.matrix[kpiIndex][i],
              anomalyScore: 0 // Would need to check recent anomalies
            });
          }
        }
      }
    }

    return {
      historicalMean: baseline.mean,
      historicalStd: baseline.std,
      recentTrend,
      seasonalExpected,
      correlatedKpis: correlatedKpis.slice(0, 5)
    };
  }

  private calculateSeverity(
    score: number,
    anomalyType: AnomalyType,
    kpiName: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical KPIs have higher severity
    const criticalKpis = ['availability', 'accessibility', 'retainability', 'erab_success'];
    const isCriticalKpi = criticalKpis.some(k => kpiName.toLowerCase().includes(k));

    let baseSeverity: number;
    if (score >= 0.9) baseSeverity = 4;
    else if (score >= 0.75) baseSeverity = 3;
    else if (score >= 0.5) baseSeverity = 2;
    else baseSeverity = 1;

    // Boost for critical KPIs
    if (isCriticalKpi) {
      baseSeverity = Math.min(baseSeverity + 1, 4);
    }

    // Certain anomaly types are more severe
    if (['spike', 'dip'].includes(anomalyType) && score > 0.8) {
      baseSeverity = Math.min(baseSeverity + 1, 4);
    }

    switch (baseSeverity) {
      case 4: return 'critical';
      case 3: return 'high';
      case 2: return 'medium';
      default: return 'low';
    }
  }

  private generateSuggestedActions(
    anomalyType: AnomalyType,
    kpi: KpiMeasurement,
    score: number
  ): string[] {
    const actions: string[] = [];

    // Common actions
    actions.push(`Investigate ${kpi.kpiName} on node ${kpi.nodeId}`);

    switch (anomalyType) {
      case 'spike':
        actions.push('Check for sudden load increase or traffic spike');
        actions.push('Review recent configuration changes');
        break;
      case 'dip':
        actions.push('Check for service degradation or outage');
        actions.push('Verify hardware health');
        break;
      case 'trend_change':
        actions.push('Analyze long-term trend and identify root cause');
        actions.push('Check for gradual degradation patterns');
        break;
      case 'level_shift':
        actions.push('Review recent parameter changes');
        actions.push('Check for environmental changes');
        break;
      case 'variance_change':
        actions.push('Investigate stability issues');
        actions.push('Check for intermittent faults');
        break;
      case 'seasonal_deviation':
        actions.push('Compare with expected seasonal patterns');
        actions.push('Check for unusual traffic patterns');
        break;
    }

    if (score >= 0.9) {
      actions.push('Escalate to network operations center');
    }

    return actions;
  }

  private computeCorrelation(
    kpi1: string,
    kpi2: string,
    timeGroups: Map<string, Map<string, number>>
  ): number {
    const pairs: Array<[number, number]> = [];

    for (const group of timeGroups.values()) {
      const val1 = group.get(kpi1);
      const val2 = group.get(kpi2);
      if (val1 !== undefined && val2 !== undefined) {
        pairs.push([val1, val2]);
      }
    }

    if (pairs.length < 10) return 0;

    const mean1 = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
    const mean2 = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;

    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;

    for (const [v1, v2] of pairs) {
      numerator += (v1 - mean1) * (v2 - mean2);
      denom1 += Math.pow(v1 - mean1, 2);
      denom2 += Math.pow(v2 - mean2, 2);
    }

    const denominator = Math.sqrt(denom1) * Math.sqrt(denom2);
    return denominator !== 0 ? numerator / denominator : 0;
  }

  private createPatternEmbedding(values: number[]): Float32Array {
    const embedding = new Float32Array(50);

    // Normalize values
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // Resample to fixed size
    for (let i = 0; i < 50; i++) {
      const srcIdx = Math.floor(i * values.length / 50);
      embedding[i] = (values[srcIdx] - min) / range;
    }

    return embedding;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }
}

// Export factory function
export function createAnomalyDetector(config?: Partial<AnomalyConfig>): SelfLearningAnomalyDetector {
  return new SelfLearningAnomalyDetector(config);
}
