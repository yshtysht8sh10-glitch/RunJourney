// The runtime persistence code is tested with native SQLite, never a KV memory mock.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => require('./src/test/native-driver').connection,
}));
