import { nativeQueue } from "@/sync/native-queue";
import Storage from "@/repositories/storage";
let mockOwner = "owner-a";
const mockValues = new Map<string, string>();
jest.mock("@/repositories/storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockValues.set(key, value);
    }),
  },
}));
jest.mock("@/repositories/run-repository", () => ({
  RunRepository: { pagedSource: jest.fn() },
}));
jest.mock("@/sync/firebase", () => ({
  syncClient: (mode: string) => ({
    auth: {
      currentUser: { uid: mockOwner },
      app: { options: { projectId: mode === "production" ? "prod" : "demo" } },
    },
  }),
  firebasePagedTransport: jest.fn(() => ({})),
}));
test("native queue survives navigation as one serialized instance and isolates owner/destination", async () => {
  const first = await nativeQueue("production", "", "owner-a");
  expect(await nativeQueue("production", "", "owner-a")).toBe(first);
  expect(await nativeQueue("emulator", "localhost", "owner-a")).not.toBe(first);
  mockOwner = "owner-b";
  expect(await nativeQueue("production", "", "owner-b")).not.toBe(first);
  expect(jest.mocked(Storage.getItem).mock.calls.map(([key]) => key)).toContain(
    "@runjourney/sync/paged-v2/production/prod/owner-b",
  );
});
test("authentication mismatch fails before opening SQLite queue", async () => {
  const count = jest.mocked(Storage.getItem).mock.calls.length;
  await expect(nativeQueue("production", "", "wrong-owner")).rejects.toThrow(
    "認証ユーザー",
  );
  expect(Storage.getItem).toHaveBeenCalledTimes(count);
});
