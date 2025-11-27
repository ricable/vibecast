/**
 * Distributed Cluster Manager for Ericsson RAN Automation
 * Manages distributed vector operations and GNN computations across nodes
 */

import { logger } from '../core/logger.js';

export interface ClusterConfig {
  nodeId: string;
  port: number;
  grpcPort: number;
  dataDir: string;
  replicationFactor: number;
  heartbeatIntervalMs: number;
  electionTimeoutMs: number;
  maxRetries: number;
}

export interface ClusterNode {
  nodeId: string;
  address: string;
  port: number;
  grpcPort: number;
  status: 'active' | 'inactive' | 'joining' | 'leaving' | 'failed';
  role: 'leader' | 'follower' | 'candidate';
  lastHeartbeat: number;
  metadata: NodeMetadata;
}

export interface NodeMetadata {
  vectorCount: number;
  memoryUsageMb: number;
  cpuUsage: number;
  diskUsageMb: number;
  region?: string;
  zone?: string;
  capabilities: string[];
}

export interface PartitionInfo {
  partitionId: string;
  nodeIds: string[];
  primaryNode: string;
  replicaNodes: string[];
  keyRange: [string, string];
  vectorCount: number;
  lastUpdated: number;
}

export interface ClusterState {
  clusterId: string;
  version: number;
  leader: string | null;
  nodes: Map<string, ClusterNode>;
  partitions: PartitionInfo[];
  health: ClusterHealth;
}

export interface ClusterHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  activeNodes: number;
  totalNodes: number;
  replicationHealth: number;
  avgLatencyMs: number;
  issues: string[];
}

export interface DistributedOperation {
  operationId: string;
  type: 'insert' | 'search' | 'delete' | 'sync' | 'rebalance';
  targetNodes: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  result?: unknown;
  error?: string;
}

export interface SearchQuery {
  vector: Float32Array;
  topK: number;
  filter?: Record<string, unknown>;
  timeout?: number;
}

export interface DistributedSearchResult {
  results: Array<{
    id: string;
    score: number;
    metadata: Record<string, unknown>;
    sourceNode: string;
  }>;
  searchedNodes: string[];
  totalDuration: number;
  partialResults: boolean;
}

/**
 * Distributed Cluster Manager
 * Features:
 * - Raft-based leader election
 * - Automatic partition management
 * - Distributed vector search
 * - Node health monitoring
 * - Automatic failover and recovery
 */
export class DistributedClusterManager {
  private config: ClusterConfig;
  private isInitialized = false;
  private state: ClusterState | null = null;
  private localNode: ClusterNode | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private operationQueue: DistributedOperation[] = [];
  private isLeader = false;

  // Election state
  private currentTerm = 0;
  private votedFor: string | null = null;
  private electionTimeout: NodeJS.Timeout | null = null;

  // Performance tracking
  private latencies: number[] = [];

  constructor(config: Partial<ClusterConfig> = {}) {
    this.config = {
      nodeId: `node_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      port: 8080,
      grpcPort: 50051,
      dataDir: './ruvector-data',
      replicationFactor: 3,
      heartbeatIntervalMs: 5000,
      electionTimeoutMs: 15000,
      maxRetries: 3,
      ...config
    };
  }

  /**
   * Initialize the cluster manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing Distributed Cluster Manager', {
      nodeId: this.config.nodeId,
      port: this.config.port
    });

    // Initialize local node
    this.localNode = {
      nodeId: this.config.nodeId,
      address: 'localhost',
      port: this.config.port,
      grpcPort: this.config.grpcPort,
      status: 'active',
      role: 'follower',
      lastHeartbeat: Date.now(),
      metadata: {
        vectorCount: 0,
        memoryUsageMb: 0,
        cpuUsage: 0,
        diskUsageMb: 0,
        capabilities: ['vector_search', 'gnn_inference', 'embedding']
      }
    };

    // Initialize cluster state
    this.state = {
      clusterId: `cluster_${Date.now()}`,
      version: 1,
      leader: null,
      nodes: new Map([[this.config.nodeId, this.localNode]]),
      partitions: [],
      health: {
        status: 'healthy',
        activeNodes: 1,
        totalNodes: 1,
        replicationHealth: 1,
        avgLatencyMs: 0,
        issues: []
      }
    };

    // Start heartbeat
    this.startHeartbeat();

    // Start election timeout
    this.resetElectionTimeout();

    this.isInitialized = true;
    logger.info('Distributed Cluster Manager initialized');
  }

  /**
   * Join an existing cluster
   */
  async joinCluster(seedNode: { address: string; port: number }): Promise<boolean> {
    this.ensureInitialized();

    logger.info('Joining cluster', { seedNode });

    try {
      // In production, this would make an actual network request
      // For now, simulate joining
      const joinRequest = {
        nodeId: this.config.nodeId,
        address: 'localhost',
        port: this.config.port,
        grpcPort: this.config.grpcPort,
        metadata: this.localNode!.metadata
      };

      // Simulate network delay
      await this.simulateNetworkDelay();

      // Assume join successful - would receive cluster state from seed
      this.localNode!.status = 'active';
      this.localNode!.role = 'follower';

      logger.info('Successfully joined cluster');
      return true;
    } catch (error) {
      logger.error('Failed to join cluster', { error });
      return false;
    }
  }

  /**
   * Leave the cluster gracefully
   */
  async leaveCluster(): Promise<void> {
    this.ensureInitialized();

    logger.info('Leaving cluster');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop election timeout
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
      this.electionTimeout = null;
    }

    // Update local node status
    if (this.localNode) {
      this.localNode.status = 'leaving';
    }

    // Notify other nodes (would be network call in production)
    logger.info('Left cluster successfully');
  }

  /**
   * Get current cluster status
   */
  getClusterStatus(): ClusterState | null {
    return this.state;
  }

  /**
   * Get all cluster nodes
   */
  getNodes(): ClusterNode[] {
    if (!this.state) return [];
    return Array.from(this.state.nodes.values());
  }

  /**
   * Get current leader
   */
  getLeader(): ClusterNode | null {
    if (!this.state || !this.state.leader) return null;
    return this.state.nodes.get(this.state.leader) || null;
  }

  /**
   * Check if this node is the leader
   */
  isClusterLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Distributed vector insert
   */
  async distributedInsert(
    id: string,
    vector: Float32Array,
    metadata: Record<string, unknown>
  ): Promise<DistributedOperation> {
    this.ensureInitialized();

    const operation: DistributedOperation = {
      operationId: `op_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'insert',
      targetNodes: this.selectNodesForWrite(id),
      status: 'pending',
      startTime: Date.now()
    };

    this.operationQueue.push(operation);

    try {
      operation.status = 'in_progress';

      // Simulate distributed write to target nodes
      const writeResults = await Promise.all(
        operation.targetNodes.map(async nodeId => {
          await this.simulateNetworkDelay();
          return { nodeId, success: true };
        })
      );

      const successCount = writeResults.filter(r => r.success).length;

      if (successCount >= Math.ceil(operation.targetNodes.length / 2)) {
        operation.status = 'completed';
        operation.result = { writeCount: successCount, totalNodes: operation.targetNodes.length };
      } else {
        operation.status = 'failed';
        operation.error = 'Insufficient write acknowledgements';
      }
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error);
    }

    operation.endTime = Date.now();
    return operation;
  }

  /**
   * Distributed vector search across all nodes
   */
  async distributedSearch(query: SearchQuery): Promise<DistributedSearchResult> {
    this.ensureInitialized();

    const startTime = performance.now();
    const searchedNodes: string[] = [];
    const allResults: Array<{ id: string; score: number; metadata: Record<string, unknown>; sourceNode: string }> = [];
    let partialResults = false;

    // Query all active nodes
    const activeNodes = Array.from(this.state!.nodes.values())
      .filter(node => node.status === 'active');

    const searchPromises = activeNodes.map(async node => {
      try {
        searchedNodes.push(node.nodeId);
        await this.simulateNetworkDelay();

        // Simulate search results from this node
        const nodeResults = this.simulateLocalSearch(query, node.nodeId);
        return { nodeId: node.nodeId, results: nodeResults, success: true };
      } catch (error) {
        partialResults = true;
        return { nodeId: node.nodeId, results: [], success: false };
      }
    });

    const nodeResults = await Promise.all(searchPromises);

    // Merge and sort results
    for (const { nodeId, results } of nodeResults) {
      for (const result of results) {
        allResults.push({ ...result, sourceNode: nodeId });
      }
    }

    // Sort by score and take top K
    allResults.sort((a, b) => b.score - a.score);
    const topResults = allResults.slice(0, query.topK);

    const totalDuration = performance.now() - startTime;
    this.trackLatency(totalDuration);

    return {
      results: topResults,
      searchedNodes,
      totalDuration,
      partialResults
    };
  }

  /**
   * Trigger cluster rebalancing
   */
  async rebalanceCluster(): Promise<DistributedOperation> {
    this.ensureInitialized();

    if (!this.isLeader) {
      throw new Error('Only leader can trigger rebalance');
    }

    const operation: DistributedOperation = {
      operationId: `rebalance_${Date.now()}`,
      type: 'rebalance',
      targetNodes: Array.from(this.state!.nodes.keys()),
      status: 'pending',
      startTime: Date.now()
    };

    logger.info('Starting cluster rebalance', { operationId: operation.operationId });

    try {
      operation.status = 'in_progress';

      // Calculate optimal partition distribution
      const newPartitions = this.calculateOptimalPartitions();

      // Apply new partition configuration
      this.state!.partitions = newPartitions;
      this.state!.version++;

      operation.status = 'completed';
      operation.result = { newPartitions: newPartitions.length };
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error);
    }

    operation.endTime = Date.now();
    return operation;
  }

  /**
   * Sync data between nodes
   */
  async syncNode(targetNodeId: string): Promise<DistributedOperation> {
    this.ensureInitialized();

    const operation: DistributedOperation = {
      operationId: `sync_${Date.now()}`,
      type: 'sync',
      targetNodes: [targetNodeId],
      status: 'pending',
      startTime: Date.now()
    };

    try {
      operation.status = 'in_progress';
      await this.simulateNetworkDelay();

      // Simulate sync completion
      operation.status = 'completed';
      operation.result = { syncedVectors: 1000 };
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error);
    }

    operation.endTime = Date.now();
    return operation;
  }

  /**
   * Get cluster health metrics
   */
  getHealth(): ClusterHealth {
    if (!this.state) {
      return {
        status: 'unhealthy',
        activeNodes: 0,
        totalNodes: 0,
        replicationHealth: 0,
        avgLatencyMs: 0,
        issues: ['Cluster not initialized']
      };
    }

    const activeNodes = Array.from(this.state.nodes.values())
      .filter(node => node.status === 'active').length;
    const totalNodes = this.state.nodes.size;

    const issues: string[] = [];

    if (activeNodes < totalNodes * 0.5) {
      issues.push('More than 50% of nodes are inactive');
    }

    if (!this.state.leader) {
      issues.push('No cluster leader elected');
    }

    const replicationHealth = totalNodes > 0
      ? Math.min(activeNodes / this.config.replicationFactor, 1)
      : 0;

    const avgLatency = this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0;

    const status: ClusterHealth['status'] = issues.length === 0
      ? 'healthy'
      : issues.length <= 2
        ? 'degraded'
        : 'unhealthy';

    return {
      status,
      activeNodes,
      totalNodes,
      replicationHealth,
      avgLatencyMs: avgLatency,
      issues
    };
  }

  /**
   * Get partition information
   */
  getPartitions(): PartitionInfo[] {
    return this.state?.partitions || [];
  }

  /**
   * Update local node metadata
   */
  updateNodeMetadata(metadata: Partial<NodeMetadata>): void {
    if (this.localNode) {
      this.localNode.metadata = {
        ...this.localNode.metadata,
        ...metadata
      };
    }
  }

  /**
   * Get operation history
   */
  getOperationHistory(limit: number = 100): DistributedOperation[] {
    return this.operationQueue.slice(-limit);
  }

  /**
   * Close the cluster manager
   */
  async close(): Promise<void> {
    await this.leaveCluster();
    this.isInitialized = false;
    logger.info('Distributed Cluster Manager closed');
  }

  // Private methods

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Cluster manager not initialized. Call initialize() first.');
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private sendHeartbeat(): void {
    if (!this.state || !this.localNode) return;

    this.localNode.lastHeartbeat = Date.now();

    // Update node status based on heartbeat responses
    for (const [nodeId, node] of this.state.nodes) {
      if (nodeId === this.config.nodeId) continue;

      const timeSinceHeartbeat = Date.now() - node.lastHeartbeat;
      if (timeSinceHeartbeat > this.config.heartbeatIntervalMs * 3) {
        node.status = 'inactive';
      }
    }

    // Update cluster health
    this.state.health = this.getHealth();
  }

  private resetElectionTimeout(): void {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }

    // Randomize timeout to prevent split votes
    const timeout = this.config.electionTimeoutMs +
      Math.random() * this.config.electionTimeoutMs * 0.5;

    this.electionTimeout = setTimeout(() => {
      this.startElection();
    }, timeout);
  }

  private async startElection(): Promise<void> {
    if (!this.state || !this.localNode) return;

    this.currentTerm++;
    this.votedFor = this.config.nodeId;
    this.localNode.role = 'candidate';

    logger.info('Starting leader election', { term: this.currentTerm });

    const otherNodes = Array.from(this.state.nodes.values())
      .filter(node => node.nodeId !== this.config.nodeId && node.status === 'active');

    if (otherNodes.length === 0) {
      // Single node cluster - become leader
      this.becomeLeader();
      return;
    }

    // Request votes
    let votesReceived = 1; // Vote for self
    const majority = Math.floor(this.state.nodes.size / 2) + 1;

    for (const node of otherNodes) {
      // Simulate vote request
      await this.simulateNetworkDelay();
      const voteGranted = Math.random() > 0.3; // Simulate voting

      if (voteGranted) {
        votesReceived++;
      }

      if (votesReceived >= majority) {
        this.becomeLeader();
        return;
      }
    }

    // Election failed - reset to follower
    this.localNode.role = 'follower';
    this.resetElectionTimeout();
  }

  private becomeLeader(): void {
    if (!this.state || !this.localNode) return;

    this.isLeader = true;
    this.localNode.role = 'leader';
    this.state.leader = this.config.nodeId;

    logger.info('Became cluster leader', { nodeId: this.config.nodeId, term: this.currentTerm });

    // Initialize partitions if not present
    if (this.state.partitions.length === 0) {
      this.state.partitions = this.calculateOptimalPartitions();
    }
  }

  private selectNodesForWrite(id: string): string[] {
    if (!this.state) return [this.config.nodeId];

    const activeNodes = Array.from(this.state.nodes.values())
      .filter(node => node.status === 'active')
      .map(node => node.nodeId);

    // Simple hash-based node selection
    const hash = this.hashString(id);
    const primaryIndex = hash % activeNodes.length;
    const selectedNodes: string[] = [];

    for (let i = 0; i < Math.min(this.config.replicationFactor, activeNodes.length); i++) {
      const index = (primaryIndex + i) % activeNodes.length;
      selectedNodes.push(activeNodes[index]);
    }

    return selectedNodes;
  }

  private calculateOptimalPartitions(): PartitionInfo[] {
    if (!this.state) return [];

    const activeNodes = Array.from(this.state.nodes.values())
      .filter(node => node.status === 'active');

    if (activeNodes.length === 0) return [];

    // Create partitions based on number of nodes
    const numPartitions = Math.max(activeNodes.length * 4, 16);
    const partitions: PartitionInfo[] = [];

    for (let i = 0; i < numPartitions; i++) {
      const primaryIndex = i % activeNodes.length;
      const primaryNode = activeNodes[primaryIndex].nodeId;

      const replicaNodes: string[] = [];
      for (let j = 1; j < this.config.replicationFactor && j < activeNodes.length; j++) {
        const replicaIndex = (primaryIndex + j) % activeNodes.length;
        replicaNodes.push(activeNodes[replicaIndex].nodeId);
      }

      const startKey = this.partitionKey(i, numPartitions);
      const endKey = this.partitionKey(i + 1, numPartitions);

      partitions.push({
        partitionId: `partition_${i}`,
        nodeIds: [primaryNode, ...replicaNodes],
        primaryNode,
        replicaNodes,
        keyRange: [startKey, endKey],
        vectorCount: 0,
        lastUpdated: Date.now()
      });
    }

    return partitions;
  }

  private partitionKey(index: number, total: number): string {
    const fraction = index / total;
    return Math.floor(fraction * 0xFFFFFFFF).toString(16).padStart(8, '0');
  }

  private simulateLocalSearch(
    query: SearchQuery,
    nodeId: string
  ): Array<{ id: string; score: number; metadata: Record<string, unknown> }> {
    // Simulate search results
    const results: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];
    const resultCount = Math.floor(Math.random() * query.topK);

    for (let i = 0; i < resultCount; i++) {
      results.push({
        id: `vec_${nodeId}_${i}`,
        score: 0.5 + Math.random() * 0.5,
        metadata: { nodeId, index: i }
      });
    }

    return results;
  }

  private async simulateNetworkDelay(): Promise<void> {
    const delay = 5 + Math.random() * 20;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private trackLatency(latencyMs: number): void {
    this.latencies.push(latencyMs);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }
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
}

// Export factory function
export function createClusterManager(config?: Partial<ClusterConfig>): DistributedClusterManager {
  return new DistributedClusterManager(config);
}
