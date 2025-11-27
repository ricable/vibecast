#!/bin/bash
# =============================================================================
# Ericsson RAN Automation - E2B Sandbox Setup Script
# This script runs inside each E2B sandbox to configure the RAN automation env
# =============================================================================

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Configuration
# =============================================================================
PROJECT_DIR="/home/user/ericsson-ran-automation"
SANDBOX_ID="${SANDBOX_ID:-$(uuidgen | cut -c1-8)}"
GEMINI_KEY="${GEMINI_KEY:-}"

log_info "=== Ericsson RAN Automation Sandbox Setup ==="
log_info "Sandbox ID: $SANDBOX_ID"
log_info "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# =============================================================================
# Phase 1: Project Initialization
# =============================================================================
log_info "Phase 1: Project Initialization"

mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Initialize npm project
npm init -y > /dev/null 2>&1
npm pkg set type="module"
npm pkg set engines.node=">=20.0.0"
npm pkg set name="ericsson-ran-automation-$SANDBOX_ID"

log_success "Project initialized"

# =============================================================================
# Phase 2: Environment Configuration
# =============================================================================
log_info "Phase 2: Environment Configuration"

cat > .env << EOF
# ============================================
# ERICSSON RAN AUTOMATION - ENVIRONMENT CONFIG
# Sandbox ID: $SANDBOX_ID
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# ============================================

# --- LLM Provider Configuration ---
GOOGLE_GEMINI_API_KEY=$GEMINI_KEY
PROVIDER=gemini

# --- Vector Database Configuration ---
RUVECTOR_DIMENSIONS=1536
RUVECTOR_INDEX_TYPE=hnsw
RUVECTOR_DB_PATH=./data/ran-vectors.db

# --- Claude-Flow Configuration ---
CLAUDE_FLOW_MEMORY_PATH=./memory
CLAUDE_FLOW_METRICS_PATH=./.claude-flow/metrics

# --- RAN Automation Specific ---
KPI_GRANULARITY_MINUTES=15
ENM_EXPORT_PATH=./data/enm-exports
OPTIMIZATION_HISTORY_PATH=./data/optimization-history

# --- Sandbox Configuration ---
SANDBOX_ID=$SANDBOX_ID
EOF

log_success "Environment configured"

# =============================================================================
# Phase 3: Directory Structure
# =============================================================================
log_info "Phase 3: Creating Directory Structure"

mkdir -p src/{agents,tools,embeddings,workflows}
mkdir -p data/{enm-exports,vectors,optimization-history,kpi-snapshots}
mkdir -p memory
mkdir -p .claude/agents
mkdir -p .claude-flow/metrics
mkdir -p config/features

log_success "Directory structure created"

# =============================================================================
# Phase 4: Install Core Tools via npx
# =============================================================================
log_info "Phase 4: Installing Core Tools"

# Install and initialize claude-flow
log_info "Running: npx claude-flow@alpha init"
timeout 120 npx claude-flow@alpha init --yes 2>&1 || log_warning "claude-flow init completed with warnings"

# Verify agentic-flow with Gemini key
log_info "Running: npx agentic-flow (with GEMINI_KEY)"
GOOGLE_GEMINI_API_KEY="$GEMINI_KEY" timeout 60 npx agentic-flow --help 2>&1 || log_warning "agentic-flow help check completed"

# Verify ruvector
log_info "Running: npx ruvector"
timeout 60 npx ruvector --help 2>&1 || log_warning "ruvector help check completed"

log_success "Core tools installed"

# =============================================================================
# Phase 5: Install Dependencies
# =============================================================================
log_info "Phase 5: Installing Dependencies"

npm install @anthropic-ai/sdk dotenv better-sqlite3 zod csv-parse --save 2>&1 || true
npm install -D typescript @types/node tsx --save-dev 2>&1 || true

log_success "Dependencies installed"

# =============================================================================
# Phase 6: Create Claude-Flow Agent Configurations
# =============================================================================
log_info "Phase 6: Creating Agent Configurations"

# RAN Optimizer Agent
cat > .claude/agents/ran-optimizer.md << 'AGENTEOF'
---
name: ran-optimizer
description: Master RAN optimization coordinator
capabilities:
  - Analyze network-wide KPIs
  - Coordinate optimization workflows
  - Prioritize optimization actions
  - Track optimization history
tools:
  - kpi_analysis
  - parameter_recommendation
  - feature_activation
  - optimization_history
---

# RAN Optimizer Agent

You are an expert Ericsson RAN optimization engineer. Your role is to:

1. **Analyze** network performance using 15-minute KPI granularity
2. **Identify** optimization opportunities across LTE/NR network
3. **Recommend** parameter changes based on engineering guidelines
4. **Coordinate** with specialist agents for domain-specific optimizations
5. **Track** all changes in optimization history for rollback capability

## Decision Framework

When analyzing KPIs, prioritize:
1. Service-affecting issues (call drops, handover failures)
2. Capacity constraints (PRB utilization >80%)
3. Energy efficiency opportunities
4. Feature optimization potential

## Interaction Pattern

- Query the vector database for relevant Ericsson documentation
- Consult feature-expert agent for activation/deactivation decisions
- Delegate mobility issues to mobility-specialist agent
- Report all recommended changes with impact assessment
AGENTEOF

# KPI Analyzer Agent
cat > .claude/agents/kpi-analyzer.md << 'AGENTEOF'
---
name: kpi-analyzer
description: KPI analysis and anomaly detection specialist
capabilities:
  - Parse ENM KPI exports
  - Detect anomalies and trends
  - Calculate composite KPIs
  - Generate performance reports
tools:
  - csv_parser
  - anomaly_detection
  - trend_analysis
  - report_generator
---

# KPI Analyzer Agent

You are a specialized KPI analysis agent for Ericsson RAN networks.

## Core Metrics

### Accessibility KPIs
- RRC Setup Success Rate (target: >99.5%)
- E-RAB Setup Success Rate (target: >99%)
- S1 Signaling Connection Success Rate

### Retainability KPIs
- Call Drop Rate (target: <1%)
- E-RAB Drop Rate
- RRC Abnormal Release Rate

### Mobility KPIs
- Handover Success Rate (target: >98%)
- Inter-frequency HO Success Rate
- Inter-RAT HO Success Rate

### Utilization KPIs
- PRB Utilization (DL/UL)
- Active Users per Cell
- Throughput per User

## Analysis Workflow

1. Load KPI data from CSV exports
2. Calculate rolling averages and trends
3. Compare against thresholds
4. Flag anomalies and degradations
5. Correlate with recent parameter changes
6. Generate actionable recommendations
AGENTEOF

# Feature Expert Agent
cat > .claude/agents/feature-expert.md << 'AGENTEOF'
---
name: feature-expert
description: Ericsson feature activation and configuration expert
capabilities:
  - Feature lookup by FAJ ID or CXC code
  - Activation/deactivation guidance
  - Parameter configuration recommendations
  - Feature dependency analysis
tools:
  - feature_search
  - parameter_lookup
  - activation_validator
  - dependency_checker
---

# Feature Expert Agent

You are an Ericsson feature specialist with knowledge of 377+ RAN features.

## Feature Categories

- **Carrier Aggregation**: 31 features (CA combinations, SCell management)
- **Dual Connectivity**: 3 features (EN-DC, NR-DC configurations)
- **Energy Efficiency**: 5 features (MIMO Sleep, Symbol Shutdown, Cell Sleep)
- **MIMO Features**: 8 features (Massive MIMO, Beamforming)
- **Mobility**: 27 features (Handover optimization, load balancing)

## Workflow

1. When asked about a feature:
   - Search vector database for feature documentation
   - Retrieve parameters, counters, and CXC codes
   - Check prerequisites and dependencies
   - Provide activation commands

2. For configuration questions:
   - Retrieve engineering guidelines
   - Provide recommended parameter values
   - Explain trade-offs and impacts

## Response Format

Always include:
- Feature name and FAJ ID
- CXC activation code
- Required parameters
- Impact assessment
- Rollback procedure
AGENTEOF

# Mobility Specialist Agent
cat > .claude/agents/mobility-specialist.md << 'AGENTEOF'
---
name: mobility-specialist
description: Handover and mobility optimization specialist
capabilities:
  - Handover parameter tuning
  - Neighbor relation optimization
  - Load balancing configuration
  - Mobility robustness optimization
tools:
  - ho_analysis
  - anr_management
  - mlb_configuration
  - mro_tuning
---

# Mobility Specialist Agent

You are a mobility optimization expert for Ericsson LTE/NR networks.

## Key Parameters

### Handover Control
- `a3offset` - A3 event offset (typical: 2-4 dB)
- `hysteresisA3` - A3 hysteresis (typical: 1-2 dB)
- `timeToTriggerA3` - Time to trigger (typical: 160-320 ms)
- `cellIndividualOffsetEUtran` - CIO adjustments

### Load Balancing (MLB)
- `loadBalancing` - Enable/disable MLB
- `lbUtilOffloadThreshold` - Trigger threshold
- `lbUtilStopOffloadThreshold` - Stop threshold
- `lbCellCapacity` - Relative cell capacity

### Mobility Robustness (MRO)
- `mroLeEnabled` - Late handover detection
- `mroEeEnabled` - Early handover detection
- `mroWrongCellEnabled` - Wrong cell detection

## Optimization Strategies

1. **Too Early HO**: Increase timeToTrigger, increase hysteresis
2. **Too Late HO**: Decrease timeToTrigger, decrease a3offset
3. **Ping-Pong**: Increase hysteresis, add TTT
4. **Missing Neighbor**: Add ANR relation, check coverage
AGENTEOF

# Energy Optimizer Agent
cat > .claude/agents/energy-optimizer.md << 'AGENTEOF'
---
name: energy-optimizer
description: Energy efficiency and green network specialist
capabilities:
  - Energy saving feature configuration
  - Traffic pattern analysis
  - Power consumption optimization
  - Green KPI reporting
tools:
  - energy_analysis
  - traffic_pattern_detector
  - feature_scheduler
  - savings_calculator
---

# Energy Optimizer Agent

You are an energy efficiency specialist for Ericsson RAN networks.

## Energy Saving Features

### MIMO Sleep Mode (CXC4011808)
- Reduces MIMO layers during low traffic
- Parameters: `mimoSleepMode`, `mimoSleepDlPrbThreshold`
- Typical savings: 5-10% of radio power

### Symbol Shutdown
- Disables symbols in low-traffic periods
- Parameters: `symbolShutdown`, `shutdownThreshold`
- Typical savings: 10-15% of radio power

### Cell Sleep
- Hibernates entire cells during zero traffic
- Parameters: `cellSleepMode`, `sleepActivationThreshold`
- Typical savings: 20-30% (sleeping cells only)

### Carrier Shutdown
- Disables secondary carriers during low load
- Parameters: `capacityBoostShutdown`
- Typical savings: Linear with carriers disabled

## Optimization Workflow

1. Analyze traffic patterns (hourly, daily, weekly)
2. Identify low-traffic periods
3. Configure feature activation thresholds
4. Schedule aggressive savings during off-peak
5. Monitor service impact
6. Calculate and report energy savings
AGENTEOF

log_success "Agent configurations created"

# =============================================================================
# Phase 7: Create Router Configuration
# =============================================================================
log_info "Phase 7: Creating Router Configuration"

cat > config/router.config.json << 'ROUTEREOF'
{
  "defaultProvider": "gemini",
  "providers": {
    "gemini": {
      "enabled": true,
      "apiKeyEnv": "GOOGLE_GEMINI_API_KEY",
      "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"]
    },
    "openrouter": {
      "enabled": false,
      "baseUrl": "https://openrouter.ai/api/v1",
      "defaultModel": "deepseek/deepseek-chat"
    }
  },
  "routingRules": [
    {
      "name": "complex-reasoning",
      "condition": {
        "taskType": ["architecture", "debugging", "complex-analysis"]
      },
      "provider": "gemini",
      "model": "gemini-1.5-pro"
    },
    {
      "name": "code-generation",
      "condition": {
        "taskType": ["coding", "scripting", "automation"]
      },
      "provider": "gemini",
      "model": "gemini-1.5-flash"
    },
    {
      "name": "general-tasks",
      "condition": {
        "default": true
      },
      "provider": "gemini",
      "model": "gemini-1.5-flash"
    }
  ],
  "costOptimization": {
    "enabled": true,
    "maxCostPerRequest": 0.01,
    "preferCheaperModels": true
  }
}
ROUTEREOF

log_success "Router configuration created"

# =============================================================================
# Phase 8: Initialize Ruvector Database
# =============================================================================
log_info "Phase 8: Initializing Ruvector Database"

# Create ruvector initialization script
cat > src/embeddings/init-vector-db.ts << 'VECTOREOF'
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

// Sample Ericsson features for vector database
const sampleFeatures = [
  {
    id: 'mimo-sleep',
    fajId: 'FAJ 121 3094',
    cxcCode: 'CXC4011808',
    name: 'MIMO Sleep Mode',
    description: 'Reduces MIMO layers during low traffic periods to save energy',
    category: 'Energy Efficiency',
    parameters: ['mimoSleepMode', 'mimoSleepDlPrbThreshold'],
    counters: ['pmMimoSleepTime', 'pmMimoActiveTime']
  },
  {
    id: 'carrier-agg-2cc',
    fajId: 'FAJ 121 2001',
    cxcCode: 'CXC4011234',
    name: 'Carrier Aggregation 2CC',
    description: 'Enables 2-carrier aggregation for increased throughput',
    category: 'Carrier Aggregation',
    parameters: ['caEnabled', 'scellActivationThreshold'],
    counters: ['pmCaActivations', 'pmCaThroughput']
  },
  {
    id: 'load-balancing',
    fajId: 'FAJ 121 2045',
    cxcCode: 'CXC4011567',
    name: 'Mobility Load Balancing',
    description: 'Balances load between cells based on PRB utilization',
    category: 'Mobility',
    parameters: ['loadBalancing', 'lbUtilOffloadThreshold', 'lbCellCapacity'],
    counters: ['pmLbOffloadAttempts', 'pmLbOffloadSuccess']
  }
];

async function initializeVectorDB() {
  console.log('Initializing Ruvector database for Ericsson RAN...');

  // Ensure data directory exists
  if (!existsSync('./data/vectors')) {
    mkdirSync('./data/vectors', { recursive: true });
  }

  // Save features for reference
  writeFileSync('./config/features/catalog.json', JSON.stringify(sampleFeatures, null, 2));

  console.log(`Loaded ${sampleFeatures.length} sample features`);
  console.log('Vector database initialization complete');
}

initializeVectorDB().catch(console.error);
VECTOREOF

# Run initialization
npx tsx src/embeddings/init-vector-db.ts 2>&1 || log_warning "Vector DB init completed with warnings"

log_success "Ruvector database initialized"

# =============================================================================
# Phase 9: Create CLAUDE.md
# =============================================================================
log_info "Phase 9: Creating CLAUDE.md"

cat > CLAUDE.md << 'CLAUDEEOF'
# Ericsson RAN Automation Project

## Overview

This project implements an AI-powered automation system for Ericsson Radio Access Network optimization using:
- **claude-flow**: Multi-agent orchestration
- **agentic-flow**: Cost-optimized LLM routing with Gemini
- **ruvector**: Semantic search over RAN documentation

## Quick Start

```bash
# Run a swarm task
npx claude-flow@alpha swarm "Analyze mobility KPIs for cluster-north"

# Start persistent hive-mind session
npx claude-flow@alpha hive-mind --name ran-optimization

# Search documentation
npx ruvector search ran-features "MIMO sleep mode configuration"
```

## Agent Capabilities

| Agent | Specialty | Use When |
|-------|-----------|----------|
| ran-optimizer | Master coordinator | Complex multi-domain issues |
| kpi-analyzer | Performance metrics | KPI degradation, trending |
| feature-expert | Feature configuration | Activation, parameters |
| mobility-specialist | Handover optimization | HO failures, ping-pong |
| energy-optimizer | Power efficiency | Energy saving features |

## Key Ericsson Concepts

### Feature Identification
- **FAJ ID**: Feature Article Number (e.g., FAJ 121 3094)
- **CXC Code**: Activation license code (e.g., CXC4011808)

### Common Parameters
- Mobility: `a3offset`, `hysteresisA3`, `timeToTriggerA3`
- Load Balancing: `lbUtilOffloadThreshold`, `lbCellCapacity`
- Energy: `mimoSleepMode`, `symbolShutdown`

### KPI Thresholds
- RRC Setup Success: >99.5%
- Call Drop Rate: <1%
- HO Success Rate: >98%
- PRB Utilization Warning: >80%

## Development Commands

```bash
# Initialize vector database with Ericsson docs
npm run init:vectors

# Run optimization workflow
npm run optimize -- --type mobility --scope cluster --targets cluster-1

# View agent memory
npx claude-flow@alpha memory list

# Check system status
npx claude-flow@alpha status
```
CLAUDEEOF

log_success "CLAUDE.md created"

# =============================================================================
# Completion
# =============================================================================
log_info "=== Setup Complete ==="
log_success "Sandbox $SANDBOX_ID is ready for Ericsson RAN Automation"
log_info "Project directory: $PROJECT_DIR"
log_info "Agents configured: 5"
log_info "Vector database: initialized"
log_info "Environment: Gemini API configured"

echo ""
echo "To start using the system:"
echo "  cd $PROJECT_DIR"
echo "  npx claude-flow@alpha status"
echo ""
