// Main entry point for Ericsson RAN Advanced Automation Platform
// Integrates ruvector, GNN, semantic routing, and distributed vector operations

import { MultiAgentOrchestrator } from './orchestrator/multi-agent-orchestrator.js';
import { DataAggregationService } from './services/data-aggregation.js';
import { TimeSeriesAnalysisSkill } from './skills/timeseries-analysis-skill.js';
import { config } from './core/config.js';
import { logger } from './core/logger.js';

// Advanced RuVector Components
import { AdvancedRANOrchestrator, createAdvancedOrchestrator } from './ruvector/advanced-ran-orchestrator.js';
import { RANVectorDatabase, initializeRANVectorDatabase, getRANVectorDatabase } from './ruvector/ran-vector-database.js';
import { SelfLearningRANGNN, createSelfLearningGNN } from './gnn/self-learning-gnn.js';
import { SemanticIntentRouter, createSemanticRouter } from './router/semantic-intent-router.js';
import { RANEmbeddingGenerator, createEmbeddingGenerator } from './embeddings/ran-embedding-generator.js';
import { NetworkTopologyGraph, createNetworkTopologyGraph } from './graph/network-topology-graph.js';
import { SelfLearningAnomalyDetector, createAnomalyDetector } from './vectors/self-learning-anomaly-detector.js';
import { DistributedClusterManager, createClusterManager } from './cluster/distributed-cluster-manager.js';
import type {
  RanNode,
  KpiMeasurement,
  Alarm,
  MultiVariatePoint,
} from './types/ran-models.js';

export class EricssonRanPlatform {
  private orchestrator: MultiAgentOrchestrator;
  private aggregationService: DataAggregationService;
  private tsAnalysisSkill: TimeSeriesAnalysisSkill;

  constructor() {
    logger.info('Initializing Ericsson RAN Time Series Analysis Platform');
    this.orchestrator = new MultiAgentOrchestrator(config.maxConcurrentAgents);
    this.aggregationService = new DataAggregationService();
    this.tsAnalysisSkill = new TimeSeriesAnalysisSkill();
  }

  /**
   * Perform comprehensive RAN analysis
   */
  async analyzeNetwork(input: {
    node: RanNode;
    kpiMeasurements: KpiMeasurement[];
    alarms?: Alarm[];
    optimizationGoals?: string[];
  }) {
    logger.info('Starting comprehensive network analysis', {
      nodeId: input.node.nodeId,
      kpiCount: input.kpiMeasurements.length,
      alarmCount: input.alarms?.length || 0,
    });

    try {
      // Step 1: Aggregate data to multiple granularities
      const multivariateData = this.aggregationService.kpiMeasurementsToMultivariate(
        input.kpiMeasurements
      );

      const aggregatedData = await this.aggregationService.aggregateMultiGranularity(
        multivariateData,
        {
          granularities: config.tsGranularities as any[],
          aggregationMethods: ['mean', 'max', 'min'],
        }
      );

      logger.info('Data aggregation completed', {
        granularities: Array.from(aggregatedData.keys()),
      });

      // Step 2: Orchestrate multi-agent analysis
      const analysisResult = await this.orchestrator.orchestrate({
        taskType: 'full-analysis',
        input: {
          node: input.node,
          kpiMeasurements: input.kpiMeasurements,
          alarms: input.alarms || [],
        },
      });

      // Step 3: Run time series analysis skill on hourly data
      const hourlyData = aggregatedData.get('Hourly');
      let forecastResults = null;

      if (hourlyData && hourlyData.data.length > 0) {
        forecastResults = await this.tsAnalysisSkill.execute({
          data: hourlyData.data,
          analysisType: 'forecast',
          options: {
            forecastHorizon: config.tsPredictionHorizon,
          },
        });
      }

      return {
        success: true,
        aggregatedData: Object.fromEntries(aggregatedData),
        agentAnalysis: analysisResult,
        forecast: forecastResults,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Network analysis failed', { error });
      throw error;
    }
  }

  /**
   * Handle alarm events
   */
  async handleAlarms(alarms: Alarm[], faultEvents?: any[]) {
    logger.info('Processing alarm events', { alarmCount: alarms.length });

    const result = await this.orchestrator.orchestrate({
      taskType: 'alarm-response',
      input: { alarms, faultEvents },
    });

    return result;
  }

  /**
   * Generate optimization proposals
   */
  async optimizeNetwork(input: {
    node: RanNode;
    kpiMeasurements: KpiMeasurement[];
    optimizationGoals: string[];
  }) {
    logger.info('Generating network optimization proposals', {
      nodeId: input.node.nodeId,
    });

    const result = await this.orchestrator.orchestrate({
      taskType: 'optimization',
      input,
    });

    return result;
  }

  /**
   * Query RAN technical documentation
   */
  async queryDocumentation(query: string) {
    logger.info('Querying RAN documentation', { query });

    const result = await this.orchestrator.orchestrate({
      taskType: 'documentation-query',
      input: { query },
    });

    return result;
  }

  /**
   * Get platform status
   */
  getStatus() {
    return {
      platform: 'Ericsson RAN Time Series Analysis',
      version: '1.0.0',
      orchestrator: this.orchestrator.getStatus(),
      config: {
        model: config.claudeModel,
        maxConcurrentAgents: config.maxConcurrentAgents,
        granularities: config.tsGranularities,
        predictionHorizon: config.tsPredictionHorizon,
      },
    };
  }
}

// Export main classes and types
export {
  MultiAgentOrchestrator,
  DataAggregationService,
  TimeSeriesAnalysisSkill,
};

// Export Advanced RuVector Components
export {
  // Orchestrator
  AdvancedRANOrchestrator,
  createAdvancedOrchestrator,

  // Vector Database
  RANVectorDatabase,
  initializeRANVectorDatabase,
  getRANVectorDatabase,

  // Self-Learning GNN
  SelfLearningRANGNN,
  createSelfLearningGNN,

  // Semantic Router
  SemanticIntentRouter,
  createSemanticRouter,

  // Embedding Generator
  RANEmbeddingGenerator,
  createEmbeddingGenerator,

  // Network Topology Graph
  NetworkTopologyGraph,
  createNetworkTopologyGraph,

  // Anomaly Detector
  SelfLearningAnomalyDetector,
  createAnomalyDetector,

  // Distributed Cluster
  DistributedClusterManager,
  createClusterManager,
};

export * from './types/ran-models.js';
export * from './agents/base-agent.js';
export * from './agents/ran-docs-agent.js';
export * from './agents/alarm-fault-agent.js';
export * from './agents/kpi-analyzer-agent.js';
export * from './agents/config-management-agent.js';

// Export RuVector module types
export type * from './ruvector/ran-vector-database.js';
export type * from './gnn/self-learning-gnn.js';
export type * from './router/semantic-intent-router.js';
export type * from './embeddings/ran-embedding-generator.js';
export type * from './graph/network-topology-graph.js';
export type * from './vectors/self-learning-anomaly-detector.js';
export type * from './cluster/distributed-cluster-manager.js';
export type * from './ruvector/advanced-ran-orchestrator.js';

export default EricssonRanPlatform;
