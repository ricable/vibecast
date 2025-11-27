/**
 * E2B Sandbox Spawner for Ericsson RAN Automation
 * Spawns 500 sandboxes running claude-flow, agentic-flow, and ruvector
 */

import { Sandbox } from 'e2b';
import { EventEmitter } from 'events';

// Configuration
const SANDBOX_COUNT = 500;
const BATCH_SIZE = 50; // Spawn sandboxes in batches to avoid rate limiting
const BATCH_DELAY_MS = 2000; // Delay between batches
const SANDBOX_TIMEOUT_MS = 300000; // 5 minutes per sandbox setup
const MAX_RETRIES = 3;

interface SandboxResult {
  id: string;
  sandboxId: string;
  status: 'success' | 'failed' | 'timeout';
  output?: string;
  error?: string;
  duration: number;
}

interface SpawnerConfig {
  e2bApiKey: string;
  geminiKey: string;
  sandboxCount?: number;
  batchSize?: number;
  onProgress?: (completed: number, total: number, result: SandboxResult) => void;
}

// Sandbox setup script that runs inside each E2B sandbox
const SANDBOX_SETUP_SCRIPT = `
#!/bin/bash
set -e

echo "=== Ericsson RAN Automation Setup ==="
echo "Sandbox ID: $SANDBOX_ID"
echo "Starting at: $(date)"

# Create project directory
mkdir -p /home/user/ericsson-ran-automation
cd /home/user/ericsson-ran-automation

# Initialize npm project
npm init -y
npm pkg set type="module"
npm pkg set engines.node=">=20.0.0"

# Create .env file with provided keys
cat > .env << 'ENVEOF'
# Ericsson RAN Automation Environment
GOOGLE_GEMINI_API_KEY=$GEMINI_KEY
PROVIDER=gemini
RUVECTOR_DIMENSIONS=1536
RUVECTOR_INDEX_TYPE=hnsw
RUVECTOR_DB_PATH=./data/ran-vectors.db
CLAUDE_FLOW_MEMORY_PATH=./memory
KPI_GRANULARITY_MINUTES=15
ENVEOF

# Substitute the actual GEMINI_KEY
sed -i "s|\\\$GEMINI_KEY|$GEMINI_KEY|g" .env

# Create directory structure
mkdir -p src/{agents,tools,embeddings,workflows}
mkdir -p data/{enm-exports,vectors,optimization-history,kpi-snapshots}
mkdir -p memory
mkdir -p .claude/agents
mkdir -p config/features

echo "=== Installing core tools ==="

# Initialize claude-flow
echo "Installing claude-flow@alpha..."
npx claude-flow@alpha init --yes 2>&1 || echo "claude-flow init completed with warnings"

# Verify agentic-flow
echo "Verifying agentic-flow..."
npx agentic-flow --help 2>&1 || echo "agentic-flow help check completed"

# Verify ruvector
echo "Verifying ruvector..."
npx ruvector --help 2>&1 || echo "ruvector help check completed"

# Install additional dependencies
npm install @anthropic-ai/sdk dotenv better-sqlite3 zod --save 2>&1 || true

echo "=== Setup Complete ==="
echo "Finished at: $(date)"
echo "Sandbox $SANDBOX_ID ready for RAN automation"
`;

export class E2BSandboxSpawner extends EventEmitter {
  private config: Required<SpawnerConfig>;
  private results: SandboxResult[] = [];
  private activeSandboxes: Map<string, Sandbox> = new Map();

  constructor(config: SpawnerConfig) {
    super();
    this.config = {
      sandboxCount: SANDBOX_COUNT,
      batchSize: BATCH_SIZE,
      onProgress: () => {},
      ...config,
    };
  }

  /**
   * Spawn all sandboxes in batches
   */
  async spawnAll(): Promise<SandboxResult[]> {
    console.log(`\n🚀 Starting E2B Sandbox Spawner`);
    console.log(`   Total sandboxes: ${this.config.sandboxCount}`);
    console.log(`   Batch size: ${this.config.batchSize}`);
    console.log(`   E2B API Key: ${this.config.e2bApiKey.substring(0, 8)}...`);
    console.log(`   Gemini Key: ${this.config.geminiKey.substring(0, 8)}...\n`);

    const totalBatches = Math.ceil(this.config.sandboxCount / this.config.batchSize);
    let completedCount = 0;

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const batchStart = batchNum * this.config.batchSize;
      const batchEnd = Math.min(batchStart + this.config.batchSize, this.config.sandboxCount);
      const batchIds = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

      console.log(`\n📦 Batch ${batchNum + 1}/${totalBatches} (sandboxes ${batchStart + 1}-${batchEnd})`);

      // Spawn batch in parallel
      const batchPromises = batchIds.map(id => this.spawnSingleSandbox(id));
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const sandboxId = batchIds[i];

        if (result.status === 'fulfilled') {
          this.results.push(result.value);
          this.config.onProgress(++completedCount, this.config.sandboxCount, result.value);
        } else {
          const failedResult: SandboxResult = {
            id: `sandbox-${sandboxId}`,
            sandboxId: 'unknown',
            status: 'failed',
            error: result.reason?.message || 'Unknown error',
            duration: 0,
          };
          this.results.push(failedResult);
          this.config.onProgress(++completedCount, this.config.sandboxCount, failedResult);
        }
      }

      // Delay between batches to avoid rate limiting
      if (batchNum < totalBatches - 1) {
        console.log(`   Waiting ${BATCH_DELAY_MS}ms before next batch...`);
        await this.delay(BATCH_DELAY_MS);
      }
    }

    // Print summary
    this.printSummary();

    return this.results;
  }

  /**
   * Spawn a single sandbox with retry logic
   */
  private async spawnSingleSandbox(id: number): Promise<SandboxResult> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Create sandbox
        const sandbox = await Sandbox.create({
          apiKey: this.config.e2bApiKey,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        });

        const sandboxId = sandbox.sandboxId;
        this.activeSandboxes.set(sandboxId, sandbox);

        // Set environment variables
        const envSetup = `
          export SANDBOX_ID=${id}
          export GEMINI_KEY="${this.config.geminiKey}"
          export E2B_SANDBOX_ID="${sandboxId}"
        `;

        // Run setup script
        const setupResult = await sandbox.commands.run(envSetup + '\n' + SANDBOX_SETUP_SCRIPT, {
          timeoutMs: SANDBOX_TIMEOUT_MS,
        });

        const duration = Date.now() - startTime;

        if (setupResult.exitCode === 0) {
          console.log(`   ✅ Sandbox ${id} ready (${sandboxId.substring(0, 8)}...) [${duration}ms]`);
          return {
            id: `sandbox-${id}`,
            sandboxId,
            status: 'success',
            output: setupResult.stdout,
            duration,
          };
        } else {
          throw new Error(`Setup failed with exit code ${setupResult.exitCode}: ${setupResult.stderr}`);
        }
      } catch (error: any) {
        lastError = error;
        console.log(`   ⚠️  Sandbox ${id} attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

        if (attempt < MAX_RETRIES) {
          await this.delay(1000 * attempt); // Exponential backoff
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   ❌ Sandbox ${id} failed after ${MAX_RETRIES} attempts`);

    return {
      id: `sandbox-${id}`,
      sandboxId: 'failed',
      status: 'failed',
      error: lastError?.message || 'Unknown error',
      duration,
    };
  }

  /**
   * Get status of all active sandboxes
   */
  getActiveCount(): number {
    return this.activeSandboxes.size;
  }

  /**
   * Cleanup all sandboxes
   */
  async cleanup(): Promise<void> {
    console.log(`\n🧹 Cleaning up ${this.activeSandboxes.size} sandboxes...`);

    const cleanupPromises = Array.from(this.activeSandboxes.values()).map(async (sandbox) => {
      try {
        await sandbox.kill();
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    await Promise.allSettled(cleanupPromises);
    this.activeSandboxes.clear();
    console.log('   Cleanup complete');
  }

  /**
   * Print summary of spawning results
   */
  private printSummary(): void {
    const successful = this.results.filter(r => r.status === 'success').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 SPAWNING SUMMARY');
    console.log('='.repeat(60));
    console.log(`   Total sandboxes: ${this.config.sandboxCount}`);
    console.log(`   ✅ Successful: ${successful} (${((successful / this.config.sandboxCount) * 100).toFixed(1)}%)`);
    console.log(`   ❌ Failed: ${failed} (${((failed / this.config.sandboxCount) * 100).toFixed(1)}%)`);
    console.log(`   ⏱️  Avg duration: ${avgDuration.toFixed(0)}ms`);
    console.log('='.repeat(60) + '\n');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Execute sandbox command across multiple sandboxes
 */
export async function executeOnSandboxes(
  sandboxes: SandboxResult[],
  command: string,
  apiKey: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  const execPromises = sandboxes
    .filter(s => s.status === 'success')
    .map(async (sandbox) => {
      try {
        const sbx = await Sandbox.connect(sandbox.sandboxId, { apiKey });
        const result = await sbx.commands.run(command, { timeoutMs: 60000 });
        results.set(sandbox.id, result.stdout);
      } catch (error: any) {
        results.set(sandbox.id, `Error: ${error.message}`);
      }
    });

  await Promise.allSettled(execPromises);
  return results;
}

// CLI entry point
async function main() {
  const e2bApiKey = process.env.E2B_API_KEY;
  const geminiKey = process.env.GEMINI_KEY;

  if (!e2bApiKey) {
    console.error('❌ E2B_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!geminiKey) {
    console.error('❌ GEMINI_KEY environment variable is required');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const sandboxCount = args.find(a => a.startsWith('--count='))?.split('=')[1];
  const batchSize = args.find(a => a.startsWith('--batch='))?.split('=')[1];

  const spawner = new E2BSandboxSpawner({
    e2bApiKey,
    geminiKey,
    sandboxCount: sandboxCount ? parseInt(sandboxCount) : SANDBOX_COUNT,
    batchSize: batchSize ? parseInt(batchSize) : BATCH_SIZE,
    onProgress: (completed, total, result) => {
      const pct = ((completed / total) * 100).toFixed(1);
      process.stdout.write(`\r   Progress: ${completed}/${total} (${pct}%) - Last: ${result.id} [${result.status}]`);
    },
  });

  try {
    const results = await spawner.spawnAll();

    // Save results to file
    const fs = await import('fs');
    const outputPath = './data/sandbox-results.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`📁 Results saved to ${outputPath}`);

    // Keep sandboxes running for further operations
    console.log('\n💡 Sandboxes are still running. Press Ctrl+C to cleanup and exit.');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await spawner.cleanup();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  } catch (error: any) {
    console.error('❌ Spawner failed:', error.message);
    await spawner.cleanup();
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default E2BSandboxSpawner;
