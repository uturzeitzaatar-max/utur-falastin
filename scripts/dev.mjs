import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const configFile = 'wrangler.local.jsonc';
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const database = config.d1_databases[0];
const args = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--strictPort') continue; // Wrangler already fails if the port is occupied.
  args.push(arg === '--host' ? '--ip' : arg);
}

const run = parameters => spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...parameters], {
  stdio: 'inherit',
  env: {...process.env, WRANGLER_SEND_METRICS: 'false'},
});

const migration = run(['d1', 'execute', database.binding, '--config', configFile, '--local',
  '--file', 'migrations/0001_orders.sql']);
if (migration.status !== 0) process.exit(migration.status ?? 1);
const server = run(['pages', 'dev', config.pages_build_output_dir, '--compatibility-date',
  config.compatibility_date, '--d1', database.binding + '=' + database.database_id, ...args]);
process.exitCode = server.status ?? 1;
