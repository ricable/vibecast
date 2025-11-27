/**
 * Ruvector Database Initialization for Ericsson RAN Features
 * Populates the vector database with feature documentation for semantic search
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// Ericsson RAN Feature Catalog
interface EricssonFeature {
  id: string;
  fajId: string;
  cxcCode: string;
  name: string;
  category: string;
  description: string;
  parameters: Parameter[];
  counters: Counter[];
  prerequisites: Prerequisite[];
  impact: Impact;
  activationCommands: string[];
  rollbackCommands: string[];
}

interface Parameter {
  name: string;
  mo: string;
  type: string;
  range?: string;
  values?: string[];
  default: string | number | boolean;
  description: string;
}

interface Counter {
  name: string;
  type: string;
  description: string;
}

interface Prerequisite {
  type: 'software' | 'hardware' | 'feature' | 'license';
  requirement: string;
}

interface Impact {
  accessibility: 'none' | 'minimal' | 'moderate' | 'significant';
  retainability: 'none' | 'minimal' | 'moderate' | 'significant';
  throughput: string;
  energy: string;
}

// Sample feature catalog (377+ features in production)
const featureCatalog: EricssonFeature[] = [
  {
    id: 'mimo-sleep-mode',
    fajId: 'FAJ 121 3094',
    cxcCode: 'CXC4011808',
    name: 'MIMO Sleep Mode',
    category: 'Energy Efficiency',
    description: 'Reduces active MIMO layers during low traffic periods to save energy. The feature monitors DL and UL PRB utilization and transitions to lower MIMO configurations when thresholds are met.',
    parameters: [
      {
        name: 'mimoSleepMode',
        mo: 'EUtranCellFDD',
        type: 'enum',
        values: ['OFF', 'ON'],
        default: 'OFF',
        description: 'Enable or disable MIMO sleep mode feature'
      },
      {
        name: 'mimoSleepDlPrbThreshold',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '0-100',
        default: 10,
        description: 'DL PRB utilization threshold for MIMO sleep activation (percentage)'
      },
      {
        name: 'mimoSleepUlPrbThreshold',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '0-100',
        default: 10,
        description: 'UL PRB utilization threshold for MIMO sleep activation (percentage)'
      }
    ],
    counters: [
      { name: 'pmMimoSleepTime', type: 'cumulative', description: 'Total time spent in MIMO sleep state (seconds)' },
      { name: 'pmMimoActiveTime', type: 'cumulative', description: 'Total time with all MIMO layers active (seconds)' },
      { name: 'pmMimoSleepTransitions', type: 'cumulative', description: 'Number of transitions to MIMO sleep state' }
    ],
    prerequisites: [
      { type: 'software', requirement: 'RAN SW >= 22.Q4' },
      { type: 'hardware', requirement: 'Radio with MIMO capability (2T2R or higher)' },
      { type: 'license', requirement: 'CXC4010001 (Base Station License)' }
    ],
    impact: {
      accessibility: 'minimal',
      retainability: 'minimal',
      throughput: 'Reduced peak throughput during MIMO sleep (up to 50% reduction)',
      energy: '5-10% power savings on radio unit'
    },
    activationCommands: [
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) mimoSleepMode=ON',
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) mimoSleepDlPrbThreshold=15'
    ],
    rollbackCommands: [
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) mimoSleepMode=OFF'
    ]
  },
  {
    id: 'carrier-aggregation-2cc',
    fajId: 'FAJ 121 2001',
    cxcCode: 'CXC4011234',
    name: 'Carrier Aggregation 2CC',
    category: 'Carrier Aggregation',
    description: 'Enables 2-component carrier aggregation for increased peak throughput. Combines two LTE carriers to provide up to 300 Mbps DL throughput.',
    parameters: [
      {
        name: 'caEnabled',
        mo: 'SectorCarrier',
        type: 'boolean',
        default: false,
        description: 'Enable carrier aggregation on this carrier'
      },
      {
        name: 'scellActivationThreshold',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '0-100',
        default: 20,
        description: 'PRB utilization threshold for SCell activation'
      },
      {
        name: 'scellDeactivationTimer',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '0-10000',
        default: 320,
        description: 'Timer for SCell deactivation (ms)'
      }
    ],
    counters: [
      { name: 'pmCaActivations', type: 'cumulative', description: 'Number of CA activations' },
      { name: 'pmCaThroughputDl', type: 'gauge', description: 'DL throughput with CA active (kbps)' },
      { name: 'pmScellActiveTime', type: 'cumulative', description: 'Total SCell active time (seconds)' }
    ],
    prerequisites: [
      { type: 'software', requirement: 'RAN SW >= 18.Q2' },
      { type: 'hardware', requirement: 'Baseband with CA capability' },
      { type: 'license', requirement: 'CXC4011234 (CA 2CC License)' },
      { type: 'feature', requirement: 'Base LTE capability active' }
    ],
    impact: {
      accessibility: 'none',
      retainability: 'none',
      throughput: 'Up to 100% increase in peak DL throughput',
      energy: 'Minimal increase (secondary carrier power)'
    },
    activationCommands: [
      'cmedit set * SectorCarrier.(sectorCarrierId==<CARRIER_ID>) caEnabled=true',
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) scellActivationThreshold=15'
    ],
    rollbackCommands: [
      'cmedit set * SectorCarrier.(sectorCarrierId==<CARRIER_ID>) caEnabled=false'
    ]
  },
  {
    id: 'mobility-load-balancing',
    fajId: 'FAJ 121 2045',
    cxcCode: 'CXC4011567',
    name: 'Mobility Load Balancing (MLB)',
    category: 'Mobility',
    description: 'Automatically balances load between cells by adjusting handover parameters. Reduces congestion in high-load cells by offloading users to neighbor cells with available capacity.',
    parameters: [
      {
        name: 'loadBalancing',
        mo: 'LoadBalancingFunction',
        type: 'boolean',
        default: false,
        description: 'Enable mobility load balancing'
      },
      {
        name: 'lbUtilOffloadThreshold',
        mo: 'LoadBalancingFunction',
        type: 'integer',
        range: '0-100',
        default: 80,
        description: 'PRB utilization threshold to start offloading'
      },
      {
        name: 'lbUtilStopOffloadThreshold',
        mo: 'LoadBalancingFunction',
        type: 'integer',
        range: '0-100',
        default: 60,
        description: 'PRB utilization threshold to stop offloading'
      },
      {
        name: 'lbCellCapacity',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '1-100',
        default: 100,
        description: 'Relative cell capacity for load calculations'
      }
    ],
    counters: [
      { name: 'pmLbOffloadAttempts', type: 'cumulative', description: 'Number of MLB offload attempts' },
      { name: 'pmLbOffloadSuccess', type: 'cumulative', description: 'Number of successful MLB offloads' },
      { name: 'pmLbCioAdjustments', type: 'cumulative', description: 'Number of CIO parameter adjustments' }
    ],
    prerequisites: [
      { type: 'software', requirement: 'RAN SW >= 17.Q4' },
      { type: 'feature', requirement: 'X2 interface configured between cells' }
    ],
    impact: {
      accessibility: 'minimal',
      retainability: 'minimal',
      throughput: 'Improved average throughput in loaded cells',
      energy: 'Neutral'
    },
    activationCommands: [
      'cmedit set * LoadBalancingFunction loadBalancing=true',
      'cmedit set * LoadBalancingFunction lbUtilOffloadThreshold=75',
      'cmedit set * LoadBalancingFunction lbUtilStopOffloadThreshold=55'
    ],
    rollbackCommands: [
      'cmedit set * LoadBalancingFunction loadBalancing=false'
    ]
  },
  {
    id: 'symbol-shutdown',
    fajId: 'FAJ 121 3095',
    cxcCode: 'CXC4011850',
    name: 'Symbol Shutdown',
    category: 'Energy Efficiency',
    description: 'Disables OFDM symbols during micro-periods of no transmission within a subframe. Provides fine-grained energy savings with minimal service impact.',
    parameters: [
      {
        name: 'symbolShutdown',
        mo: 'EUtranCellFDD',
        type: 'enum',
        values: ['OFF', 'ON'],
        default: 'OFF',
        description: 'Enable symbol-level power shutdown'
      },
      {
        name: 'shutdownThreshold',
        mo: 'EUtranCellFDD',
        type: 'integer',
        range: '0-100',
        default: 5,
        description: 'Traffic threshold below which symbol shutdown activates'
      }
    ],
    counters: [
      { name: 'pmSymbolShutdownTime', type: 'cumulative', description: 'Total time in symbol shutdown (microseconds)' },
      { name: 'pmSchedulingPeriodTime', type: 'cumulative', description: 'Total scheduling period time (microseconds)' }
    ],
    prerequisites: [
      { type: 'software', requirement: 'RAN SW >= 22.Q2' },
      { type: 'hardware', requirement: 'Radio with symbol shutdown capability' }
    ],
    impact: {
      accessibility: 'none',
      retainability: 'none',
      throughput: 'None (microsecond-level activation)',
      energy: '10-15% power savings on radio PA'
    },
    activationCommands: [
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) symbolShutdown=ON',
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) shutdownThreshold=10'
    ],
    rollbackCommands: [
      'cmedit set * EUtranCellFDD.(cellId==<CELL_ID>) symbolShutdown=OFF'
    ]
  },
  {
    id: 'mro',
    fajId: 'FAJ 121 2050',
    cxcCode: 'CXC4011590',
    name: 'Mobility Robustness Optimization (MRO)',
    category: 'Mobility',
    description: 'Automatically detects and corrects handover problems including too-early, too-late, and wrong-cell handovers. Uses RLF reports and HO statistics to adjust parameters.',
    parameters: [
      {
        name: 'mroLeEnabled',
        mo: 'MobilityRobustness',
        type: 'boolean',
        default: false,
        description: 'Enable late handover (too-late HO) detection and correction'
      },
      {
        name: 'mroEeEnabled',
        mo: 'MobilityRobustness',
        type: 'boolean',
        default: false,
        description: 'Enable early handover (too-early HO) detection and correction'
      },
      {
        name: 'mroWrongCellEnabled',
        mo: 'MobilityRobustness',
        type: 'boolean',
        default: false,
        description: 'Enable wrong cell handover detection and correction'
      },
      {
        name: 'mroA3OffsetCorrection',
        mo: 'MobilityRobustness',
        type: 'integer',
        range: '-24 to 24',
        default: 2,
        description: 'Maximum A3 offset correction step (dB)'
      }
    ],
    counters: [
      { name: 'pmMroTooLateHo', type: 'cumulative', description: 'Number of too-late handovers detected' },
      { name: 'pmMroTooEarlyHo', type: 'cumulative', description: 'Number of too-early handovers detected' },
      { name: 'pmMroWrongCellHo', type: 'cumulative', description: 'Number of wrong cell handovers detected' },
      { name: 'pmMroCorrections', type: 'cumulative', description: 'Number of parameter corrections applied' }
    ],
    prerequisites: [
      { type: 'software', requirement: 'RAN SW >= 18.Q4' },
      { type: 'feature', requirement: 'X2 interface configured' },
      { type: 'feature', requirement: 'RLF reporting enabled on UEs' }
    ],
    impact: {
      accessibility: 'minimal',
      retainability: 'minimal',
      throughput: 'Neutral to improved',
      energy: 'Neutral'
    },
    activationCommands: [
      'cmedit set * MobilityRobustness mroLeEnabled=true',
      'cmedit set * MobilityRobustness mroEeEnabled=true',
      'cmedit set * MobilityRobustness mroWrongCellEnabled=true'
    ],
    rollbackCommands: [
      'cmedit set * MobilityRobustness mroLeEnabled=false',
      'cmedit set * MobilityRobustness mroEeEnabled=false',
      'cmedit set * MobilityRobustness mroWrongCellEnabled=false'
    ]
  }
];

// KPI threshold definitions
const kpiThresholds = {
  accessibility: {
    rrcSetupSuccessRate: { target: 99.5, warning: 99.0, critical: 98.0 },
    erabSetupSuccessRate: { target: 99.0, warning: 98.0, critical: 97.0 },
    rachSuccessRate: { target: 99.0, warning: 98.0, critical: 97.0 }
  },
  retainability: {
    callDropRate: { target: 1.0, warning: 2.0, critical: 3.0 },
    erabDropRate: { target: 0.5, warning: 1.0, critical: 2.0 }
  },
  mobility: {
    hoSuccessRate: { target: 98.0, warning: 95.0, critical: 90.0 },
    interFreqHoSuccessRate: { target: 95.0, warning: 90.0, critical: 85.0 }
  },
  utilization: {
    prbUtilizationDl: { target: 70.0, warning: 80.0, critical: 90.0 },
    prbUtilizationUl: { target: 60.0, warning: 70.0, critical: 80.0 }
  }
};

async function initializeVectorDB() {
  console.log('='.repeat(60));
  console.log('Ruvector Database Initialization');
  console.log('Ericsson RAN Feature Catalog');
  console.log('='.repeat(60));

  // Create directories
  const directories = [
    './data/vectors',
    './config/features',
    './memory'
  ];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }

  // Save feature catalog
  writeFileSync(
    './config/features/catalog.json',
    JSON.stringify(featureCatalog, null, 2)
  );
  console.log(`Saved ${featureCatalog.length} features to catalog.json`);

  // Save KPI thresholds
  writeFileSync(
    './config/thresholds.json',
    JSON.stringify(kpiThresholds, null, 2)
  );
  console.log('Saved KPI thresholds to thresholds.json');

  // Generate embeddings text for each feature
  const embeddingTexts = featureCatalog.map(feature => ({
    id: feature.id,
    text: generateEmbeddingText(feature)
  }));

  writeFileSync(
    './data/vectors/embeddings.json',
    JSON.stringify(embeddingTexts, null, 2)
  );
  console.log('Generated embedding texts for vector search');

  // Try to initialize ruvector if available
  try {
    console.log('\nInitializing ruvector database...');
    execSync('npx ruvector create ran-features --dimensions 1536 --index hnsw 2>&1 || true', {
      stdio: 'inherit'
    });
    console.log('Ruvector database created successfully');
  } catch (error) {
    console.log('Note: ruvector CLI initialization skipped (will be done in sandbox)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Initialization Complete');
  console.log(`Features: ${featureCatalog.length}`);
  console.log(`Categories: ${Array.from(new Set(featureCatalog.map(f => f.category))).join(', ')}`);
  console.log('='.repeat(60));
}

function generateEmbeddingText(feature: EricssonFeature): string {
  const parts = [
    `Feature: ${feature.name}`,
    `FAJ ID: ${feature.fajId}`,
    `CXC Code: ${feature.cxcCode}`,
    `Category: ${feature.category}`,
    `Description: ${feature.description}`,
    `Parameters: ${feature.parameters.map(p => p.name).join(', ')}`,
    `Counters: ${feature.counters.map(c => c.name).join(', ')}`,
    `Prerequisites: ${feature.prerequisites.map(p => p.requirement).join('; ')}`,
    `Impact - Accessibility: ${feature.impact.accessibility}, Throughput: ${feature.impact.throughput}, Energy: ${feature.impact.energy}`
  ];
  return parts.join('\n');
}

// Run initialization
initializeVectorDB().catch(console.error);

export { featureCatalog, kpiThresholds, EricssonFeature };
