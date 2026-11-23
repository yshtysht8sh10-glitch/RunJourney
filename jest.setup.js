// The runtime persistence code is tested with native SQLite, never a KV memory mock.
// Android is the supported native integration target. jest-expo otherwise defaults
// to iOS, whose storage is deliberately blocked until legacy compatibility exists.
// Platform-specific compatibility tests provide their own iOS/web mocks.
Object.defineProperty(require('react-native').Platform, 'OS', { value: 'android', configurable: true });
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({ ...require('./src/test/native-driver').connection, closeAsync: async () => undefined }),
}));
