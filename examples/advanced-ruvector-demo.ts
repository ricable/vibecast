/**
 * Advanced Ericsson RAN Automation Platform Demo
 * Demonstrates all ruvector capabilities with self-learning vectors and GNN
 */

import {
  createAdvancedOrchestrator,
  type AdvancedRANOrchestrator
} from '../src/ruvector/advanced-ran-orchestrator.js';
import { createSelfLearningGNN } from '../src/gnn/self-learning-gnn.js';
import { createSemanticRouter } from '../src/router/semantic-intent-router.js';
import { createEmbeddingGenerator } from '../src/embeddings/ran-embedding-generator.js';
import { createNetworkTopologyGraph } from '../src/graph/network-topology-graph.js';
import { createAnomalyDetector } from '../src/vectors/self-learning-anomaly-detector.js';
import { createClusterManager } from '../src/cluster/distributed-cluster-manager.js';
import type { RanNode, KpiMeasurement, Alarm, FaultEvent } from '../src/types/ran-models.js';

// ============================================================
// Demo Data Generation
// ============================================================

function generateDemoNodes(count: number): RanNode[] {
  const nodes: RanNode[] = [];
  const nodeTypes: Array<'gNB' | 'eNB' | '5G-SA' | '4G-LTE'> = ['gNB', 'eNB', '5G-SA', '4G-LTE'];

  for (let i = 0; i < count; i++) {
    const nodeType = nodeTypes[i % nodeTypes.length];
    const cells = [];

    // Each node has 3 cells (sectors)
    for (let sector = 1; sector <= 3; sector++) {
      cells.push({
        cellId: `CELL_${i}_${sector}`,
        sectorId: `S${sector}`,
        pci: (i * 3 + sector) % 504,
        frequencyBand: nodeType.includes('5G') ? 'n78' : 'B3',
        bandwidthMhz: nodeType.includes('5G') ? 100 : 20,
        maxPowerDbm: 43,
        azimuth: (sector - 1) * 120,
        tilt: 5
      });
    }

    nodes.push({
      nodeId: `${nodeType}_${String(i).padStart(3, '0')}`,
      nodeType,
      location: {
        latitude: 59.3293 + (Math.random() - 0.5) * 0.1,
        longitude: 18.0686 + (Math.random() - 0.5) * 0.1,
        altitude: 20 + Math.random() * 50
      },
      cells,
      parameters: {
        transmitPower: 40 + Math.random() * 6,
        schedulerMode: 'proportionalFair',
        handoverMargin: 2,
        qciMapping: 'standard'
      }
    });
  }

  return nodes;
}

function generateDemoKpis(nodes: RanNode[], hoursBack: number = 24): KpiMeasurement[] {
  const kpis: KpiMeasurement[] = [];
  const kpiNames = [
    'DL_Throughput_Mbps',
    'UL_Throughput_Mbps',
    'PRB_Utilization',
    'RRC_Setup_Success_Rate',
    'ERAB_Setup_Success_Rate',
    'Handover_Success_Rate',
    'Average_RSRP',
    'Average_SINR',
    'Active_Users',
    'Data_Volume_GB'
  ];

  const now = Date.now();

  for (const node of nodes) {
    for (const cell of node.cells) {
      for (const kpiName of kpiNames) {
        // Generate hourly measurements
        for (let h = hoursBack; h >= 0; h--) {
          const timestamp = now - h * 3600000;

          // Add some variation based on time of day
          const hour = new Date(timestamp).getHours();
          const hourFactor = 0.7 + 0.6 * Math.sin((hour - 6) * Math.PI / 12);

          let baseValue: number;
          let unit: string;

          switch (kpiName) {
            case 'DL_Throughput_Mbps':
              baseValue = 150 * hourFactor + Math.random() * 50;
              unit = 'Mbps';
              break;
            case 'UL_Throughput_Mbps':
              baseValue = 50 * hourFactor + Math.random() * 20;
              unit = 'Mbps';
              break;
            case 'PRB_Utilization':
              baseValue = 40 * hourFactor + Math.random() * 20;
              unit = '%';
              break;
            case 'RRC_Setup_Success_Rate':
              baseValue = 98 + Math.random() * 2;
              unit = '%';
              break;
            case 'ERAB_Setup_Success_Rate':
              baseValue = 97 + Math.random() * 3;
              unit = '%';
              break;
            case 'Handover_Success_Rate':
              baseValue = 95 + Math.random() * 5;
              unit = '%';
              break;
            case 'Average_RSRP':
              baseValue = -85 + Math.random() * 20;
              unit = 'dBm';
              break;
            case 'Average_SINR':
              baseValue = 10 + Math.random() * 10;
              unit = 'dB';
              break;
            case 'Active_Users':
              baseValue = Math.floor(100 * hourFactor + Math.random() * 50);
              unit = 'users';
              break;
            case 'Data_Volume_GB':
              baseValue = 500 * hourFactor + Math.random() * 200;
              unit = 'GB';
              break;
            default:
              baseValue = Math.random() * 100;
              unit = 'units';
          }

          // Inject some anomalies
          if (Math.random() < 0.02) {
            baseValue *= Math.random() < 0.5 ? 0.3 : 2.0; // Spike or dip
          }

          kpis.push({
            timestamp,
            nodeId: node.nodeId,
            cellId: cell.cellId,
            kpiName,
            value: baseValue,
            unit,
            granularity: 'Hourly'
          });
        }
      }
    }
  }

  return kpis;
}

function generateDemoAlarms(nodes: RanNode[]): Alarm[] {
  const alarms: Alarm[] = [];
  const alarmTypes = [
    'High_CPU_Utilization',
    'Link_Degradation',
    'Cell_Unavailable',
    'Interference_Detected',
    'Configuration_Mismatch',
    'Temperature_Warning',
    'Capacity_Threshold_Exceeded'
  ];
  const severities: Array<'Critical' | 'Major' | 'Minor' | 'Warning'> = ['Critical', 'Major', 'Minor', 'Warning'];

  const now = Date.now();

  for (let i = 0; i < 20; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const cell = node.cells[Math.floor(Math.random() * node.cells.length)];

    alarms.push({
      alarmId: `ALM_${String(i).padStart(5, '0')}`,
      timestamp: now - Math.random() * 24 * 3600000,
      severity: severities[Math.floor(Math.random() * severities.length)],
      nodeId: node.nodeId,
      cellId: cell.cellId,
      alarmType: alarmTypes[Math.floor(Math.random() * alarmTypes.length)],
      description: `Alarm condition detected on ${node.nodeId}`,
      additionalInfo: {
        source: 'NMS',
        correlationId: `CORR_${i}`
      }
    });
  }

  return alarms;
}

function generateDemoFaults(nodes: RanNode[]): FaultEvent[] {
  const faults: FaultEvent[] = [];
  const faultTypes: FaultEvent['faultType'][] = [
    'HardwareFailure',
    'SoftwareError',
    'ConfigurationIssue',
    'CapacityExceeded',
    'InterferenceDetected',
    'BackhaulIssue'
  ];

  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const affectedCells = node.cells.slice(0, Math.floor(Math.random() * 3) + 1).map(c => c.cellId);

    const faultTime = now - Math.random() * 48 * 3600000;

    faults.push({
      eventId: `FAULT_${String(i).padStart(5, '0')}`,
      timestamp: faultTime,
      nodeId: node.nodeId,
      faultType: faultTypes[Math.floor(Math.random() * faultTypes.length)],
      affectedCells,
      metricsAtFault: {
        PRB_Utilization: 85 + Math.random() * 15,
        Active_Users: Math.floor(200 + Math.random() * 100),
        Temperature: 45 + Math.random() * 20
      },
      recoveryTimestamp: Math.random() > 0.3 ? faultTime + Math.random() * 3600000 : undefined
    });
  }

  return faults;
}

// ============================================================
// Demo Functions
// ============================================================

async function demoVectorDatabase() {
  console.log('\n' + '='.repeat(60));
  console.log('📦 DEMO: High-Performance Vector Database');
  console.log('='.repeat(60));

  const { initializeRANVectorDatabase, getRANVectorDatabase } = await import('../src/ruvector/ran-vector-database.js');

  const vectorDb = await initializeRANVectorDatabase({
    dimension: 384,
    metric: 'cosine'
  });

  console.log('✅ Vector database initialized');

  // Generate embeddings
  const embeddings = createEmbeddingGenerator();
  await embeddings.initialize();

  // Create sample KPI
  const sampleKpi: KpiMeasurement = {
    timestamp: Date.now(),
    nodeId: 'gNB_001',
    cellId: 'CELL_001_1',
    kpiName: 'DL_Throughput_Mbps',
    value: 250,
    unit: 'Mbps',
    granularity: 'Hourly'
  };

  const embedding = await embeddings.generateKpiEmbedding(sampleKpi);
  const vectorId = await vectorDb.insertKpiVector(sampleKpi, embedding.embedding);

  console.log(`✅ Inserted KPI vector: ${vectorId}`);

  // Search for similar
  const results = await vectorDb.findSimilarKpis(embedding.embedding, undefined, 5);
  console.log(`✅ Found ${results.length} similar KPIs`);

  // Show stats
  const stats = vectorDb.getStats();
  console.log('📊 Vector Database Stats:', {
    totalVectors: stats.totalVectors,
    dimensions: stats.dimensions,
    avgSearchLatency: `${stats.avgSearchLatencyMs.toFixed(2)}ms`
  });

  await vectorDb.close();
}

async function demoSelfLearningGNN() {
  console.log('\n' + '='.repeat(60));
  console.log('🧠 DEMO: Self-Learning Graph Neural Network');
  console.log('='.repeat(60));

  const gnn = createSelfLearningGNN({
    inputDimension: 384,
    hiddenDimension: 256,
    outputDimension: 128,
    numHeads: 8,
    numLayers: 4,
    enableSelfLearning: true
  });

  await gnn.initialize();
  console.log('✅ Self-Learning GNN initialized');

  // Create demo network
  const nodes = generateDemoNodes(5);
  const embeddings = createEmbeddingGenerator();
  await embeddings.initialize();

  // Generate node features
  const nodeFeatures = new Map<string, Float32Array>();
  for (const node of nodes) {
    const embedding = await embeddings.generateNodeEmbedding(node);
    nodeFeatures.set(node.nodeId, embedding.embedding);
  }

  // Build network edges
  const edges = nodes.flatMap((node, i) => {
    const nextNode = nodes[(i + 1) % nodes.length];
    return [
      {
        sourceId: node.nodeId,
        targetId: nextNode.nodeId,
        edgeType: 'neighbors' as const,
        weight: 1.0,
        bidirectional: true
      }
    ];
  });

  // Build graph
  await gnn.buildNetworkGraph(nodes, nodeFeatures, edges);
  console.log('✅ Network graph built');

  // Forward pass with attention
  const nodeIds = nodes.map(n => n.nodeId);
  const results = await gnn.forward(nodeIds, { useAttention: true });
  console.log(`✅ GNN forward pass completed for ${results.size} nodes`);

  // Discover patterns
  const kpis = generateDemoKpis(nodes.slice(0, 2), 6);
  const patterns = await gnn.discoverPatterns(kpis, [], []);
  console.log(`✅ Discovered ${patterns.length} patterns`);

  // Train
  const metrics = await gnn.train(10, 2);
  console.log(`✅ Training completed - Final loss: ${metrics[metrics.length - 1]?.loss.toFixed(4) || 'N/A'}`);

  // Export model
  const model = await gnn.exportModel();
  console.log('📊 GNN Model:', {
    layers: model.config.numLayers,
    patterns: model.patterns.length,
    trainingEpochs: model.trainingHistory.length
  });
}

async function demoSemanticRouter() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 DEMO: Semantic Intent Router');
  console.log('='.repeat(60));

  const router = createSemanticRouter({
    confidenceThreshold: 0.6,
    enableEntityExtraction: true,
    enableContextualRouting: true
  });

  await router.initialize();
  console.log('✅ Semantic Router initialized');
  console.log(`   Registered ${router.getIntents().length} intents`);

  // Test queries
  const testQueries = [
    'Show me the current throughput for gNB-001',
    'What alarms are active on this node?',
    'Why is the PRB utilization so high?',
    'Optimize coverage for cell sector 3',
    'Generate daily performance report',
    'What is causing high latency?',
    'Set max power to 43 dBm',
    'Predict capacity needs for next month'
  ];

  console.log('\n📝 Testing queries:\n');

  for (const query of testQueries) {
    const result = await router.route(query, 'demo-session');
    console.log(`Query: "${query}"`);
    console.log(`  → Intent: ${result.intent} (confidence: ${result.confidence.toFixed(2)})`);
    if (result.entities.length > 0) {
      console.log(`  → Entities: ${result.entities.map(e => `${e.type}:${e.value}`).join(', ')}`);
    }
    console.log();
  }

  // Show stats
  const stats = router.getStats();
  console.log('📊 Router Stats:', {
    totalIntents: stats.totalIntents,
    categories: Object.keys(stats.categoryCounts).length,
    activeSessions: stats.contextSessions
  });
}

async function demoAnomalyDetection() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 DEMO: Self-Learning Anomaly Detection');
  console.log('='.repeat(60));

  const detector = createAnomalyDetector({
    windowSize: 100,
    zScoreThreshold: 3.0,
    enableOnlineLearning: true,
    confidenceThreshold: 0.6
  });

  await detector.initialize();
  console.log('✅ Anomaly Detector initialized');

  // Generate demo data
  const nodes = generateDemoNodes(3);
  const kpis = generateDemoKpis(nodes, 48);

  console.log(`\n📊 Processing ${kpis.length} KPI measurements...`);

  // Learn baselines
  await detector.learnBaseline(kpis, { windowDays: 7, minSamples: 50 });
  console.log('✅ Baselines learned');

  // Learn correlations
  await detector.learnCorrelations(kpis);
  console.log('✅ Correlations learned');

  // Detect anomalies
  const anomalies = await detector.detectAnomalies(kpis.slice(-100));
  console.log(`\n🚨 Detected ${anomalies.length} anomalies`);

  if (anomalies.length > 0) {
    console.log('\nTop anomalies:');
    for (const anomaly of anomalies.slice(0, 5)) {
      console.log(`  - ${anomaly.kpiName} on ${anomaly.nodeId}`);
      console.log(`    Type: ${anomaly.anomalyType}, Score: ${anomaly.anomalyScore.toFixed(2)}, Severity: ${anomaly.severity}`);
      console.log(`    Value: ${anomaly.value.toFixed(2)}, Expected: ${anomaly.expectedValue.toFixed(2)}`);
    }
  }

  // Show metrics
  const metrics = detector.getMetrics();
  console.log('\n📊 Detection Metrics:', {
    totalDetections: metrics.totalDetections,
    avgLatency: `${metrics.avgDetectionLatency.toFixed(2)}ms`
  });
}

async function demoNetworkTopology() {
  console.log('\n' + '='.repeat(60));
  console.log('🌐 DEMO: Graph-Based Network Topology');
  console.log('='.repeat(60));

  const topology = createNetworkTopologyGraph({
    enableHypergraph: true,
    enableSpatialIndex: true
  });

  await topology.initialize();
  console.log('✅ Network Topology Graph initialized');

  // Generate demo data
  const nodes = generateDemoNodes(5);
  const alarms = generateDemoAlarms(nodes);
  const faults = generateDemoFaults(nodes);

  // Add nodes
  for (const node of nodes) {
    await topology.addRanNode(node);
  }
  console.log(`✅ Added ${nodes.length} RAN nodes with cells`);

  // Add neighbor relations
  for (let i = 0; i < nodes.length; i++) {
    const node1 = nodes[i];
    const node2 = nodes[(i + 1) % nodes.length];

    for (const cell1 of node1.cells) {
      for (const cell2 of node2.cells) {
        await topology.addNeighborRelation(cell1.cellId, cell2.cellId, {
          distance: 1 + Math.random() * 2
        });
      }
    }
  }
  console.log('✅ Added neighbor relations');

  // Add alarms
  for (const alarm of alarms.slice(0, 5)) {
    await topology.addAlarm(alarm);
  }
  console.log(`✅ Added ${Math.min(5, alarms.length)} alarms`);

  // Impact analysis
  const targetNode = nodes[0].nodeId;
  const impact = await topology.analyzeImpact(targetNode);
  console.log(`\n📊 Impact Analysis for ${targetNode}:`);
  console.log(`   Affected nodes: ${impact.affectedNodes.length}`);
  console.log(`   Affected cells: ${impact.affectedCells.length}`);
  console.log(`   Impact score: ${impact.impactScore.toFixed(2)}`);

  // Get stats
  const stats = await topology.getStats();
  console.log('\n📊 Graph Stats:', {
    nodeCount: stats.nodeCount,
    edgeCount: stats.edgeCount
  });

  await topology.close();
}

async function demoDistributedCluster() {
  console.log('\n' + '='.repeat(60));
  console.log('☁️  DEMO: Distributed Cluster Operations');
  console.log('='.repeat(60));

  const cluster = createClusterManager({
    nodeId: 'demo-node-1',
    port: 8080,
    grpcPort: 50051,
    replicationFactor: 3
  });

  await cluster.initialize();
  console.log('✅ Cluster Manager initialized');

  // Get cluster status
  const status = cluster.getClusterStatus();
  console.log(`✅ Cluster ID: ${status?.clusterId}`);
  console.log(`   Current nodes: ${cluster.getNodes().length}`);

  // Check if leader
  console.log(`   Is leader: ${cluster.isClusterLeader()}`);

  // Distributed insert
  const testVector = new Float32Array(384).fill(0.1);
  const insertOp = await cluster.distributedInsert('test-vector-1', testVector, { type: 'test' });
  console.log(`\n✅ Distributed insert: ${insertOp.status}`);
  console.log(`   Target nodes: ${insertOp.targetNodes.length}`);

  // Distributed search
  const searchResult = await cluster.distributedSearch({
    vector: testVector,
    topK: 5
  });
  console.log(`\n✅ Distributed search completed`);
  console.log(`   Searched nodes: ${searchResult.searchedNodes.length}`);
  console.log(`   Results: ${searchResult.results.length}`);
  console.log(`   Duration: ${searchResult.totalDuration.toFixed(2)}ms`);

  // Health check
  const health = cluster.getHealth();
  console.log('\n📊 Cluster Health:', {
    status: health.status,
    activeNodes: health.activeNodes,
    replicationHealth: `${(health.replicationHealth * 100).toFixed(0)}%`
  });

  await cluster.close();
}

async function demoFullOrchestrator() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 DEMO: Full Advanced RAN Orchestrator');
  console.log('='.repeat(60));

  const orchestrator = createAdvancedOrchestrator({
    enableDistributed: false,
    enableAutoLearning: false,
    autoOptimize: false
  });

  await orchestrator.initialize();
  console.log('✅ Advanced RAN Orchestrator initialized');

  // Generate demo data
  const nodes = generateDemoNodes(10);
  const kpis = generateDemoKpis(nodes, 24);
  const alarms = generateDemoAlarms(nodes);
  const faults = generateDemoFaults(nodes);

  console.log('\n📥 Ingesting network data...');
  const ingestResult = await orchestrator.ingestNetworkData({
    nodes,
    kpis: kpis.slice(0, 500), // Limit for demo
    alarms,
    faults
  });

  console.log(`   Vectors created: ${ingestResult.vectorsCreated}`);
  console.log(`   Graph nodes created: ${ingestResult.graphNodesCreated}`);
  console.log(`   Anomalies detected: ${ingestResult.anomaliesDetected}`);

  // Process natural language query
  console.log('\n💬 Processing natural language queries...');
  const queryResult = await orchestrator.processQuery(
    'Show me the current throughput for gNB_001',
    { sessionId: 'demo-session' }
  );
  console.log(`   Intent: ${queryResult.routing.intent}`);
  console.log(`   Confidence: ${queryResult.routing.confidence.toFixed(2)}`);

  // Trigger learning
  console.log('\n🧠 Triggering learning cycle...');
  const learnResult = await orchestrator.triggerLearning();
  console.log(`   Patterns learned: ${learnResult.patternsLearned}`);
  console.log(`   Duration: ${learnResult.duration.toFixed(2)}ms`);

  // Get anomaly summary
  console.log('\n🔍 Getting anomaly summary...');
  const anomalySummary = await orchestrator.getAnomalySummary({ timeRangeHours: 24 });
  console.log(`   Total anomalies: ${anomalySummary.totalAnomalies}`);
  console.log(`   By severity:`, anomalySummary.bySeverity);

  // Generate insight report
  console.log('\n📊 Generating insight report...');
  const report = await orchestrator.generateInsightReport();
  console.log(`   Network health score: ${report.networkHealth.score}`);
  console.log(`   Issues: ${report.networkHealth.issues.length}`);
  console.log(`   Recommendations: ${report.networkHealth.recommendations.length}`);
  console.log(`   Predicted issues: ${report.predictedIssues.length}`);
  console.log(`   Optimization opportunities: ${report.optimizationOpportunities.length}`);

  // Get orchestrator state
  const state = orchestrator.getState();
  console.log('\n📊 Orchestrator State:', {
    nodes: state.nodeCount,
    cells: state.cellCount,
    vectors: state.vectorCount,
    patterns: state.patternCount
  });

  // Get comprehensive stats
  const stats = orchestrator.getStats();
  console.log('\n📊 Component Stats:', {
    vectorDb: `${stats.vector.totalVectors} vectors`,
    anomalyDetections: stats.anomaly.totalDetections,
    routerIntents: stats.router.totalIntents,
    avgQueryLatency: `${stats.queryStats.avgLatencyMs.toFixed(2)}ms`
  });

  await orchestrator.shutdown();
  console.log('\n✅ Orchestrator shutdown complete');
}

// ============================================================
// Main Demo Runner
// ============================================================

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🌟 ADVANCED ERICSSON RAN AUTOMATION PLATFORM');
  console.log('  Using npx ruvector with all capabilities');
  console.log('  Self-Learning Vectors + Graph Neural Networks');
  console.log('═'.repeat(60));

  const demos = [
    { name: 'Vector Database', fn: demoVectorDatabase },
    { name: 'Self-Learning GNN', fn: demoSelfLearningGNN },
    { name: 'Semantic Router', fn: demoSemanticRouter },
    { name: 'Anomaly Detection', fn: demoAnomalyDetection },
    { name: 'Network Topology', fn: demoNetworkTopology },
    { name: 'Distributed Cluster', fn: demoDistributedCluster },
    { name: 'Full Orchestrator', fn: demoFullOrchestrator }
  ];

  for (const demo of demos) {
    try {
      await demo.fn();
    } catch (error) {
      console.error(`\n❌ Error in ${demo.name} demo:`, error);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ ALL DEMOS COMPLETED');
  console.log('═'.repeat(60));
  console.log('\nCapabilities demonstrated:');
  console.log('  • High-performance vector database with HNSW indexing');
  console.log('  • Self-learning GNN with attention mechanisms');
  console.log('  • Semantic intent routing for natural language');
  console.log('  • Advanced multi-strategy embedding generation');
  console.log('  • Graph-based network topology with Cypher queries');
  console.log('  • Self-learning anomaly detection');
  console.log('  • Distributed cluster operations');
  console.log('  • Comprehensive RAN automation orchestration');
  console.log();
}

// Run the demo
main().catch(console.error);
