import { parseFirebaseConfig } from '../../sync/firebase-config';
const config = { projectId:'runjourney-owned-test',apiKey:'public-web-api-key',authDomain:'runjourney-owned-test.firebaseapp.com',appId:'1:123:web:abc' };
test('only explicit public Web configuration can enable production', () => {
  expect(parseFirebaseConfig(JSON.stringify(config))).toEqual(config);
  expect(()=>parseFirebaseConfig(undefined)).toThrow('未設定');
});
test.each([
  {...config,projectId:'demo-runjourney'},
  {...config,authDomain:'different-project.firebaseapp.com'},
  {...config,appId:'1:123:android:abc'},
  {...config,private_key:'not-a-real-key'},
  {...config,apiKey:''},
])('reject wrong project, emulator and secret-bearing configuration', value => {
  expect(()=>parseFirebaseConfig(JSON.stringify(value))).toThrow();
});
