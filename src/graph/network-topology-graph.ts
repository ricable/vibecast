/**
 * Graph-Based Network Topology Manager
 * Uses @ruvector/graph-node for hypergraph operations with Cypher queries
 */

import { GraphNode, type CypherResult, type NodeProperties, type RelationshipSpec } from '@ruvector/graph-node';
import { logger } from '../core/logger.js';
import type { RanNode, Cell, GeoLocation, Alarm, FaultEvent } from '../types/ran-models.js';

export interface GraphConfig {
  persistPath?: string;
  enableHypergraph: boolean;
  maxNodeCount: number;
  enableSpatialIndex: boolean;
  defaultEdgeWeight: number;
}

export interface TopologyNode {
  id: string;
  labels: string[];
  properties: NodeProperties;
  createdAt: number;
  updatedAt: number;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  bidirectional: boolean;
}

export interface PathResult {
  nodes: string[];
  edges: string[];
  totalWeight: number;
  hops: number;
}

export interface ClusterResult {
  clusterId: string;
  nodeIds: string[];
  centroid?: GeoLocation;
  density: number;
  avgConnectivity: number;
}

export interface ImpactAnalysis {
  affectedNodes: string[];
  affectedCells: string[];
  propagationDepth: number;
  impactScore: number;
  criticalPath: string[];
}

/**
 * Network Topology Graph Manager
 * Features:
 * - Hypergraph support for multi-way relationships
 * - Cypher query language support
 * - Spatial indexing for geographic queries
 * - Impact analysis and propagation
 */
export class NetworkTopologyGraph {
  private config: GraphConfig;
  private graph: GraphNode | null = null;
  private isInitialized = false;

  // Node type labels
  private readonly NODE_LABELS = {
    GNB: 'GNB',
    ENB: 'ENB',
    CELL: 'Cell',
    SECTOR: 'Sector',
    CLUSTER: 'Cluster',
    REGION: 'Region',
    ALARM: 'Alarm',
    FAULT: 'Fault'
  } as const;

  // Relationship types
  private readonly REL_TYPES = {
    CONTAINS: 'CONTAINS',
    NEIGHBORS: 'NEIGHBORS',
    HANDOVER_TO: 'HANDOVER_TO',
    INTERFERENCE_WITH: 'INTERFERENCE_WITH',
    BACKHAUL_TO: 'BACKHAUL_TO',
    PART_OF: 'PART_OF',
    AFFECTS: 'AFFECTS',
    CORRELATED_WITH: 'CORRELATED_WITH'
  } as const;

  constructor(config: Partial<GraphConfig> = {}) {
    this.config = {
      enableHypergraph: true,
      maxNodeCount: 1000000,
      enableSpatialIndex: true,
      defaultEdgeWeight: 1.0,
      ...config
    };
  }

  /**
   * Initialize the graph database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing Network Topology Graph', { config: this.config });

    try {
      this.graph = new GraphNode({
        persistPath: this.config.persistPath,
        hypergraph: this.config.enableHypergraph,
        maxNodes: this.config.maxNodeCount,
        spatialIndex: this.config.enableSpatialIndex
      });

      await this.graph.initialize();

      // Create indexes
      await this.createIndexes();

      this.isInitialized = true;
      logger.info('Network Topology Graph initialized');
    } catch (error) {
      logger.error('Failed to initialize topology graph', { error });
      throw error;
    }
  }

  /**
   * Add a RAN node to the graph
   */
  async addRanNode(node: RanNode): Promise<string> {
    this.ensureInitialized();

    const label = node.nodeType === 'gNB' || node.nodeType === '5G-SA'
      ? this.NODE_LABELS.GNB
      : this.NODE_LABELS.ENB;

    const properties: NodeProperties = {
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      cellCount: node.cells.length,
      ...node.parameters
    };

    if (node.location) {
      properties.latitude = node.location.latitude;
      properties.longitude = node.location.longitude;
      properties.altitude = node.location.altitude;
    }

    const graphNodeId = await this.graph!.createNode(label, properties);

    // Add cells as connected nodes
    for (const cell of node.cells) {
      await this.addCell(cell, graphNodeId);
    }

    logger.debug('RAN node added to graph', { nodeId: node.nodeId, graphNodeId });
    return graphNodeId;
  }

  /**
   * Add a cell to the graph
   */
  async addCell(cell: Cell, parentNodeId?: string): Promise<string> {
    this.ensureInitialized();

    const properties: NodeProperties = {
      cellId: cell.cellId,
      sectorId: cell.sectorId,
      pci: cell.pci,
      frequencyBand: cell.frequencyBand,
      bandwidthMhz: cell.bandwidthMhz,
      maxPowerDbm: cell.maxPowerDbm,
      azimuth: cell.azimuth,
      tilt: cell.tilt
    };

    const graphNodeId = await this.graph!.createNode(this.NODE_LABELS.CELL, properties);

    // Create relationship to parent node
    if (parentNodeId) {
      await this.graph!.createRelationship(parentNodeId, graphNodeId, this.REL_TYPES.CONTAINS, {
        createdAt: Date.now()
      });
    }

    return graphNodeId;
  }

  /**
   * Add neighbor relationship between cells
   */
  async addNeighborRelation(
    cell1Id: string,
    cell2Id: string,
    relationProperties?: {
      handoverCount?: number;
      avgRsrp?: number;
      distance?: number;
    }
  ): Promise<void> {
    this.ensureInitialized();

    // Find graph nodes for cells
    const cell1 = await this.findNodeByProperty('cellId', cell1Id);
    const cell2 = await this.findNodeByProperty('cellId', cell2Id);

    if (!cell1 || !cell2) {
      logger.warn('Cannot create neighbor relation - cells not found', { cell1Id, cell2Id });
      return;
    }

    await this.graph!.createRelationship(cell1.id, cell2.id, this.REL_TYPES.NEIGHBORS, {
      ...relationProperties,
      createdAt: Date.now()
    });

    // Create reverse relationship for bidirectional neighbor
    await this.graph!.createRelationship(cell2.id, cell1.id, this.REL_TYPES.NEIGHBORS, {
      ...relationProperties,
      createdAt: Date.now()
    });

    logger.debug('Neighbor relation added', { cell1Id, cell2Id });
  }

  /**
   * Add handover relationship
   */
  async addHandoverRelation(
    sourceCellId: string,
    targetCellId: string,
    handoverStats: {
      successCount: number;
      failureCount: number;
      avgDuration: number;
    }
  ): Promise<void> {
    this.ensureInitialized();

    const sourceCell = await this.findNodeByProperty('cellId', sourceCellId);
    const targetCell = await this.findNodeByProperty('cellId', targetCellId);

    if (!sourceCell || !targetCell) {
      logger.warn('Cannot create handover relation - cells not found', { sourceCellId, targetCellId });
      return;
    }

    const successRate = handoverStats.successCount /
      (handoverStats.successCount + handoverStats.failureCount);

    await this.graph!.createRelationship(sourceCell.id, targetCell.id, this.REL_TYPES.HANDOVER_TO, {
      ...handoverStats,
      successRate,
      createdAt: Date.now()
    });
  }

  /**
   * Add interference relationship
   */
  async addInterferenceRelation(
    cell1Id: string,
    cell2Id: string,
    interferenceLevel: number
  ): Promise<void> {
    this.ensureInitialized();

    const cell1 = await this.findNodeByProperty('cellId', cell1Id);
    const cell2 = await this.findNodeByProperty('cellId', cell2Id);

    if (!cell1 || !cell2) {
      return;
    }

    await this.graph!.createRelationship(cell1.id, cell2.id, this.REL_TYPES.INTERFERENCE_WITH, {
      interferenceLevel,
      createdAt: Date.now()
    });
  }

  /**
   * Add alarm to graph and connect to affected nodes
   */
  async addAlarm(alarm: Alarm): Promise<string> {
    this.ensureInitialized();

    const properties: NodeProperties = {
      alarmId: alarm.alarmId,
      alarmType: alarm.alarmType,
      severity: alarm.severity,
      description: alarm.description,
      timestamp: alarm.timestamp,
      ...alarm.additionalInfo
    };

    const alarmNodeId = await this.graph!.createNode(this.NODE_LABELS.ALARM, properties);

    // Connect to affected node
    const affectedNode = await this.findNodeByProperty('nodeId', alarm.nodeId);
    if (affectedNode) {
      await this.graph!.createRelationship(alarmNodeId, affectedNode.id, this.REL_TYPES.AFFECTS, {
        timestamp: alarm.timestamp
      });
    }

    // Connect to affected cell if specified
    if (alarm.cellId) {
      const affectedCell = await this.findNodeByProperty('cellId', alarm.cellId);
      if (affectedCell) {
        await this.graph!.createRelationship(alarmNodeId, affectedCell.id, this.REL_TYPES.AFFECTS, {
          timestamp: alarm.timestamp
        });
      }
    }

    return alarmNodeId;
  }

  /**
   * Add fault event to graph
   */
  async addFault(fault: FaultEvent): Promise<string> {
    this.ensureInitialized();

    const properties: NodeProperties = {
      eventId: fault.eventId,
      faultType: fault.faultType,
      timestamp: fault.timestamp,
      recoveryTimestamp: fault.recoveryTimestamp,
      affectedCellCount: fault.affectedCells.length,
      ...fault.metricsAtFault
    };

    const faultNodeId = await this.graph!.createNode(this.NODE_LABELS.FAULT, properties);

    // Connect to affected node
    const affectedNode = await this.findNodeByProperty('nodeId', fault.nodeId);
    if (affectedNode) {
      await this.graph!.createRelationship(faultNodeId, affectedNode.id, this.REL_TYPES.AFFECTS, {
        timestamp: fault.timestamp
      });
    }

    // Connect to all affected cells
    for (const cellId of fault.affectedCells) {
      const cell = await this.findNodeByProperty('cellId', cellId);
      if (cell) {
        await this.graph!.createRelationship(faultNodeId, cell.id, this.REL_TYPES.AFFECTS, {
          timestamp: fault.timestamp
        });
      }
    }

    return faultNodeId;
  }

  /**
   * Execute a Cypher query
   */
  async query(cypher: string, parameters?: Record<string, unknown>): Promise<CypherResult> {
    this.ensureInitialized();
    return this.graph!.query(cypher, parameters);
  }

  /**
   * Find all neighbors of a cell
   */
  async findCellNeighbors(cellId: string, maxHops: number = 1): Promise<TopologyNode[]> {
    this.ensureInitialized();

    const cypher = `
      MATCH (c:Cell {cellId: $cellId})-[:NEIGHBORS*1..${maxHops}]-(neighbor:Cell)
      RETURN DISTINCT neighbor
    `;

    const result = await this.query(cypher, { cellId });
    return result.records.map(r => this.mapToTopologyNode(r.get('neighbor')));
  }

  /**
   * Find handover targets for a cell
   */
  async findHandoverTargets(cellId: string): Promise<Array<{ cell: TopologyNode; successRate: number }>> {
    this.ensureInitialized();

    const cypher = `
      MATCH (c:Cell {cellId: $cellId})-[ho:HANDOVER_TO]->(target:Cell)
      RETURN target, ho.successRate as successRate
      ORDER BY ho.successRate DESC
    `;

    const result = await this.query(cypher, { cellId });
    return result.records.map(r => ({
      cell: this.mapToTopologyNode(r.get('target')),
      successRate: r.get('successRate') as number
    }));
  }

  /**
   * Find interference sources for a cell
   */
  async findInterferenceSources(cellId: string): Promise<Array<{ cell: TopologyNode; level: number }>> {
    this.ensureInitialized();

    const cypher = `
      MATCH (c:Cell {cellId: $cellId})-[int:INTERFERENCE_WITH]-(source:Cell)
      RETURN source, int.interferenceLevel as level
      ORDER BY int.interferenceLevel DESC
    `;

    const result = await this.query(cypher, { cellId });
    return result.records.map(r => ({
      cell: this.mapToTopologyNode(r.get('source')),
      level: r.get('level') as number
    }));
  }

  /**
   * Find shortest path between two cells
   */
  async findShortestPath(
    sourceId: string,
    targetId: string,
    relationTypes?: string[]
  ): Promise<PathResult | null> {
    this.ensureInitialized();

    const relTypesClause = relationTypes
      ? `:${relationTypes.join('|')}`
      : '';

    const cypher = `
      MATCH (source {cellId: $sourceId}), (target {cellId: $targetId})
      MATCH path = shortestPath((source)-[${relTypesClause}*]-(target))
      RETURN path
    `;

    const result = await this.query(cypher, { sourceId, targetId });

    if (result.records.length === 0) return null;

    const path = result.records[0].get('path');
    return {
      nodes: path.nodes.map((n: any) => n.properties.cellId || n.properties.nodeId),
      edges: path.relationships.map((r: any) => r.type),
      totalWeight: path.relationships.reduce((sum: number, r: any) => sum + (r.properties.weight || 1), 0),
      hops: path.relationships.length
    };
  }

  /**
   * Analyze impact of a node failure
   */
  async analyzeImpact(nodeId: string, maxDepth: number = 3): Promise<ImpactAnalysis> {
    this.ensureInitialized();

    const cypher = `
      MATCH (source {nodeId: $nodeId})
      OPTIONAL MATCH (source)-[:CONTAINS]->(cell:Cell)
      WITH source, collect(cell.cellId) as directCells
      OPTIONAL MATCH path = (source)-[*1..${maxDepth}]-(affected)
      WHERE affected:Cell OR affected:GNB OR affected:ENB
      RETURN
        directCells,
        collect(DISTINCT affected.nodeId) as affectedNodes,
        collect(DISTINCT affected.cellId) as affectedCells,
        max(length(path)) as maxDepth
    `;

    const result = await this.query(cypher, { nodeId });

    if (result.records.length === 0) {
      return {
        affectedNodes: [],
        affectedCells: [],
        propagationDepth: 0,
        impactScore: 0,
        criticalPath: []
      };
    }

    const record = result.records[0];
    const affectedNodes = (record.get('affectedNodes') as string[]).filter(Boolean);
    const affectedCells = [
      ...(record.get('directCells') as string[]),
      ...(record.get('affectedCells') as string[]).filter(Boolean)
    ];

    const impactScore = this.calculateImpactScore(affectedNodes.length, affectedCells.length, maxDepth);

    return {
      affectedNodes,
      affectedCells: [...new Set(affectedCells)],
      propagationDepth: record.get('maxDepth') as number || 0,
      impactScore,
      criticalPath: await this.findCriticalPath(nodeId)
    };
  }

  /**
   * Find clusters of closely connected cells
   */
  async findClusters(minClusterSize: number = 3): Promise<ClusterResult[]> {
    this.ensureInitialized();

    const cypher = `
      MATCH (c1:Cell)-[:NEIGHBORS]-(c2:Cell)
      WITH c1, collect(DISTINCT c2) as neighbors
      WHERE size(neighbors) >= $minSize
      RETURN c1, neighbors
    `;

    const result = await this.query(cypher, { minSize: minClusterSize });
    const clusters: ClusterResult[] = [];
    const processedCells = new Set<string>();

    for (const record of result.records) {
      const cell = record.get('c1');
      const cellId = cell.properties.cellId;

      if (processedCells.has(cellId)) continue;

      const neighbors = record.get('neighbors') as any[];
      const clusterCells = [cellId, ...neighbors.map(n => n.properties.cellId)];

      clusterCells.forEach(id => processedCells.add(id));

      clusters.push({
        clusterId: `cluster_${clusters.length + 1}`,
        nodeIds: clusterCells,
        density: neighbors.length / clusterCells.length,
        avgConnectivity: neighbors.length
      });
    }

    return clusters;
  }

  /**
   * Find cells within geographic radius
   */
  async findCellsInRadius(
    center: GeoLocation,
    radiusKm: number
  ): Promise<TopologyNode[]> {
    this.ensureInitialized();

    // Using Haversine-like approximation in Cypher
    const cypher = `
      MATCH (c:Cell)
      WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      WITH c,
           point({latitude: c.latitude, longitude: c.longitude}) as cellPoint,
           point({latitude: $lat, longitude: $lon}) as centerPoint
      WHERE point.distance(cellPoint, centerPoint) <= $radiusMeters
      RETURN c
    `;

    const result = await this.query(cypher, {
      lat: center.latitude,
      lon: center.longitude,
      radiusMeters: radiusKm * 1000
    });

    return result.records.map(r => this.mapToTopologyNode(r.get('c')));
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: Record<string, number>;
    edgeTypeCounts: Record<string, number>;
  }> {
    this.ensureInitialized();

    const nodeCountCypher = `
      MATCH (n)
      RETURN labels(n)[0] as label, count(*) as count
    `;

    const edgeCountCypher = `
      MATCH ()-[r]->()
      RETURN type(r) as type, count(*) as count
    `;

    const [nodeResult, edgeResult] = await Promise.all([
      this.query(nodeCountCypher),
      this.query(edgeCountCypher)
    ]);

    const nodeTypeCounts: Record<string, number> = {};
    let totalNodes = 0;
    for (const record of nodeResult.records) {
      const label = record.get('label') as string;
      const count = record.get('count') as number;
      nodeTypeCounts[label] = count;
      totalNodes += count;
    }

    const edgeTypeCounts: Record<string, number> = {};
    let totalEdges = 0;
    for (const record of edgeResult.records) {
      const type = record.get('type') as string;
      const count = record.get('count') as number;
      edgeTypeCounts[type] = count;
      totalEdges += count;
    }

    return {
      nodeCount: totalNodes,
      edgeCount: totalEdges,
      nodeTypeCounts,
      edgeTypeCounts
    };
  }

  /**
   * Export graph to JSON
   */
  async exportToJson(): Promise<{ nodes: TopologyNode[]; edges: TopologyEdge[] }> {
    this.ensureInitialized();

    const nodesCypher = 'MATCH (n) RETURN n';
    const edgesCypher = 'MATCH (a)-[r]->(b) RETURN a, r, b';

    const [nodesResult, edgesResult] = await Promise.all([
      this.query(nodesCypher),
      this.query(edgesCypher)
    ]);

    const nodes = nodesResult.records.map(r => this.mapToTopologyNode(r.get('n')));

    const edges: TopologyEdge[] = edgesResult.records.map((r, idx) => ({
      id: `edge_${idx}`,
      source: r.get('a').properties.nodeId || r.get('a').properties.cellId,
      target: r.get('b').properties.nodeId || r.get('b').properties.cellId,
      type: r.get('r').type,
      properties: r.get('r').properties,
      weight: r.get('r').properties.weight || 1,
      bidirectional: false
    }));

    return { nodes, edges };
  }

  /**
   * Close the graph database
   */
  async close(): Promise<void> {
    if (this.graph) {
      await this.graph.close();
      this.isInitialized = false;
      logger.info('Network Topology Graph closed');
    }
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.graph) {
      throw new Error('Topology graph not initialized. Call initialize() first.');
    }
  }

  private async createIndexes(): Promise<void> {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS FOR (n:GNB) ON (n.nodeId)',
      'CREATE INDEX IF NOT EXISTS FOR (n:ENB) ON (n.nodeId)',
      'CREATE INDEX IF NOT EXISTS FOR (c:Cell) ON (c.cellId)',
      'CREATE INDEX IF NOT EXISTS FOR (c:Cell) ON (c.pci)',
      'CREATE INDEX IF NOT EXISTS FOR (a:Alarm) ON (a.alarmId)',
      'CREATE INDEX IF NOT EXISTS FOR (f:Fault) ON (f.eventId)'
    ];

    for (const indexQuery of indexes) {
      try {
        await this.query(indexQuery);
      } catch (error) {
        logger.debug('Index creation skipped', { query: indexQuery });
      }
    }
  }

  private async findNodeByProperty(property: string, value: string): Promise<any | null> {
    const cypher = `MATCH (n {${property}: $value}) RETURN n LIMIT 1`;
    const result = await this.query(cypher, { value });

    if (result.records.length === 0) return null;
    return result.records[0].get('n');
  }

  private mapToTopologyNode(graphNode: any): TopologyNode {
    return {
      id: graphNode.identity?.toString() || graphNode.properties.nodeId || graphNode.properties.cellId,
      labels: graphNode.labels || [],
      properties: graphNode.properties,
      createdAt: graphNode.properties.createdAt || Date.now(),
      updatedAt: graphNode.properties.updatedAt || Date.now()
    };
  }

  private calculateImpactScore(nodeCount: number, cellCount: number, depth: number): number {
    // Weighted impact score
    const nodeWeight = 0.4;
    const cellWeight = 0.5;
    const depthWeight = 0.1;

    const normalizedNodes = Math.min(nodeCount / 100, 1);
    const normalizedCells = Math.min(cellCount / 1000, 1);
    const normalizedDepth = Math.min(depth / 10, 1);

    return (
      nodeWeight * normalizedNodes +
      cellWeight * normalizedCells +
      depthWeight * normalizedDepth
    );
  }

  private async findCriticalPath(nodeId: string): Promise<string[]> {
    // Find the most impactful path from this node
    const cypher = `
      MATCH (source {nodeId: $nodeId})
      MATCH path = (source)-[:CONTAINS|HANDOVER_TO|BACKHAUL_TO*1..5]->(end)
      WITH path, reduce(w = 0, r IN relationships(path) | w + coalesce(r.weight, 1)) as totalWeight
      ORDER BY totalWeight DESC
      LIMIT 1
      RETURN [n IN nodes(path) | n.nodeId OR n.cellId] as criticalPath
    `;

    const result = await this.query(cypher, { nodeId });

    if (result.records.length === 0) return [nodeId];
    return result.records[0].get('criticalPath') as string[];
  }
}

// Export factory function
export function createNetworkTopologyGraph(config?: Partial<GraphConfig>): NetworkTopologyGraph {
  return new NetworkTopologyGraph(config);
}
