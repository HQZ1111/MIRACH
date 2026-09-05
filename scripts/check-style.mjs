import { execSync } from 'node:child_process';
try {
  execSync('node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json', {
    cwd: 'G:/deepseek-harness-master/apps/mirach',
    encoding: 'utf8',
  });
  console.log('TSC-OK');
} catch (e) {
  console.log('TSC-FAIL:');
  console.log(String(e.stdout || '').slice(0, 600));
}
