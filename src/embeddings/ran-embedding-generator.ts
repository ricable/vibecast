/**
 * Advanced RAN Embedding Generator
 * Generates semantic embeddings for all RAN entities using multiple strategies
 */

import { logger } from '../core/logger.js';
import type {
  RanNode,
  Cell,
  KpiMeasurement,
  Alarm,
  FaultEvent,
  ParameterChangeProposal,
  TimeSeriesPoint,
  MultiVariatePoint
} from '../types/ran-models.js';

export interface EmbeddingConfig {
  dimension: number;
  model: 'all-minilm-l6-v2' | 'bge-small' | 'e5-small' | 'custom';
  enableCaching: boolean;
  cacheMaxSize: number;
  enableNormalization: boolean;
  enableQuantization: boolean;
  quantizationBits: 8 | 4;
}

export interface EmbeddingResult {
  id: string;
  embedding: Float32Array;
  metadata: {
    entityType: string;
    dimension: number;
    model: string;
    generatedAt: number;
    quantized: boolean;
  };
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  totalProcessed: number;
  processingTimeMs: number;
  cacheHits: number;
}

export type EmbeddingStrategy =
  | 'semantic' // Text-based semantic embedding
  | 'numerical' // Direct numerical feature encoding
  | 'temporal' // Time-series based embedding
  | 'structural' // Graph-structure based embedding
  | 'hybrid'; // Combination of strategies

/**
 * Advanced embedding generator for RAN data
 * Features:
 * - Multiple embedding strategies
 * - Caching for performance
 * - Quantization for memory efficiency
 * - Batch processing support
 */
export class RANEmbeddingGenerator {
  private config: EmbeddingConfig;
  private cache: Map<string, EmbeddingResult> = new Map();
  private cacheHits = 0;
  private isInitialized = false;

  // Feature scaling parameters (learned from data)
  private featureScalers: Map<string, { min: number; max: number; mean: number; std: number }> = new Map();

  // Vocabulary for semantic embedding
  private vocabulary: Map<string, number> = new Map();
  private vocabSize = 0;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = {
      dimension: 384,
      model: 'all-minilm-l6-v2',
      enableCaching: true,
      cacheMaxSize: 100000,
      enableNormalization: true,
      enableQuantization: false,
      quantizationBits: 8,
      ...config
    };
  }

  /**
   * Initialize the embedding generator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing RAN Embedding Generator', { config: this.config });

    // Build initial vocabulary
    this.buildVocabulary();

    // Initialize feature scalers
    this.initializeFeatureScalers();

    this.isInitialized = true;
    logger.info('RAN Embedding Generator initialized');
  }

  /**
   * Generate embedding for a RAN node
   */
  async generateNodeEmbedding(
    node: RanNode,
    strategy: EmbeddingStrategy = 'hybrid'
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const cacheKey = `node_${node.nodeId}_${strategy}`;
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }

    let embedding: Float32Array;

    switch (strategy) {
      case 'semantic':
        embedding = await this.generateSemanticNodeEmbedding(node);
        break;
      case 'numerical':
        embedding = await this.generateNumericalNodeEmbedding(node);
        break;
      case 'structural':
        embedding = await this.generateStructuralNodeEmbedding(node);
        break;
      case 'hybrid':
      default:
        embedding = await this.generateHybridNodeEmbedding(node);
        break;
    }

    if (this.config.enableNormalization) {
      embedding = this.normalizeEmbedding(embedding);
    }

    if (this.config.enableQuantization) {
      embedding = this.quantizeEmbedding(embedding);
    }

    const result: EmbeddingResult = {
      id: cacheKey,
      embedding,
      metadata: {
        entityType: 'node',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: this.config.enableQuantization
      }
    };

    this.cacheResult(cacheKey, result);
    return result;
  }

  /**
   * Generate embedding for a cell
   */
  async generateCellEmbedding(
    cell: Cell,
    parentNode?: RanNode,
    strategy: EmbeddingStrategy = 'hybrid'
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const cacheKey = `cell_${cell.cellId}_${strategy}`;
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }

    let embedding: Float32Array;

    switch (strategy) {
      case 'numerical':
        embedding = this.generateNumericalCellEmbedding(cell);
        break;
      case 'semantic':
        embedding = await this.generateSemanticCellEmbedding(cell, parentNode);
        break;
      case 'hybrid':
      default:
        embedding = await this.generateHybridCellEmbedding(cell, parentNode);
        break;
    }

    if (this.config.enableNormalization) {
      embedding = this.normalizeEmbedding(embedding);
    }

    const result: EmbeddingResult = {
      id: cacheKey,
      embedding,
      metadata: {
        entityType: 'cell',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: this.config.enableQuantization
      }
    };

    this.cacheResult(cacheKey, result);
    return result;
  }

  /**
   * Generate embedding for KPI measurement
   */
  async generateKpiEmbedding(
    kpi: KpiMeasurement,
    historicalValues?: number[]
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const cacheKey = `kpi_${kpi.nodeId}_${kpi.kpiName}_${kpi.timestamp}`;
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }

    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // 1. KPI name embedding (semantic)
    const kpiNameEmbedding = this.encodeText(kpi.kpiName, 64);
    for (let i = 0; i < 64 && idx < this.config.dimension; i++, idx++) {
      embedding[idx] = kpiNameEmbedding[i];
    }

    // 2. Current value (normalized)
    const normalizedValue = this.normalizeKpiValue(kpi.kpiName, kpi.value);
    embedding[idx++] = normalizedValue;

    // 3. Temporal features
    const date = new Date(kpi.timestamp);
    embedding[idx++] = date.getHours() / 24; // Hour of day
    embedding[idx++] = date.getDay() / 7; // Day of week
    embedding[idx++] = date.getDate() / 31; // Day of month

    // 4. Granularity encoding
    const granularityMap = { 'Hourly': 0.33, 'Daily': 0.66, 'Weekly': 1.0 };
    embedding[idx++] = granularityMap[kpi.granularity] || 0.5;

    // 5. Historical statistics if available
    if (historicalValues && historicalValues.length > 0) {
      const stats = this.computeStatistics(historicalValues);
      embedding[idx++] = stats.mean;
      embedding[idx++] = stats.std;
      embedding[idx++] = stats.min;
      embedding[idx++] = stats.max;
      embedding[idx++] = stats.trend;
      embedding[idx++] = (kpi.value - stats.mean) / (stats.std || 1); // Z-score

      // Encode recent trend
      const recentTrend = this.computeRecentTrend(historicalValues, 10);
      for (let i = 0; i < 10 && idx < this.config.dimension; i++, idx++) {
        embedding[idx] = recentTrend[i] || 0;
      }
    }

    // 6. Node/Cell ID encoding
    const nodeIdHash = this.hashString(kpi.nodeId);
    embedding[idx++] = (nodeIdHash % 1000) / 1000;

    if (kpi.cellId) {
      const cellIdHash = this.hashString(kpi.cellId);
      embedding[idx++] = (cellIdHash % 1000) / 1000;
    }

    // Fill remaining with small noise
    while (idx < this.config.dimension) {
      embedding[idx++] = Math.random() * 0.001;
    }

    const result: EmbeddingResult = {
      id: cacheKey,
      embedding: this.config.enableNormalization ? this.normalizeEmbedding(embedding) : embedding,
      metadata: {
        entityType: 'kpi',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: false
      }
    };

    this.cacheResult(cacheKey, result);
    return result;
  }

  /**
   * Generate embedding for alarm
   */
  async generateAlarmEmbedding(
    alarm: Alarm,
    relatedAlarms?: Alarm[]
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const cacheKey = `alarm_${alarm.alarmId}`;
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }

    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // 1. Alarm type embedding
    const typeEmbedding = this.encodeText(alarm.alarmType, 64);
    for (let i = 0; i < 64 && idx < this.config.dimension; i++, idx++) {
      embedding[idx] = typeEmbedding[i];
    }

    // 2. Description embedding
    const descEmbedding = this.encodeText(alarm.description, 128);
    for (let i = 0; i < 128 && idx < this.config.dimension; i++, idx++) {
      embedding[idx] = descEmbedding[i];
    }

    // 3. Severity encoding
    const severityMap = { 'Critical': 1.0, 'Major': 0.75, 'Minor': 0.5, 'Warning': 0.25, 'Cleared': 0.0 };
    embedding[idx++] = severityMap[alarm.severity] || 0.5;

    // 4. Temporal features
    const date = new Date(alarm.timestamp);
    embedding[idx++] = date.getHours() / 24;
    embedding[idx++] = date.getDay() / 7;

    // 5. Node/Cell encoding
    const nodeHash = this.hashString(alarm.nodeId);
    embedding[idx++] = (nodeHash % 1000) / 1000;

    if (alarm.cellId) {
      const cellHash = this.hashString(alarm.cellId);
      embedding[idx++] = (cellHash % 1000) / 1000;
    }

    // 6. Additional info encoding
    const additionalInfoStr = JSON.stringify(alarm.additionalInfo);
    const infoEmbedding = this.encodeText(additionalInfoStr, 32);
    for (let i = 0; i < 32 && idx < this.config.dimension; i++, idx++) {
      embedding[idx] = infoEmbedding[i];
    }

    // 7. Related alarms correlation
    if (relatedAlarms && relatedAlarms.length > 0) {
      embedding[idx++] = relatedAlarms.length / 10; // Normalized count

      // Encode severity distribution of related alarms
      const severityCounts = { Critical: 0, Major: 0, Minor: 0, Warning: 0, Cleared: 0 };
      for (const related of relatedAlarms) {
        severityCounts[related.severity]++;
      }
      const total = relatedAlarms.length;
      embedding[idx++] = severityCounts.Critical / total;
      embedding[idx++] = severityCounts.Major / total;
      embedding[idx++] = severityCounts.Minor / total;
    }

    // Fill remaining
    while (idx < this.config.dimension) {
      embedding[idx++] = Math.random() * 0.001;
    }

    const result: EmbeddingResult = {
      id: cacheKey,
      embedding: this.config.enableNormalization ? this.normalizeEmbedding(embedding) : embedding,
      metadata: {
        entityType: 'alarm',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: false
      }
    };

    this.cacheResult(cacheKey, result);
    return result;
  }

  /**
   * Generate embedding for fault event
   */
  async generateFaultEmbedding(fault: FaultEvent): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const cacheKey = `fault_${fault.eventId}`;
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }

    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // 1. Fault type encoding
    const faultTypeMap: Record<string, number> = {
      'HardwareFailure': 0.9,
      'SoftwareError': 0.7,
      'ConfigurationIssue': 0.5,
      'CapacityExceeded': 0.6,
      'InterferenceDetected': 0.4,
      'BackhaulIssue': 0.8,
      'PowerOutage': 1.0
    };
    embedding[idx++] = faultTypeMap[fault.faultType] || 0.5;

    // 2. Fault type semantic embedding
    const faultTypeEmbedding = this.encodeText(fault.faultType, 64);
    for (let i = 0; i < 64 && idx < this.config.dimension; i++, idx++) {
      embedding[idx] = faultTypeEmbedding[i];
    }

    // 3. Impact scope (affected cells)
    embedding[idx++] = Math.min(fault.affectedCells.length / 10, 1); // Normalized

    // 4. Affected cells encoding
    for (let i = 0; i < Math.min(fault.affectedCells.length, 10); i++) {
      const cellHash = this.hashString(fault.affectedCells[i]);
      embedding[idx++] = (cellHash % 1000) / 1000;
    }

    // 5. Metrics at fault encoding
    const metricNames = Object.keys(fault.metricsAtFault);
    for (const metricName of metricNames.slice(0, 20)) {
      if (idx >= this.config.dimension - 2) break;
      const metricNameHash = this.hashString(metricName);
      embedding[idx++] = (metricNameHash % 1000) / 1000;
      embedding[idx++] = this.normalizeMetricValue(fault.metricsAtFault[metricName]);
    }

    // 6. Recovery time (if available)
    if (fault.recoveryTimestamp) {
      const recoveryTime = (fault.recoveryTimestamp - fault.timestamp) / 3600000; // Hours
      embedding[idx++] = Math.min(recoveryTime / 24, 1); // Normalized to max 24 hours
    }

    // 7. Temporal features
    const date = new Date(fault.timestamp);
    embedding[idx++] = date.getHours() / 24;
    embedding[idx++] = date.getDay() / 7;

    // Fill remaining
    while (idx < this.config.dimension) {
      embedding[idx++] = Math.random() * 0.001;
    }

    const result: EmbeddingResult = {
      id: cacheKey,
      embedding: this.config.enableNormalization ? this.normalizeEmbedding(embedding) : embedding,
      metadata: {
        entityType: 'fault',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: false
      }
    };

    this.cacheResult(cacheKey, result);
    return result;
  }

  /**
   * Generate embedding for time series data
   */
  async generateTimeSeriesEmbedding(
    points: TimeSeriesPoint[],
    windowSize: number = 100
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const sortedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const windowedPoints = sortedPoints.slice(-windowSize);

    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // 1. Statistical features
    const values = windowedPoints.map(p => p.value);
    const stats = this.computeStatistics(values);

    embedding[idx++] = stats.mean;
    embedding[idx++] = stats.std;
    embedding[idx++] = stats.min;
    embedding[idx++] = stats.max;
    embedding[idx++] = stats.trend;
    embedding[idx++] = stats.skewness;
    embedding[idx++] = stats.kurtosis;

    // 2. Percentiles
    const sorted = [...values].sort((a, b) => a - b);
    const percentiles = [10, 25, 50, 75, 90];
    for (const p of percentiles) {
      const pIdx = Math.floor(sorted.length * p / 100);
      embedding[idx++] = sorted[pIdx] || 0;
    }

    // 3. FFT-based frequency features (simplified)
    const fftFeatures = this.computeSimplifiedFFT(values, 32);
    for (const feature of fftFeatures) {
      if (idx >= this.config.dimension) break;
      embedding[idx++] = feature;
    }

    // 4. Autoregressive features
    const arFeatures = this.computeARFeatures(values, 10);
    for (const feature of arFeatures) {
      if (idx >= this.config.dimension) break;
      embedding[idx++] = feature;
    }

    // 5. Resampled values (downsampled representation)
    const resampleSize = Math.min(50, this.config.dimension - idx);
    const resampled = this.resampleTimeSeries(values, resampleSize);
    for (const val of resampled) {
      if (idx >= this.config.dimension) break;
      embedding[idx++] = val;
    }

    // 6. Metadata encoding (if available)
    if (windowedPoints[0]?.metadata) {
      const metadataStr = JSON.stringify(windowedPoints[0].metadata);
      const metaEmbedding = this.encodeText(metadataStr, 32);
      for (let i = 0; i < 32 && idx < this.config.dimension; i++, idx++) {
        embedding[idx] = metaEmbedding[i];
      }
    }

    // Fill remaining
    while (idx < this.config.dimension) {
      embedding[idx++] = Math.random() * 0.001;
    }

    const id = `timeseries_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
      id,
      embedding: this.config.enableNormalization ? this.normalizeEmbedding(embedding) : embedding,
      metadata: {
        entityType: 'timeseries',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: false
      }
    };
  }

  /**
   * Generate embedding for multivariate data
   */
  async generateMultivariateEmbedding(
    points: MultiVariatePoint[],
    windowSize: number = 50
  ): Promise<EmbeddingResult> {
    this.ensureInitialized();

    const sortedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const windowedPoints = sortedPoints.slice(-windowSize);

    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // Get all feature names
    const featureNames = new Set<string>();
    for (const point of windowedPoints) {
      Object.keys(point.features).forEach(name => featureNames.add(name));
    }

    // For each feature, compute statistics
    const featureList = Array.from(featureNames).slice(0, 10); // Max 10 features
    for (const featureName of featureList) {
      const values = windowedPoints.map(p => p.features[featureName] || 0);
      const stats = this.computeStatistics(values);

      if (idx >= this.config.dimension - 5) break;

      // Feature name hash
      const nameHash = this.hashString(featureName);
      embedding[idx++] = (nameHash % 1000) / 1000;

      // Statistics
      embedding[idx++] = this.normalizeValue(stats.mean);
      embedding[idx++] = this.normalizeValue(stats.std);
      embedding[idx++] = this.normalizeValue(stats.trend);
    }

    // Cross-correlation features
    if (featureList.length >= 2) {
      for (let i = 0; i < featureList.length - 1 && idx < this.config.dimension - 1; i++) {
        for (let j = i + 1; j < featureList.length && idx < this.config.dimension; j++) {
          const vals1 = windowedPoints.map(p => p.features[featureList[i]] || 0);
          const vals2 = windowedPoints.map(p => p.features[featureList[j]] || 0);
          const corr = this.computeCorrelation(vals1, vals2);
          embedding[idx++] = corr;
        }
      }
    }

    // Label encoding
    if (windowedPoints[0]?.labels) {
      const labelStr = JSON.stringify(windowedPoints[0].labels);
      const labelEmbedding = this.encodeText(labelStr, 32);
      for (let i = 0; i < 32 && idx < this.config.dimension; i++, idx++) {
        embedding[idx] = labelEmbedding[i];
      }
    }

    // Fill remaining
    while (idx < this.config.dimension) {
      embedding[idx++] = Math.random() * 0.001;
    }

    const id = `multivariate_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
      id,
      embedding: this.config.enableNormalization ? this.normalizeEmbedding(embedding) : embedding,
      metadata: {
        entityType: 'multivariate',
        dimension: this.config.dimension,
        model: this.config.model,
        generatedAt: Date.now(),
        quantized: false
      }
    };
  }

  /**
   * Batch generate embeddings
   */
  async batchGenerateKpiEmbeddings(kpis: KpiMeasurement[]): Promise<BatchEmbeddingResult> {
    const startTime = performance.now();
    const embeddings: EmbeddingResult[] = [];
    let cacheHitsBefore = this.cacheHits;

    for (const kpi of kpis) {
      const result = await this.generateKpiEmbedding(kpi);
      embeddings.push(result);
    }

    return {
      embeddings,
      totalProcessed: kpis.length,
      processingTimeMs: performance.now() - startTime,
      cacheHits: this.cacheHits - cacheHitsBefore
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; maxSize: number } {
    return {
      size: this.cache.size,
      hits: this.cacheHits,
      maxSize: this.config.cacheMaxSize
    };
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    logger.debug('Embedding cache cleared');
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Embedding generator not initialized. Call initialize() first.');
    }
  }

  private buildVocabulary(): void {
    // Common RAN terms
    const terms = [
      'throughput', 'latency', 'rsrp', 'rsrq', 'sinr', 'prb', 'utilization',
      'handover', 'failure', 'success', 'drop', 'call', 'rrc', 'erab',
      'cell', 'sector', 'gnb', 'enb', 'antenna', 'frequency', 'bandwidth',
      'power', 'interference', 'congestion', 'capacity', 'coverage',
      'alarm', 'critical', 'major', 'minor', 'warning', 'fault',
      'configuration', 'parameter', 'threshold', 'optimization'
    ];

    terms.forEach((term, idx) => {
      this.vocabulary.set(term.toLowerCase(), idx);
    });
    this.vocabSize = terms.length;
  }

  private initializeFeatureScalers(): void {
    // Default scalers for common KPIs
    this.featureScalers.set('throughput', { min: 0, max: 1000, mean: 200, std: 150 });
    this.featureScalers.set('latency', { min: 0, max: 100, mean: 20, std: 10 });
    this.featureScalers.set('rsrp', { min: -140, max: -44, mean: -90, std: 15 });
    this.featureScalers.set('rsrq', { min: -20, max: -3, mean: -10, std: 3 });
    this.featureScalers.set('sinr', { min: -5, max: 30, mean: 12, std: 6 });
    this.featureScalers.set('prb_utilization', { min: 0, max: 100, mean: 50, std: 20 });
  }

  private async generateSemanticNodeEmbedding(node: RanNode): Promise<Float32Array> {
    const description = `${node.nodeType} node ${node.nodeId} with ${node.cells.length} cells`;
    const paramStr = Object.entries(node.parameters)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    return this.encodeText(`${description} ${paramStr}`, this.config.dimension);
  }

  private async generateNumericalNodeEmbedding(node: RanNode): Promise<Float32Array> {
    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // Node type encoding
    const typeMap: Record<string, number> = { 'gNB': 0.9, '5G-SA': 0.85, 'eNB': 0.5, '4G-LTE': 0.45 };
    embedding[idx++] = typeMap[node.nodeType] || 0.5;

    // Cell count
    embedding[idx++] = Math.min(node.cells.length / 10, 1);

    // Location if available
    if (node.location) {
      embedding[idx++] = (node.location.latitude + 90) / 180;
      embedding[idx++] = (node.location.longitude + 180) / 360;
      embedding[idx++] = (node.location.altitude || 0) / 1000;
    }

    // Parameter encoding
    const paramValues = Object.values(node.parameters);
    for (const value of paramValues) {
      if (idx >= this.config.dimension) break;
      if (typeof value === 'number') {
        embedding[idx++] = this.normalizeValue(value);
      } else if (typeof value === 'boolean') {
        embedding[idx++] = value ? 1 : 0;
      }
    }

    return embedding;
  }

  private async generateStructuralNodeEmbedding(node: RanNode): Promise<Float32Array> {
    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    // Structural features from cells
    for (const cell of node.cells) {
      if (idx >= this.config.dimension - 5) break;

      embedding[idx++] = cell.pci / 503;
      embedding[idx++] = cell.bandwidthMhz / 100;
      embedding[idx++] = cell.azimuth / 360;
      embedding[idx++] = cell.tilt / 15;
      embedding[idx++] = cell.maxPowerDbm / 50;
    }

    // Node ID hash for uniqueness
    const idHash = this.hashString(node.nodeId);
    const hashFeatures = this.expandHash(idHash, 32);
    for (const feature of hashFeatures) {
      if (idx >= this.config.dimension) break;
      embedding[idx++] = feature;
    }

    return embedding;
  }

  private async generateHybridNodeEmbedding(node: RanNode): Promise<Float32Array> {
    const semantic = await this.generateSemanticNodeEmbedding(node);
    const numerical = await this.generateNumericalNodeEmbedding(node);
    const structural = await this.generateStructuralNodeEmbedding(node);

    // Weighted combination
    const embedding = new Float32Array(this.config.dimension);
    for (let i = 0; i < this.config.dimension; i++) {
      embedding[i] = 0.4 * semantic[i] + 0.3 * numerical[i] + 0.3 * structural[i];
    }

    return embedding;
  }

  private generateNumericalCellEmbedding(cell: Cell): Float32Array {
    const embedding = new Float32Array(this.config.dimension);
    let idx = 0;

    embedding[idx++] = cell.pci / 503;
    embedding[idx++] = cell.bandwidthMhz / 100;
    embedding[idx++] = cell.maxPowerDbm / 50;
    embedding[idx++] = cell.azimuth / 360;
    embedding[idx++] = cell.tilt / 15;

    // Frequency band encoding
    const bandHash = this.hashString(cell.frequencyBand);
    embedding[idx++] = (bandHash % 1000) / 1000;

    // Sector ID encoding
    const sectorHash = this.hashString(cell.sectorId);
    embedding[idx++] = (sectorHash % 1000) / 1000;

    return embedding;
  }

  private async generateSemanticCellEmbedding(cell: Cell, parentNode?: RanNode): Promise<Float32Array> {
    const description = `Cell ${cell.cellId} sector ${cell.sectorId} PCI ${cell.pci} ` +
      `band ${cell.frequencyBand} ${cell.bandwidthMhz}MHz azimuth ${cell.azimuth}`;

    const nodeInfo = parentNode ? ` part of ${parentNode.nodeType} ${parentNode.nodeId}` : '';

    return this.encodeText(description + nodeInfo, this.config.dimension);
  }

  private async generateHybridCellEmbedding(cell: Cell, parentNode?: RanNode): Promise<Float32Array> {
    const numerical = this.generateNumericalCellEmbedding(cell);
    const semantic = await this.generateSemanticCellEmbedding(cell, parentNode);

    const embedding = new Float32Array(this.config.dimension);
    for (let i = 0; i < this.config.dimension; i++) {
      embedding[i] = 0.5 * numerical[i] + 0.5 * semantic[i];
    }

    return embedding;
  }

  private encodeText(text: string, targetDim: number): Float32Array {
    const embedding = new Float32Array(targetDim);
    const tokens = text.toLowerCase().split(/\s+/);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const vocabIdx = this.vocabulary.get(token);

      if (vocabIdx !== undefined) {
        // Known vocabulary term
        const positions = [
          vocabIdx % targetDim,
          (vocabIdx * 31) % targetDim,
          (vocabIdx * 37) % targetDim
        ];
        for (const pos of positions) {
          embedding[pos] += 1.0 / (i + 1);
        }
      } else {
        // Unknown term - use hash
        const hash = this.hashString(token);
        const positions = [
          hash % targetDim,
          (hash * 31) % targetDim
        ];
        for (const pos of positions) {
          embedding[pos] += 0.5 / (i + 1);
        }
      }
    }

    return embedding;
  }

  private normalizeEmbedding(embedding: Float32Array): Float32Array {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }
    return embedding;
  }

  private quantizeEmbedding(embedding: Float32Array): Float32Array {
    const bits = this.config.quantizationBits;
    const levels = Math.pow(2, bits);

    for (let i = 0; i < embedding.length; i++) {
      const val = embedding[i];
      const quantized = Math.round((val + 1) * (levels - 1) / 2) / ((levels - 1) / 2) - 1;
      embedding[i] = quantized;
    }

    return embedding;
  }

  private normalizeKpiValue(kpiName: string, value: number): number {
    const scaler = this.featureScalers.get(kpiName.toLowerCase());
    if (scaler) {
      return (value - scaler.min) / (scaler.max - scaler.min);
    }
    return this.normalizeValue(value);
  }

  private normalizeValue(value: number): number {
    // Simple normalization using tanh
    return Math.tanh(value / 100);
  }

  private normalizeMetricValue(value: number): number {
    return Math.tanh(value / 1000);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private expandHash(hash: number, length: number): number[] {
    const result: number[] = [];
    let current = hash;

    for (let i = 0; i < length; i++) {
      current = (current * 1103515245 + 12345) & 0x7fffffff;
      result.push((current % 1000) / 1000);
    }

    return result;
  }

  private computeStatistics(values: number[]): {
    mean: number;
    std: number;
    min: number;
    max: number;
    trend: number;
    skewness: number;
    kurtosis: number;
  } {
    if (values.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, trend: 0, skewness: 0, kurtosis: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Trend (linear regression slope)
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

    // Skewness
    let skewness = 0;
    if (std > 0) {
      skewness = values.reduce((sum, val) => sum + Math.pow((val - mean) / std, 3), 0) / values.length;
    }

    // Kurtosis
    let kurtosis = 0;
    if (std > 0) {
      kurtosis = values.reduce((sum, val) => sum + Math.pow((val - mean) / std, 4), 0) / values.length - 3;
    }

    return { mean, std, min, max, trend, skewness, kurtosis };
  }

  private computeRecentTrend(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    const window = values.slice(-windowSize);

    if (window.length < 2) return result;

    for (let i = 1; i < window.length; i++) {
      const change = (window[i] - window[i - 1]) / (Math.abs(window[i - 1]) + 1);
      result.push(Math.tanh(change));
    }

    return result;
  }

  private computeSimplifiedFFT(values: number[], numComponents: number): number[] {
    // Simplified frequency analysis
    const n = values.length;
    const components: number[] = [];

    for (let k = 0; k < numComponents && k < n / 2; k++) {
      let realSum = 0;
      let imagSum = 0;

      for (let t = 0; t < n; t++) {
        const angle = 2 * Math.PI * k * t / n;
        realSum += values[t] * Math.cos(angle);
        imagSum -= values[t] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(realSum * realSum + imagSum * imagSum) / n;
      components.push(magnitude);
    }

    return components;
  }

  private computeARFeatures(values: number[], order: number): number[] {
    const features: number[] = [];

    for (let lag = 1; lag <= order; lag++) {
      const corr = this.computeAutocorrelation(values, lag);
      features.push(corr);
    }

    return features;
  }

  private computeAutocorrelation(values: number[], lag: number): number {
    if (values.length <= lag) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < values.length - lag; i++) {
      numerator += (values[i] - mean) * (values[i + lag] - mean);
    }

    for (let i = 0; i < values.length; i++) {
      denominator += Math.pow(values[i] - mean, 2);
    }

    return denominator !== 0 ? numerator / denominator : 0;
  }

  private computeCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      denomX += diffX * diffX;
      denomY += diffY * diffY;
    }

    const denominator = Math.sqrt(denomX) * Math.sqrt(denomY);
    return denominator !== 0 ? numerator / denominator : 0;
  }

  private resampleTimeSeries(values: number[], targetSize: number): number[] {
    if (values.length === 0) return new Array(targetSize).fill(0);
    if (values.length === targetSize) return [...values];

    const result: number[] = [];
    const ratio = values.length / targetSize;

    for (let i = 0; i < targetSize; i++) {
      const srcIdx = i * ratio;
      const lower = Math.floor(srcIdx);
      const upper = Math.min(lower + 1, values.length - 1);
      const fraction = srcIdx - lower;

      result.push(values[lower] * (1 - fraction) + values[upper] * fraction);
    }

    return result;
  }

  private cacheResult(key: string, result: EmbeddingResult): void {
    if (!this.config.enableCaching) return;

    // Evict if cache is full
    if (this.cache.size >= this.config.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, result);
  }
}

// Export factory function
export function createEmbeddingGenerator(config?: Partial<EmbeddingConfig>): RANEmbeddingGenerator {
  return new RANEmbeddingGenerator(config);
}
