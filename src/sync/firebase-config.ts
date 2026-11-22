export type CloudMode = 'production' | 'emulator';
export type PublicFirebaseConfig = { apiKey: string; authDomain: string; projectId: string; appId: string; storageBucket?: string };
export function parseFirebaseConfig(text: string | undefined): PublicFirebaseConfig {
  if (!text?.trim()) throw new Error('本番Firebaseが未設定です。EXPO_PUBLIC_RUNJOURNEY_FIREBASE_CONFIGを設定してWeb/アプリを再ビルドしてください');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || ['private_key','client_email','refresh_token'].some(k => k in value)) throw new Error('Web用firebaseConfigを指定してください。秘密鍵は使用しません');
  for (const key of ['apiKey','authDomain','projectId','appId']) if (typeof value[key] !== 'string' || !value[key].trim() || /\s/.test(value[key])) throw new Error(`Firebase設定が不正です: ${key}`);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.projectId) || value.projectId.startsWith('demo-')) throw new Error('本番用Project IDが不正です');
  if (value.authDomain !== `${value.projectId}.firebaseapp.com`) throw new Error('authDomainとProject IDが一致しません');
  if (!value.appId.includes(':web:')) throw new Error('FirebaseのWebアプリ構成を指定してください');
  return { apiKey:value.apiKey, authDomain:value.authDomain, projectId:value.projectId, appId:value.appId, ...(typeof value.storageBucket === 'string' ? {storageBucket:value.storageBucket} : {}) };
}
export function configuredFirebase() {
  return parseFirebaseConfig(process.env.EXPO_PUBLIC_RUNJOURNEY_FIREBASE_CONFIG);
}
