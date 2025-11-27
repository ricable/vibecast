/**
 * E2B Sandbox Status Checker
 * Monitors and reports on the status of spawned sandboxes
 */

import { Sandbox } from 'e2b';
import { readFileSync, existsSync } from 'fs';

interface SandboxResult {
  id: string;
  sandboxId: string;
  status: 'success' | 'failed' | 'timeout';
  output?: string;
  error?: string;
  duration: number;
}

interface SandboxHealth {
  sandboxId: string;
  status: 'running' | 'stopped' | 'error';
  uptime?: number;
  memoryUsage?: string;
  lastActivity?: string;
}

async function checkSandboxStatus() {
  const e2bApiKey = process.env.E2B_API_KEY;

  if (!e2bApiKey) {
    console.error('E2B_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('E2B SANDBOX STATUS');
  console.log('='.repeat(60));

  // Load previous results if available
  const resultsPath = './data/sandbox-results.json';

  if (!existsSync(resultsPath)) {
    console.log('\nNo sandbox results found.');
    console.log('Run `npm run e2b:spawn` to create sandboxes first.');
    return;
  }

  const results: SandboxResult[] = JSON.parse(readFileSync(resultsPath, 'utf-8'));

  console.log(`\nLoaded ${results.length} sandbox records\n`);

  // Summary statistics
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');

  console.log('SUMMARY');
  console.log('-'.repeat(40));
  console.log(`Total Sandboxes: ${results.length}`);
  console.log(`Successful: ${successful.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length} (${((failed.length / results.length) * 100).toFixed(1)}%)`);

  // Check health of successful sandboxes
  console.log('\n' + 'HEALTH CHECK');
  console.log('-'.repeat(40));

  const healthChecks: SandboxHealth[] = [];
  const sampleSize = Math.min(10, successful.length);

  console.log(`Checking ${sampleSize} sample sandboxes...`);

  for (let i = 0; i < sampleSize; i++) {
    const sandbox = successful[i];
    try {
      const sbx = await Sandbox.connect(sandbox.sandboxId, { apiKey: e2bApiKey });

      // Run health check command
      const result = await sbx.commands.run('echo "healthy" && uptime', {
        timeoutMs: 10000
      });

      healthChecks.push({
        sandboxId: sandbox.sandboxId,
        status: result.exitCode === 0 ? 'running' : 'error',
        lastActivity: new Date().toISOString()
      });

      console.log(`  ${sandbox.id}: ${result.exitCode === 0 ? '✅ Running' : '❌ Error'}`);
    } catch (error: any) {
      healthChecks.push({
        sandboxId: sandbox.sandboxId,
        status: 'stopped',
        lastActivity: new Date().toISOString()
      });
      console.log(`  ${sandbox.id}: ⚠️ Stopped or unreachable`);
    }
  }

  // Print failed sandboxes
  if (failed.length > 0) {
    console.log('\n' + 'FAILED SANDBOXES');
    console.log('-'.repeat(40));

    for (const sandbox of failed.slice(0, 10)) {
      console.log(`  ${sandbox.id}: ${sandbox.error}`);
    }

    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
  }

  // Duration statistics
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);

  console.log('\n' + 'TIMING');
  console.log('-'.repeat(40));
  console.log(`Average setup time: ${avgDuration.toFixed(0)}ms`);
  console.log(`Min setup time: ${minDuration}ms`);
  console.log(`Max setup time: ${maxDuration}ms`);

  console.log('\n' + '='.repeat(60));
}

// Run status check
checkSandboxStatus().catch(console.error);

export { SandboxHealth };
