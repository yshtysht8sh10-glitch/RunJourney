// PC-only entry: code under src/test is not imported by any app route/bundle.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const [seed='49',report]=process.argv.slice(2);
if(!/^\d+$/.test(seed))throw Error('Usage: npm run simulate:gps -- SEED [NEW-private-report.json]');
const r=spawnSync(process.execPath,[require.resolve('jest/bin/jest'),'--runInBand','--runTestsByPath','src/utils/__tests__/gps-simulator.test.ts'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',env:{...process.env,RUNJOURNEY_SIM_SEED:seed,...(report?{RUNJOURNEY_SIM_REPORT:path.resolve(report)}:{})}});
process.exitCode=r.status??1;
