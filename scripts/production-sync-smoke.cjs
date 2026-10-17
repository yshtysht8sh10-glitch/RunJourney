// Opt-in smoke against ONE explicitly named production project, synthetic data only.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!process.argv.includes('--synthetic-only')){console.error('Explicit --synthetic-only required');process.exit(1);}
process.loadEnvFile('.env.local');require('./sqlite-pc-runtime.cjs');
const {productionClient,firebasePagedTransport}=require('../src/sync/firebase.ts');
const {configuredFirebase}=require('../src/sync/firebase-config.ts');
const {createUserWithEmailAndPassword,deleteUser,signOut}=require('firebase/auth');
const {initializeApp,deleteApp}=require('firebase/app');
const {getAuth}=require('firebase/auth');
const {getFirestore,terminate,getDocFromServer,doc}=require('firebase/firestore');
const {sourceFromRun,hashText,iteratePages}=require('../src/domain/pages.ts');
const {demoRuns}=require('../src/web/demo.ts');
const {backupUploadQueue}=require('../src/sync/backup-upload.ts');
const {openPaged}=require('../src/sync/paged-protocol.ts');
const {PagedSyncQueue}=require('../src/sync/paged-protocol.ts');
const {open}=require('./sqlite-pc-runtime.cjs');
const {SqlitePagedStore}=require('../src/repositories/paged-store.ts');
async function main(){
  const config=configuredFirebase();assert.equal(config.projectId,'runjourney-ysht-2026');
  const c=productionClient(),bobApp=initializeApp(config,`synthetic-foreign-${crypto.randomUUID()}`),bob={auth:getAuth(bobApp),db:getFirestore(bobApp)};
  const sqlite = process.argv.includes('--sqlite-source') ? open(':memory:') : null;
  let aliceUser,bobUser;
  try{
    aliceUser=(await createUserWithEmailAndPassword(c.auth,`synthetic-smoke-${crypto.randomUUID()}@example.invalid`,crypto.randomBytes(24).toString('base64url'))).user;
    bobUser=(await createUserWithEmailAndPassword(bob.auth,`synthetic-smoke-${crypto.randomUUID()}@example.invalid`,crypto.randomBytes(24).toString('base64url'))).user;
    const run={...demoRuns(Date.parse('2026-10-17T03:00:00Z'))[0],id:`synthetic-production-smoke-${crypto.randomUUID()}`},before=hashText(JSON.stringify(run)),remote=firebasePagedTransport(c,aliceUser.uid);
    if(sqlite)await sqlite.store.complete(run);
    const source=sqlite ? new SqlitePagedStore(sqlite.store).source(run.id) : sourceFromRun(run);
    const localBefore=sqlite ? hashText(JSON.stringify(await sqlite.store.getRun(run.id))) : before;
    let persisted=null,writes=0,cut=true;
    const interrupted={...remote,putBlob:async(hash,data)=>{if(cut&&++writes===2)throw Error('synthetic interruption');return remote.putBlob(hash,data);}};
    const store=sqlite ? {load:()=>sqlite.store.getSetting('@synthetic/native-sync'),save:value=>sqlite.store.setSetting('@synthetic/native-sync',value)} : {load:async()=>persisted,save:async value=>{persisted=value;}};
    const makeQueue=()=>sqlite ? new PagedSyncQueue(aliceUser.uid,store,()=>source,interrupted) : backupUploadQueue(aliceUser.uid,store,async()=>source,interrupted);
    const queue=makeQueue();await queue.open();await queue.enqueue(run.id);await queue.flush();assert.equal(queue.state[0].status,'retrying');assert.equal(await remote.get(run.id),null);
    cut=false;const reopened=makeQueue();await reopened.open();await reopened.flush(Date.now(),true);assert.equal(reopened.state.length,0);
    const headers=await remote.list();assert.equal(headers.length,1);assert.equal(headers[0].summary.pointCount,run.points.length);
    const loaded=await openPaged(headers[0],aliceUser.uid,remote);let points=0;for await(const page of iteratePages(loaded,'gps'))points+=page.items.length;assert.equal(points,run.points.length);assert.equal(hashText(JSON.stringify(run)),before);
    await assert.rejects(getDocFromServer(doc(bob.db,'runjourney',aliceUser.uid,'pagedRuns',encodeURIComponent(run.id))),e=>e.code==='permission-denied');
    if(sqlite)assert.equal(hashText(JSON.stringify(await sqlite.store.getRun(run.id))),localBefore);
    console.log(JSON.stringify({project:config.projectId,status:'passed',source:sqlite?'isolated-pc-sqlite':'backup-copy',points,partialFailureRecovered:true,foreignReadDenied:true,localSourceUnchanged:true,syntheticOwnerUid:aliceUser.uid,syntheticRunId:run.id}));
  }finally{
    // Account cleanup only. Immutable synthetic Firestore docs are retained as
    // isolated test evidence; never delete an existing user's data through admin.
    if(aliceUser)await deleteUser(aliceUser);else await signOut(c.auth);
    if(bobUser)await deleteUser(bobUser);
    await terminate(c.db);await terminate(bob.db);await deleteApp(c.auth.app);await deleteApp(bobApp);sqlite?.close();
  }
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
