/**
 * Advanced Ericsson RAN Vector Database Manager
 * Uses @ruvector/core for high-performance vector operations with HNSW and SIMD
 */

import { RuVector, type SearchResult, type VectorMetadata } from '@ruvector/core';
import { logger } from '../core/logger.js';
import type {
  KpiMeasurement,
  Alarm,
  RanNode,
  Cell,
  FaultEvent,
  PredictionResult
} from '../types/ran-models.js';

export interface RANVectorConfig {
  dimension: number;
  metric: 'cosine' | 'euclidean' | 'dot';
  efConstruction: number;
  efSearch: number;
  maxElements: number;
  persistPath?: string;
}

export interface RANEmbedding {
  id: string;
  vector: Float32Array;
  metadata: RANMetadata;
  timestamp: number;
}

export interface RANMetadata extends VectorMetadata {
  entityType: 'kpi' | 'alarm' | 'node' | 'cell' | 'fault' | 'pattern' | 'anomaly';
  nodeId?: string;
  cellId?: string;
  kpiName?: string;
  alarmType?: string;
  severity?: string;
  clusterId?: string;
  learnedWeight?: number;
  accessFrequency?: number;
}

export interface SimilaritySearchResult {
  id: string;
  score: number;
  metadata: RANMetadata;
  vector?: Float32Array;
}

export interface VectorStats {
  totalVectors: number;
  dimensions: number;
  indexSize: number;
  memoryUsageMb: number;
  avgSearchLatencyMs: number;
  entityTypeCounts: Record<string, number>;
}

/**
 * High-performance vector database for Ericsson RAN data
 * Features:
 * - HNSW indexing with SIMD acceleration
 * - Multi-collection support for different entity types
 * - Adaptive compression based on access patterns
 * - Real-time similarity search
 */
export class RANVectorDatabase {
  private vectorDb: RuVector | null = null;
  private config: RANVectorConfig;
  private isInitialized = false;
  private searchLatencies: number[] = [];
  private entityCounts: Map<string, number> = new Map();
  private accessTracker: Map<string, number> = new Map();

  // Collection names for different RAN entity types
  private readonly COLLECTIONS = {
    KPI: 'ran_kpi_vectors',
    ALARM: 'ran_alarm_vectors',
    NODE: 'ran_node_vectors',
    CELL: 'ran_cell_vectors',
    FAULT: 'ran_fault_vectors',
    PATTERN: 'ran_pattern_vectors',
    ANOMALY: 'ran_anomaly_vectors',
    LEARNED: 'ran_learned_vectors'
  } as const;

  constructor(config: Partial<RANVectorConfig> = {}) {
    this.config = {
      dimension: 384, // Default for all-minilm-l6-v2
      metric: 'cosine',
      efConstruction: 200,
      efSearch: 100,
      maxElements: 1000000,
      ...config
    };
  }

  /**
   * Initialize the vector database with optimized settings
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing RAN Vector Database', {
        config: this.config
      });

      this.vectorDb = new RuVector({
        dimension: this.config.dimension,
        metric: this.config.metric,
        efConstruction: this.config.efConstruction,
        maxElements: this.config.maxElements
      });

      // Initialize entity counts
      Object.values(this.COLLECTIONS).forEach(collection => {
        this.entityCounts.set(collection, 0);
      });

      this.isInitialized = true;
      logger.info('RAN Vector Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RAN Vector Database', { error });
      throw error;
    }
  }

  /**
   * Insert a KPI measurement as a vector embedding
   */
  async insertKpiVector(
    kpi: KpiMeasurement,
    embedding: Float32Array | number[]
  ): Promise<string> {
    this.ensureInitialized();

    const id = `kpi_${kpi.nodeId}_${kpi.kpiName}_${kpi.timestamp}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'kpi',
      nodeId: kpi.nodeId,
      cellId: kpi.cellId,
      kpiName: kpi.kpiName,
      value: kpi.value,
      unit: kpi.unit,
      granularity: kpi.granularity
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('kpi');

    return id;
  }

  /**
   * Insert an alarm as a vector embedding
   */
  async insertAlarmVector(
    alarm: Alarm,
    embedding: Float32Array | number[]
  ): Promise<string> {
    this.ensureInitialized();

    const id = `alarm_${alarm.alarmId}_${alarm.timestamp}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'alarm',
      nodeId: alarm.nodeId,
      cellId: alarm.cellId,
      alarmType: alarm.alarmType,
      severity: alarm.severity,
      description: alarm.description
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('alarm');

    return id;
  }

  /**
   * Insert a RAN node configuration as a vector embedding
   */
  async insertNodeVector(
    node: RanNode,
    embedding: Float32Array | number[]
  ): Promise<string> {
    this.ensureInitialized();

    const id = `node_${node.nodeId}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'node',
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      cellCount: node.cells.length,
      location: node.location
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('node');

    return id;
  }

  /**
   * Insert a fault event as a vector embedding
   */
  async insertFaultVector(
    fault: FaultEvent,
    embedding: Float32Array | number[]
  ): Promise<string> {
    this.ensureInitialized();

    const id = `fault_${fault.eventId}_${fault.timestamp}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'fault',
      nodeId: fault.nodeId,
      faultType: fault.faultType,
      affectedCells: fault.affectedCells,
      metricsAtFault: fault.metricsAtFault
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('fault');

    return id;
  }

  /**
   * Insert a learned pattern from self-learning system
   */
  async insertLearnedPattern(
    patternId: string,
    embedding: Float32Array | number[],
    patternMetadata: {
      patternType: string;
      confidence: number;
      sourceNodes: string[];
      learnedAt: number;
      trainingIterations: number;
    }
  ): Promise<string> {
    this.ensureInitialized();

    const id = `learned_${patternId}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'pattern',
      ...patternMetadata,
      learnedWeight: patternMetadata.confidence
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('pattern');

    return id;
  }

  /**
   * Insert an anomaly detection result
   */
  async insertAnomalyVector(
    anomalyId: string,
    embedding: Float32Array | number[],
    prediction: PredictionResult,
    context: { nodeId: string; cellId?: string; kpiName: string }
  ): Promise<string> {
    this.ensureInitialized();

    const id = `anomaly_${anomalyId}_${prediction.timestamp}`;
    const vector = this.normalizeVector(embedding);

    const metadata: RANMetadata = {
      entityType: 'anomaly',
      nodeId: context.nodeId,
      cellId: context.cellId,
      kpiName: context.kpiName,
      anomalyScore: prediction.anomalyScore,
      predictedValue: prediction.predictedValue,
      confidenceInterval: prediction.confidenceInterval,
      featureImportance: prediction.featureImportance
    };

    await this.insertVector(id, vector, metadata);
    this.incrementEntityCount('anomaly');

    return id;
  }

  /**
   * Core vector insertion method
   */
  private async insertVector(
    id: string,
    vector: Float32Array,
    metadata: RANMetadata
  ): Promise<void> {
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    await this.vectorDb.insert(id, vector, metadata);
    logger.debug('Vector inserted', { id, entityType: metadata.entityType });
  }

  /**
   * Search for similar vectors with advanced filtering
   */
  async searchSimilar(
    queryVector: Float32Array | number[],
    options: {
      topK?: number;
      entityType?: RANMetadata['entityType'];
      nodeId?: string;
      cellId?: string;
      minScore?: number;
      includeVectors?: boolean;
    } = {}
  ): Promise<SimilaritySearchResult[]> {
    this.ensureInitialized();
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    const startTime = performance.now();
    const {
      topK = 10,
      entityType,
      nodeId,
      cellId,
      minScore = 0.0,
      includeVectors = false
    } = options;

    const normalizedQuery = this.normalizeVector(queryVector);

    // Build filter function
    const filter = (meta: RANMetadata): boolean => {
      if (entityType && meta.entityType !== entityType) return false;
      if (nodeId && meta.nodeId !== nodeId) return false;
      if (cellId && meta.cellId !== cellId) return false;
      return true;
    };

    const results = await this.vectorDb.search(normalizedQuery, topK * 2, {
      filter,
      efSearch: this.config.efSearch
    });

    // Track search latency
    const latency = performance.now() - startTime;
    this.searchLatencies.push(latency);
    if (this.searchLatencies.length > 1000) {
      this.searchLatencies.shift();
    }

    // Filter by minimum score and track access
    const filteredResults = results
      .filter((r: SearchResult) => r.score >= minScore)
      .slice(0, topK)
      .map((r: SearchResult) => {
        this.trackAccess(r.id);
        return {
          id: r.id,
          score: r.score,
          metadata: r.metadata as RANMetadata,
          vector: includeVectors ? r.vector : undefined
        };
      });

    logger.debug('Vector search completed', {
      topK,
      resultsCount: filteredResults.length,
      latencyMs: latency.toFixed(2)
    });

    return filteredResults;
  }

  /**
   * Find similar KPIs based on pattern
   */
  async findSimilarKpis(
    queryVector: Float32Array | number[],
    nodeId?: string,
    topK: number = 10
  ): Promise<SimilaritySearchResult[]> {
    return this.searchSimilar(queryVector, {
      topK,
      entityType: 'kpi',
      nodeId,
      minScore: 0.7
    });
  }

  /**
   * Find similar alarms for correlation
   */
  async findSimilarAlarms(
    queryVector: Float32Array | number[],
    topK: number = 10
  ): Promise<SimilaritySearchResult[]> {
    return this.searchSimilar(queryVector, {
      topK,
      entityType: 'alarm',
      minScore: 0.6
    });
  }

  /**
   * Find similar faults for root cause analysis
   */
  async findSimilarFaults(
    queryVector: Float32Array | number[],
    topK: number = 10
  ): Promise<SimilaritySearchResult[]> {
    return this.searchSimilar(queryVector, {
      topK,
      entityType: 'fault',
      minScore: 0.5
    });
  }

  /**
   * Find learned patterns for prediction
   */
  async findLearnedPatterns(
    queryVector: Float32Array | number[],
    topK: number = 5
  ): Promise<SimilaritySearchResult[]> {
    return this.searchSimilar(queryVector, {
      topK,
      entityType: 'pattern',
      minScore: 0.8
    });
  }

  /**
   * Batch insert vectors with optimized performance
   */
  async batchInsert(
    vectors: Array<{
      id: string;
      vector: Float32Array | number[];
      metadata: RANMetadata;
    }>
  ): Promise<number> {
    this.ensureInitialized();
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    const startTime = performance.now();
    let insertedCount = 0;

    // Process in batches of 1000
    const batchSize = 1000;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ id, vector, metadata }) => {
          const normalizedVector = this.normalizeVector(vector);
          await this.vectorDb!.insert(id, normalizedVector, metadata);
          this.incrementEntityCount(metadata.entityType);
          insertedCount++;
        })
      );
    }

    const duration = performance.now() - startTime;
    logger.info('Batch insert completed', {
      count: insertedCount,
      durationMs: duration.toFixed(2),
      vectorsPerSecond: (insertedCount / (duration / 1000)).toFixed(2)
    });

    return insertedCount;
  }

  /**
   * Delete a vector by ID
   */
  async deleteVector(id: string): Promise<boolean> {
    this.ensureInitialized();
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    try {
      await this.vectorDb.delete(id);
      this.accessTracker.delete(id);
      logger.debug('Vector deleted', { id });
      return true;
    } catch (error) {
      logger.warn('Failed to delete vector', { id, error });
      return false;
    }
  }

  /**
   * Get database statistics
   */
  getStats(): VectorStats {
    const avgLatency = this.searchLatencies.length > 0
      ? this.searchLatencies.reduce((a, b) => a + b, 0) / this.searchLatencies.length
      : 0;

    const totalVectors = Array.from(this.entityCounts.values()).reduce((a, b) => a + b, 0);

    const entityTypeCounts: Record<string, number> = {};
    this.entityCounts.forEach((count, type) => {
      entityTypeCounts[type] = count;
    });

    return {
      totalVectors,
      dimensions: this.config.dimension,
      indexSize: totalVectors * this.config.dimension * 4, // bytes
      memoryUsageMb: (totalVectors * this.config.dimension * 4) / (1024 * 1024),
      avgSearchLatencyMs: avgLatency,
      entityTypeCounts
    };
  }

  /**
   * Get access frequency for adaptive compression
   */
  getAccessFrequency(id: string): number {
    return this.accessTracker.get(id) || 0;
  }

  /**
   * Get vectors that are candidates for compression based on access patterns
   */
  getCompressionCandidates(accessThreshold: number = 10): string[] {
    const candidates: string[] = [];
    this.accessTracker.forEach((count, id) => {
      if (count < accessThreshold) {
        candidates.push(id);
      }
    });
    return candidates;
  }

  /**
   * Export database to file
   */
  async export(filePath: string): Promise<void> {
    this.ensureInitialized();
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    await this.vectorDb.export(filePath);
    logger.info('Database exported', { filePath });
  }

  /**
   * Import database from file
   */
  async import(filePath: string): Promise<void> {
    this.ensureInitialized();
    if (!this.vectorDb) throw new Error('Vector database not initialized');

    await this.vectorDb.import(filePath);
    logger.info('Database imported', { filePath });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.vectorDb) {
      await this.vectorDb.close();
      this.isInitialized = false;
      logger.info('RAN Vector Database closed');
    }
  }

  // Private helpers

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('RAN Vector Database not initialized. Call initialize() first.');
    }
  }

  private normalizeVector(vector: Float32Array | number[]): Float32Array {
    const floatVector = vector instanceof Float32Array
      ? vector
      : new Float32Array(vector);

    // L2 normalization for cosine similarity
    if (this.config.metric === 'cosine') {
      const norm = Math.sqrt(
        floatVector.reduce((sum, val) => sum + val * val, 0)
      );
      if (norm > 0) {
        for (let i = 0; i < floatVector.length; i++) {
          floatVector[i] /= norm;
        }
      }
    }

    return floatVector;
  }

  private incrementEntityCount(entityType: string): void {
    const current = this.entityCounts.get(entityType) || 0;
    this.entityCounts.set(entityType, current + 1);
  }

  private trackAccess(id: string): void {
    const current = this.accessTracker.get(id) || 0;
    this.accessTracker.set(id, current + 1);
  }
}

// Singleton instance for global access
let globalInstance: RANVectorDatabase | null = null;

export function getRANVectorDatabase(config?: Partial<RANVectorConfig>): RANVectorDatabase {
  if (!globalInstance) {
    globalInstance = new RANVectorDatabase(config);
  }
  return globalInstance;
}

export async function initializeRANVectorDatabase(
  config?: Partial<RANVectorConfig>
): Promise<RANVectorDatabase> {
  const db = getRANVectorDatabase(config);
  await db.initialize();
  return db;
}
