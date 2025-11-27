# Ericsson RAN Automation Platform

## Overview

This project implements an AI-powered automation system for Ericsson Radio Access Network (RAN) optimization using three interconnected tools:

- **claude-flow@alpha**: Multi-agent orchestration platform for coordinating specialized RAN agents
- **agentic-flow**: LLM routing and proxy layer for cost-optimized AI inference (using Gemini)
- **ruvector**: High-performance vector database for semantic search and agent memory

## E2B Sandbox Infrastructure

This platform is designed to run across 500 E2B sandboxes for distributed RAN analysis.

### Spawning Sandboxes

```bash
# Spawn all 500 sandboxes (requires E2B_API_KEY and GEMINI_KEY)
npm run e2b:spawn

# Spawn a smaller batch for testing
npm run e2b:spawn -- --count=10 --batch=5

# Check sandbox status
npm run e2b:status
```

### Environment Variables Required

```bash
export E2B_API_KEY="your-e2b-api-key"
export GEMINI_KEY="your-gemini-api-key"
```

## Quick Start

```bash
# Install dependencies
npm install

# Initialize vector database
npm run init:vectors

# Run optimization workflow
npm run optimize -- mobility cluster cluster-1

# Start interactive hive-mind session
npx claude-flow@alpha hive-mind --name ran-optimization

# Search documentation
npx ruvector search ran-features "MIMO sleep mode configuration"
```

## Agent Architecture

### Available Agents

| Agent | Specialty | Tools | Use When |
|-------|-----------|-------|----------|
| **ran-optimizer** | Master coordinator | kpi_analysis, parameter_recommendation, feature_activation | Complex multi-domain issues |
| **kpi-analyzer** | Performance metrics | csv_parser, anomaly_detection, trend_analysis | KPI degradation, trending |
| **feature-expert** | Feature configuration | feature_search, parameter_lookup, activation_validator | Activation, parameters |
| **mobility-specialist** | Handover optimization | ho_analysis, anr_management, mlb_configuration | HO failures, ping-pong |
| **energy-optimizer** | Power efficiency | energy_analysis, traffic_pattern_detector, feature_scheduler | Energy saving features |

### Agent Locations

Agent definitions are stored in `.claude/agents/`:
- `ran-optimizer.md` - Master optimization coordinator
- `kpi-analyzer.md` - KPI analysis specialist
- `feature-expert.md` - Feature activation expert
- `mobility-specialist.md` - Mobility optimization specialist
- `energy-optimizer.md` - Energy efficiency specialist

## Key Ericsson Concepts

### Feature Identification
- **FAJ ID**: Feature Article Number (e.g., FAJ 121 3094)
- **CXC Code**: Activation license code (e.g., CXC4011808)

### Common Parameters

#### Mobility Parameters
| Parameter | MO | Typical Range | Description |
|-----------|-----|---------------|-------------|
| a3offset | EUtranFreqRelation | 2-4 dB | A3 event threshold |
| hysteresisA3 | EUtranFreqRelation | 1-2 dB | Hysteresis value |
| timeToTriggerA3 | EUtranFreqRelation | 160-320 ms | Time to trigger |

#### Energy Parameters
| Parameter | MO | Description |
|-----------|-----|-------------|
| mimoSleepMode | EUtranCellFDD | Enable MIMO sleep |
| symbolShutdown | EUtranCellFDD | Enable symbol shutdown |
| cellSleepMode | EUtranCellFDD | Enable cell hibernation |

#### Load Balancing Parameters
| Parameter | MO | Description |
|-----------|-----|-------------|
| loadBalancing | LoadBalancingFunction | Enable MLB |
| lbUtilOffloadThreshold | LoadBalancingFunction | Start offloading threshold |
| lbCellCapacity | EUtranCellFDD | Relative cell capacity |

### KPI Thresholds

| KPI | Target | Warning | Critical |
|-----|--------|---------|----------|
| RRC Setup Success Rate | >99.5% | <99.0% | <98.0% |
| E-RAB Setup Success Rate | >99.0% | <98.0% | <97.0% |
| Call Drop Rate | <1.0% | >2.0% | >3.0% |
| HO Success Rate | >98.0% | <95.0% | <90.0% |
| PRB Utilization DL | <70% | >80% | >90% |

## Available Tools

### MCP Tools (`src/tools/ran-tools.ts`)

1. **kpi_analysis** - Analyze KPIs for cells and time ranges
2. **parameter_recommendation** - Get parameter optimization recommendations
3. **feature_activation** - Activate/configure Ericsson features
4. **semantic_search** - Search documentation with natural language
5. **neighbor_analysis** - Analyze neighbor relations
6. **energy_analysis** - Analyze energy consumption

### Usage Examples

```typescript
// KPI Analysis
await ranTools.kpi_analysis.execute({
  cellIds: ['Cell-001', 'Cell-002'],
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-02T00:00:00Z',
  metrics: ['accessibility', 'mobility'],
  granularity: '15min'
});

// Parameter Recommendation
await ranTools.parameter_recommendation.execute({
  cellId: 'Cell-001',
  issue: 'too-early-ho',
  severity: 'major'
});

// Feature Activation (dry run)
await ranTools.feature_activation.execute({
  cxcCode: 'CXC4011808',
  nodeIds: ['eNodeB-001'],
  dryRun: true
});
```

## Workflows

### Optimization Workflow

```bash
# Run mobility optimization on a cluster
npm run optimize -- mobility cluster cluster-north high

# Run energy analysis on entire network
npm run optimize -- energy network all medium

# Full analysis for a site
npm run optimize -- full-analysis site site-123 high
```

### Workflow Types

- **mobility**: Handover optimization, neighbor tuning, MRO/MLB
- **capacity**: PRB utilization, CA activation, load management
- **energy**: Energy saving features, traffic pattern analysis
- **coverage**: Coverage holes, RSRP optimization
- **full-analysis**: Comprehensive analysis across all domains

## Data Paths

| Path | Description |
|------|-------------|
| `./data/enm-exports/` | ENM bulk CM exports |
| `./data/kpi-snapshots/` | 15-minute KPI data |
| `./data/optimization-history/` | Historical optimizations |
| `./data/vectors/` | Ruvector database files |
| `./memory/` | Agent memory storage |
| `./config/features/` | Feature catalog |

## Development Commands

```bash
# Run TypeScript in watch mode
npm run dev

# Build the project
npm run build

# Run tests
npm test

# Initialize vector database
npm run init:vectors

# Start optimization workflow
npm run optimize

# Spawn E2B sandboxes
npm run e2b:spawn
```

## LLM Routing (Agentic-Flow)

The system uses Gemini via agentic-flow for cost-optimized inference:

| Task Type | Model | Use Case |
|-----------|-------|----------|
| Complex reasoning | gemini-1.5-pro | Architecture decisions, debugging |
| Code generation | gemini-1.5-flash | Scripting, automation |
| General tasks | gemini-1.5-flash | Documentation, queries |

Configuration: `config/router.config.json`

## Feature Catalog

The vector database contains 377+ Ericsson RAN features including:

- **Carrier Aggregation**: 31 features (2CC-5CC, SCell management)
- **Dual Connectivity**: 3 features (EN-DC, NR-DC)
- **Energy Efficiency**: 5 features (MIMO Sleep, Symbol Shutdown, Cell Sleep)
- **MIMO Features**: 8 features (Massive MIMO, Beamforming)
- **Mobility**: 27 features (MRO, MLB, ANR, Fast HO)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| E2B sandbox creation failed | Check E2B_API_KEY, verify quota |
| Gemini API error | Check GEMINI_KEY, verify rate limits |
| Vector search empty | Run `npm run init:vectors` |
| Agent not found | Check `.claude/agents/` directory |
| High latency | Use gemini-1.5-flash for routine tasks |
| Memory issues | Reduce batch size for sandbox spawning |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    E2B Sandbox Spawner                          │
│                    (500 sandboxes)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    claude-flow@alpha                            │
│              (Multi-agent Orchestration)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │   RAN    │ │   KPI    │ │ Feature  │ │ Mobility │           │
│  │Optimizer │ │ Analyzer │ │  Expert  │ │Specialist│           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    agentic-flow                                 │
│              (LLM Routing & Proxy)                              │
│         Gemini 1.5 Pro ◄──► Gemini 1.5 Flash                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ruvector                                     │
│              (Vector Database)                                  │
│      Features │ Parameters │ Counters │ Guidelines              │
└─────────────────────────────────────────────────────────────────┘
```

## Contributing

1. Agent definitions: `.claude/agents/`
2. MCP tools: `src/tools/ran-tools.ts`
3. Workflows: `src/workflows/`
4. Feature catalog: `config/features/`

---

*Ericsson RAN Automation Platform v1.0*
*Tools: claude-flow@alpha, agentic-flow, ruvector*
*Infrastructure: E2B Sandboxes (500 instances)*
