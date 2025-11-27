/**
 * Semantic Intent Router for Ericsson RAN Automation
 * Uses ruvector-router-core for AI-powered intent classification
 */

import { logger } from '../core/logger.js';
import type { Alarm, KpiMeasurement, FaultEvent, ParameterChangeProposal } from '../types/ran-models.js';

export interface IntentDefinition {
  name: string;
  description: string;
  examples: string[];
  priority: number;
  category: IntentCategory;
  requiredPermissions: string[];
  handler?: (context: IntentContext) => Promise<IntentResult>;
}

export type IntentCategory =
  | 'monitoring'
  | 'optimization'
  | 'troubleshooting'
  | 'configuration'
  | 'reporting'
  | 'automation'
  | 'analysis'
  | 'planning';

export interface IntentContext {
  originalQuery: string;
  intent: string;
  confidence: number;
  entities: ExtractedEntity[];
  sessionId: string;
  userId?: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  span: [number, number];
  normalized?: string;
}

export type EntityType =
  | 'node_id'
  | 'cell_id'
  | 'kpi_name'
  | 'alarm_type'
  | 'time_range'
  | 'threshold'
  | 'region'
  | 'parameter'
  | 'frequency_band'
  | 'technology';

export interface IntentResult {
  success: boolean;
  intent: string;
  response: string;
  data?: unknown;
  suggestedActions?: SuggestedAction[];
  followUpIntents?: string[];
}

export interface SuggestedAction {
  actionId: string;
  description: string;
  command: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}

export interface RoutingResult {
  intent: string;
  confidence: number;
  alternativeIntents: Array<{ intent: string; confidence: number }>;
  entities: ExtractedEntity[];
  processingTimeMs: number;
}

export interface RouterConfig {
  embeddingDimension: number;
  confidenceThreshold: number;
  maxAlternatives: number;
  enableEntityExtraction: boolean;
  enableContextualRouting: boolean;
  fallbackIntent: string;
}

/**
 * Semantic Intent Router for RAN Operations
 * Features:
 * - AI-powered intent classification
 * - Named entity extraction
 * - Multi-intent support
 * - Contextual routing based on conversation history
 * - Custom intent handlers
 */
export class SemanticIntentRouter {
  private config: RouterConfig;
  private intents: Map<string, IntentDefinition> = new Map();
  private intentEmbeddings: Map<string, Float32Array> = new Map();
  private entityPatterns: Map<EntityType, RegExp[]> = new Map();
  private conversationContext: Map<string, IntentContext[]> = new Map();
  private isInitialized = false;

  // Built-in RAN intents
  private readonly BUILTIN_INTENTS: IntentDefinition[] = [
    // Monitoring Intents
    {
      name: 'get_kpi_status',
      description: 'Get current KPI values and status for network elements',
      examples: [
        'Show me the current throughput for gNB-001',
        'What is the PRB utilization?',
        'Get KPI status for cell sector 3',
        'Check network performance metrics',
        'Display current RSRP values'
      ],
      priority: 1,
      category: 'monitoring',
      requiredPermissions: ['read:kpi']
    },
    {
      name: 'view_alarms',
      description: 'View active alarms and their details',
      examples: [
        'Show all critical alarms',
        'What alarms are active on this node?',
        'List major alarms from last hour',
        'Display alarm history',
        'Are there any network faults?'
      ],
      priority: 1,
      category: 'monitoring',
      requiredPermissions: ['read:alarm']
    },
    {
      name: 'monitor_capacity',
      description: 'Monitor network capacity and utilization',
      examples: [
        'Check network capacity',
        'Is the cell overloaded?',
        'Show capacity utilization trend',
        'Monitor traffic load',
        'What is the current user count?'
      ],
      priority: 2,
      category: 'monitoring',
      requiredPermissions: ['read:kpi']
    },

    // Troubleshooting Intents
    {
      name: 'diagnose_issue',
      description: 'Diagnose and analyze network issues',
      examples: [
        'Why is throughput degraded?',
        'Diagnose connection drops',
        'What is causing high latency?',
        'Analyze interference issue',
        'Investigate coverage gap'
      ],
      priority: 1,
      category: 'troubleshooting',
      requiredPermissions: ['read:kpi', 'read:alarm', 'read:config']
    },
    {
      name: 'root_cause_analysis',
      description: 'Perform root cause analysis for faults',
      examples: [
        'What is the root cause of this alarm?',
        'Why did the cell go down?',
        'Analyze failure pattern',
        'Find correlation between alarms',
        'Investigate recurring issue'
      ],
      priority: 1,
      category: 'troubleshooting',
      requiredPermissions: ['read:kpi', 'read:alarm', 'read:fault']
    },
    {
      name: 'check_connectivity',
      description: 'Check connectivity and backhaul status',
      examples: [
        'Check backhaul connection',
        'Is the X2 interface up?',
        'Verify transport connectivity',
        'Test network path',
        'Check fiber status'
      ],
      priority: 2,
      category: 'troubleshooting',
      requiredPermissions: ['read:config', 'execute:diagnostic']
    },

    // Optimization Intents
    {
      name: 'optimize_coverage',
      description: 'Optimize coverage and signal strength',
      examples: [
        'Optimize coverage for this cell',
        'Improve signal strength',
        'Adjust antenna tilt',
        'Fix coverage hole',
        'Enhance border cell coverage'
      ],
      priority: 2,
      category: 'optimization',
      requiredPermissions: ['read:kpi', 'write:config']
    },
    {
      name: 'optimize_capacity',
      description: 'Optimize network capacity and load balancing',
      examples: [
        'Balance load between cells',
        'Optimize capacity allocation',
        'Reduce congestion',
        'Improve spectrum efficiency',
        'Enable carrier aggregation'
      ],
      priority: 2,
      category: 'optimization',
      requiredPermissions: ['read:kpi', 'write:config']
    },
    {
      name: 'optimize_power',
      description: 'Optimize power settings and energy efficiency',
      examples: [
        'Reduce power consumption',
        'Enable energy saving',
        'Optimize transmit power',
        'Configure sleep mode',
        'Adjust power settings'
      ],
      priority: 3,
      category: 'optimization',
      requiredPermissions: ['write:config']
    },
    {
      name: 'optimize_handover',
      description: 'Optimize handover parameters',
      examples: [
        'Reduce handover failures',
        'Optimize HO parameters',
        'Fix ping-pong handovers',
        'Adjust handover thresholds',
        'Configure inter-RAT handover'
      ],
      priority: 2,
      category: 'optimization',
      requiredPermissions: ['read:kpi', 'write:config']
    },

    // Configuration Intents
    {
      name: 'view_configuration',
      description: 'View current configuration parameters',
      examples: [
        'Show cell configuration',
        'Get parameter values',
        'Display current settings',
        'List configured neighbors',
        'Show frequency allocation'
      ],
      priority: 1,
      category: 'configuration',
      requiredPermissions: ['read:config']
    },
    {
      name: 'change_parameter',
      description: 'Change configuration parameter',
      examples: [
        'Set max power to 43 dBm',
        'Change antenna tilt to 5 degrees',
        'Update PCI value',
        'Modify handover threshold',
        'Configure new frequency'
      ],
      priority: 1,
      category: 'configuration',
      requiredPermissions: ['write:config']
    },
    {
      name: 'add_neighbor',
      description: 'Add or modify neighbor relations',
      examples: [
        'Add neighbor cell',
        'Configure X2 neighbor',
        'Update neighbor list',
        'Remove stale neighbor',
        'Optimize neighbor relations'
      ],
      priority: 2,
      category: 'configuration',
      requiredPermissions: ['write:config']
    },

    // Reporting Intents
    {
      name: 'generate_report',
      description: 'Generate performance or status reports',
      examples: [
        'Generate daily report',
        'Create KPI summary',
        'Export performance data',
        'Build alarm report',
        'Create capacity analysis'
      ],
      priority: 3,
      category: 'reporting',
      requiredPermissions: ['read:kpi', 'read:alarm']
    },
    {
      name: 'show_trends',
      description: 'Show historical trends and patterns',
      examples: [
        'Show throughput trend',
        'Display alarm trend',
        'What is the traffic pattern?',
        'Show weekly comparison',
        'Analyze historical data'
      ],
      priority: 2,
      category: 'reporting',
      requiredPermissions: ['read:kpi']
    },

    // Automation Intents
    {
      name: 'schedule_task',
      description: 'Schedule automated tasks',
      examples: [
        'Schedule maintenance window',
        'Set up automatic optimization',
        'Configure scheduled report',
        'Plan capacity upgrade',
        'Schedule parameter change'
      ],
      priority: 3,
      category: 'automation',
      requiredPermissions: ['write:config', 'execute:automation']
    },
    {
      name: 'create_rule',
      description: 'Create automation rules',
      examples: [
        'Create alarm forwarding rule',
        'Set up automatic healing',
        'Configure threshold alert',
        'Define escalation policy',
        'Create auto-scaling rule'
      ],
      priority: 2,
      category: 'automation',
      requiredPermissions: ['write:config', 'execute:automation']
    },

    // Analysis Intents
    {
      name: 'predict_capacity',
      description: 'Predict future capacity needs',
      examples: [
        'Predict capacity in 3 months',
        'When will we need expansion?',
        'Forecast traffic growth',
        'Estimate upgrade timeline',
        'Project resource needs'
      ],
      priority: 3,
      category: 'analysis',
      requiredPermissions: ['read:kpi', 'execute:ml']
    },
    {
      name: 'analyze_anomaly',
      description: 'Analyze anomalies and deviations',
      examples: [
        'Detect anomalies in KPIs',
        'Find unusual patterns',
        'Identify outliers',
        'Check for degradation',
        'Analyze deviation from baseline'
      ],
      priority: 2,
      category: 'analysis',
      requiredPermissions: ['read:kpi', 'execute:ml']
    },
    {
      name: 'compare_cells',
      description: 'Compare performance between cells or nodes',
      examples: [
        'Compare cells in cluster',
        'Benchmark against similar nodes',
        'Show performance difference',
        'Rank cells by KPI',
        'Compare before and after'
      ],
      priority: 2,
      category: 'analysis',
      requiredPermissions: ['read:kpi']
    },

    // Planning Intents
    {
      name: 'plan_expansion',
      description: 'Plan network expansion',
      examples: [
        'Plan new site location',
        'Recommend cell split',
        'Suggest coverage expansion',
        'Identify expansion areas',
        'Plan capacity upgrade'
      ],
      priority: 3,
      category: 'planning',
      requiredPermissions: ['read:kpi', 'execute:planning']
    },
    {
      name: 'simulate_change',
      description: 'Simulate configuration changes',
      examples: [
        'What if I change this parameter?',
        'Simulate tilt change',
        'Preview optimization impact',
        'Test configuration',
        'Model coverage change'
      ],
      priority: 3,
      category: 'planning',
      requiredPermissions: ['read:config', 'execute:simulation']
    }
  ];

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = {
      embeddingDimension: 384,
      confidenceThreshold: 0.6,
      maxAlternatives: 3,
      enableEntityExtraction: true,
      enableContextualRouting: true,
      fallbackIntent: 'unknown',
      ...config
    };
  }

  /**
   * Initialize the router with built-in and custom intents
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing Semantic Intent Router');

    // Register built-in intents
    for (const intent of this.BUILTIN_INTENTS) {
      await this.registerIntent(intent);
    }

    // Initialize entity patterns
    this.initializeEntityPatterns();

    this.isInitialized = true;
    logger.info('Semantic Intent Router initialized', {
      intentCount: this.intents.size
    });
  }

  /**
   * Register a new intent
   */
  async registerIntent(definition: IntentDefinition): Promise<void> {
    // Generate embedding from examples
    const embedding = await this.generateIntentEmbedding(definition.examples);

    this.intents.set(definition.name, definition);
    this.intentEmbeddings.set(definition.name, embedding);

    logger.debug('Intent registered', {
      name: definition.name,
      category: definition.category
    });
  }

  /**
   * Route a query to the best matching intent
   */
  async route(
    query: string,
    sessionId: string = 'default',
    options: { includeEntities?: boolean; useContext?: boolean } = {}
  ): Promise<RoutingResult> {
    this.ensureInitialized();

    const startTime = performance.now();
    const { includeEntities = true, useContext = true } = options;

    // Generate query embedding
    const queryEmbedding = await this.generateQueryEmbedding(query);

    // Find best matching intents
    const scores = await this.computeIntentScores(queryEmbedding);

    // Apply contextual boosting if enabled
    if (useContext && this.config.enableContextualRouting) {
      this.applyContextualBoosting(scores, sessionId);
    }

    // Sort by score
    const sortedIntents = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1]);

    const bestIntent = sortedIntents[0];
    const alternatives = sortedIntents
      .slice(1, this.config.maxAlternatives + 1)
      .filter(([_, score]) => score >= this.config.confidenceThreshold * 0.7)
      .map(([intent, confidence]) => ({ intent, confidence }));

    // Extract entities if enabled
    let entities: ExtractedEntity[] = [];
    if (includeEntities && this.config.enableEntityExtraction) {
      entities = this.extractEntities(query);
    }

    // Build result
    const result: RoutingResult = {
      intent: bestIntent[1] >= this.config.confidenceThreshold
        ? bestIntent[0]
        : this.config.fallbackIntent,
      confidence: bestIntent[1],
      alternativeIntents: alternatives,
      entities,
      processingTimeMs: performance.now() - startTime
    };

    // Update conversation context
    this.updateContext(sessionId, {
      originalQuery: query,
      intent: result.intent,
      confidence: result.confidence,
      entities,
      sessionId,
      timestamp: Date.now(),
      metadata: {}
    });

    logger.debug('Query routed', {
      query: query.substring(0, 50),
      intent: result.intent,
      confidence: result.confidence.toFixed(3)
    });

    return result;
  }

  /**
   * Execute an intent with context
   */
  async executeIntent(context: IntentContext): Promise<IntentResult> {
    const intentDef = this.intents.get(context.intent);

    if (!intentDef) {
      return {
        success: false,
        intent: context.intent,
        response: `Unknown intent: ${context.intent}`
      };
    }

    if (intentDef.handler) {
      return intentDef.handler(context);
    }

    // Default handler
    return {
      success: true,
      intent: context.intent,
      response: `Intent '${context.intent}' recognized with confidence ${context.confidence.toFixed(2)}`,
      suggestedActions: this.generateSuggestedActions(context)
    };
  }

  /**
   * Route and execute in one call
   */
  async routeAndExecute(
    query: string,
    sessionId: string = 'default'
  ): Promise<{ routing: RoutingResult; result: IntentResult }> {
    const routing = await this.route(query, sessionId);

    const context: IntentContext = {
      originalQuery: query,
      intent: routing.intent,
      confidence: routing.confidence,
      entities: routing.entities,
      sessionId,
      timestamp: Date.now(),
      metadata: {}
    };

    const result = await this.executeIntent(context);

    return { routing, result };
  }

  /**
   * Add custom intent handler
   */
  setIntentHandler(
    intentName: string,
    handler: (context: IntentContext) => Promise<IntentResult>
  ): void {
    const intent = this.intents.get(intentName);
    if (intent) {
      intent.handler = handler;
    }
  }

  /**
   * Extract entities from RAN-related data
   */
  extractEntitiesFromData(data: {
    kpis?: KpiMeasurement[];
    alarms?: Alarm[];
    faults?: FaultEvent[];
    proposals?: ParameterChangeProposal[];
  }): Map<EntityType, string[]> {
    const entities = new Map<EntityType, string[]>();

    if (data.kpis) {
      const nodeIds = [...new Set(data.kpis.map(k => k.nodeId))];
      const cellIds = [...new Set(data.kpis.filter(k => k.cellId).map(k => k.cellId!))];
      const kpiNames = [...new Set(data.kpis.map(k => k.kpiName))];

      entities.set('node_id', nodeIds);
      entities.set('cell_id', cellIds);
      entities.set('kpi_name', kpiNames);
    }

    if (data.alarms) {
      const alarmTypes = [...new Set(data.alarms.map(a => a.alarmType))];
      entities.set('alarm_type', alarmTypes);
    }

    return entities;
  }

  /**
   * Get conversation context for a session
   */
  getConversationContext(sessionId: string): IntentContext[] {
    return this.conversationContext.get(sessionId) || [];
  }

  /**
   * Clear conversation context
   */
  clearContext(sessionId: string): void {
    this.conversationContext.delete(sessionId);
  }

  /**
   * Get all registered intents
   */
  getIntents(): IntentDefinition[] {
    return Array.from(this.intents.values());
  }

  /**
   * Get intents by category
   */
  getIntentsByCategory(category: IntentCategory): IntentDefinition[] {
    return Array.from(this.intents.values())
      .filter(intent => intent.category === category);
  }

  /**
   * Get routing statistics
   */
  getStats(): {
    totalIntents: number;
    categoryCounts: Record<string, number>;
    contextSessions: number;
  } {
    const categoryCounts: Record<string, number> = {};
    for (const intent of this.intents.values()) {
      categoryCounts[intent.category] = (categoryCounts[intent.category] || 0) + 1;
    }

    return {
      totalIntents: this.intents.size,
      categoryCounts,
      contextSessions: this.conversationContext.size
    };
  }

  // Private methods

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Router not initialized. Call initialize() first.');
    }
  }

  private initializeEntityPatterns(): void {
    // Node ID patterns (e.g., gNB-001, eNB_123)
    this.entityPatterns.set('node_id', [
      /\b(gNB|eNB|enb|gnb)[_-]?\d+\b/gi,
      /\b[A-Z]{2,4}[_-]\d{3,6}\b/g
    ]);

    // Cell ID patterns
    this.entityPatterns.set('cell_id', [
      /\bcell[_-]?\d+\b/gi,
      /\bsector[_-]?\d+\b/gi,
      /\b\d{10,15}\b/g // ECGI format
    ]);

    // KPI name patterns
    this.entityPatterns.set('kpi_name', [
      /\b(throughput|PRB|RSRP|RSRQ|SINR|latency|RRC|ERAB)\b/gi,
      /\b(handover|HO|accessibility|retainability)\b/gi,
      /\b(success rate|drop rate|failure rate)\b/gi
    ]);

    // Time range patterns
    this.entityPatterns.set('time_range', [
      /\b(last|past)\s+\d+\s+(hour|day|week|month)s?\b/gi,
      /\b(today|yesterday|this week|last week)\b/gi,
      /\bfrom\s+\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}\b/gi
    ]);

    // Threshold patterns
    this.entityPatterns.set('threshold', [
      /\b\d+(\.\d+)?\s*(dBm|dB|MHz|GHz|Mbps|%)\b/gi,
      /\b(greater|less|above|below)\s+than\s+\d+\b/gi
    ]);

    // Frequency band patterns
    this.entityPatterns.set('frequency_band', [
      /\b(n\d{1,3}|band\s*\d{1,3})\b/gi,
      /\b(700|800|900|1800|2100|2600|3500)\s*MHz\b/gi,
      /\b(low|mid|high)\s*band\b/gi
    ]);

    // Technology patterns
    this.entityPatterns.set('technology', [
      /\b(5G|4G|LTE|NR|SA|NSA)\b/gi,
      /\b(MIMO|massive MIMO|beamforming)\b/gi
    ]);
  }

  private async generateIntentEmbedding(examples: string[]): Promise<Float32Array> {
    // Combine examples and generate embedding
    const combined = examples.join(' ');
    return this.generateQueryEmbedding(combined);
  }

  private async generateQueryEmbedding(query: string): Promise<Float32Array> {
    // Simple TF-IDF-like embedding for demo
    // In production, would use actual embedding model
    const embedding = new Float32Array(this.config.embeddingDimension);

    const tokens = query.toLowerCase().split(/\s+/);
    const tokenHashes = tokens.map(t => this.hashString(t));

    for (let i = 0; i < tokenHashes.length; i++) {
      const hash = tokenHashes[i];
      const positions = [
        hash % this.config.embeddingDimension,
        (hash * 31) % this.config.embeddingDimension,
        (hash * 37) % this.config.embeddingDimension
      ];

      for (const pos of positions) {
        embedding[pos] += 1.0 / (i + 1); // Position-weighted
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
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

  private async computeIntentScores(
    queryEmbedding: Float32Array
  ): Promise<Map<string, number>> {
    const scores = new Map<string, number>();

    for (const [intentName, intentEmbedding] of this.intentEmbeddings) {
      const score = this.cosineSimilarity(queryEmbedding, intentEmbedding);
      scores.set(intentName, score);
    }

    return scores;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  private applyContextualBoosting(scores: Map<string, number>, sessionId: string): void {
    const context = this.conversationContext.get(sessionId);
    if (!context || context.length === 0) return;

    const recentIntents = context.slice(-3);

    for (const [intentName, score] of scores) {
      const intent = this.intents.get(intentName);
      if (!intent) continue;

      // Boost related intents
      for (const recent of recentIntents) {
        const recentIntent = this.intents.get(recent.intent);
        if (recentIntent && recentIntent.category === intent.category) {
          scores.set(intentName, score * 1.1);
        }
      }

      // Slight penalty for exact repeat
      if (recentIntents.some(r => r.intent === intentName)) {
        scores.set(intentName, score * 0.95);
      }
    }
  }

  private extractEntities(query: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    for (const [entityType, patterns] of this.entityPatterns) {
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;

        while ((match = regex.exec(query)) !== null) {
          entities.push({
            type: entityType,
            value: match[0],
            confidence: 0.8 + Math.random() * 0.2,
            span: [match.index, match.index + match[0].length],
            normalized: this.normalizeEntity(entityType, match[0])
          });
        }
      }
    }

    // Remove duplicates based on span overlap
    return this.deduplicateEntities(entities);
  }

  private normalizeEntity(type: EntityType, value: string): string {
    switch (type) {
      case 'node_id':
        return value.toUpperCase().replace(/[_-]/g, '-');
      case 'kpi_name':
        return value.toUpperCase();
      case 'technology':
        return value.toUpperCase();
      default:
        return value;
    }
  }

  private deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
    const result: ExtractedEntity[] = [];

    for (const entity of entities) {
      const overlaps = result.some(existing =>
        (entity.span[0] >= existing.span[0] && entity.span[0] < existing.span[1]) ||
        (entity.span[1] > existing.span[0] && entity.span[1] <= existing.span[1])
      );

      if (!overlaps) {
        result.push(entity);
      }
    }

    return result.sort((a, b) => a.span[0] - b.span[0]);
  }

  private updateContext(sessionId: string, context: IntentContext): void {
    const existing = this.conversationContext.get(sessionId) || [];
    existing.push(context);

    // Keep only last 10 interactions
    if (existing.length > 10) {
      existing.shift();
    }

    this.conversationContext.set(sessionId, existing);
  }

  private generateSuggestedActions(context: IntentContext): SuggestedAction[] {
    const intent = this.intents.get(context.intent);
    if (!intent) return [];

    const actions: SuggestedAction[] = [];

    switch (intent.category) {
      case 'monitoring':
        actions.push({
          actionId: 'refresh_data',
          description: 'Refresh current data',
          command: 'refresh',
          risk: 'low',
          requiresApproval: false
        });
        break;

      case 'troubleshooting':
        actions.push({
          actionId: 'run_diagnostics',
          description: 'Run diagnostic tests',
          command: 'diagnose --full',
          risk: 'low',
          requiresApproval: false
        });
        actions.push({
          actionId: 'collect_logs',
          description: 'Collect relevant logs',
          command: 'collect-logs',
          risk: 'low',
          requiresApproval: false
        });
        break;

      case 'optimization':
        actions.push({
          actionId: 'preview_changes',
          description: 'Preview optimization changes',
          command: 'optimize --preview',
          risk: 'low',
          requiresApproval: false
        });
        actions.push({
          actionId: 'apply_optimization',
          description: 'Apply recommended optimization',
          command: 'optimize --apply',
          risk: 'medium',
          requiresApproval: true
        });
        break;

      case 'configuration':
        actions.push({
          actionId: 'backup_config',
          description: 'Backup current configuration',
          command: 'config --backup',
          risk: 'low',
          requiresApproval: false
        });
        break;
    }

    return actions;
  }
}

// Export factory function
export function createSemanticRouter(config?: Partial<RouterConfig>): SemanticIntentRouter {
  return new SemanticIntentRouter(config);
}
