import { createElement } from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import CloudSync from "@/app/cloud-sync";
import { RunRepository } from "@/repositories/run-repository";
import { nativeQueue } from "@/sync/native-queue";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
let mockRunId: string | undefined;

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ runId: mockRunId }),
}));
jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock("@/sync/firebase", () => ({ syncClient: () => ({ auth: {} }) }));
jest.mock("@/sync/firebase-config", () => ({
  configuredFirebase: () => ({ projectId: "runjourney-ysht-2026" }),
}));
jest.mock("@/sync/native-queue", () => ({ nativeQueue: jest.fn() }));
jest.mock("@/repositories/run-repository", () => ({
  RunRepository: { getReviewPage: jest.fn() },
}));
let tree: ReactTestRenderer;
let queue: { state: unknown[]; enqueue: jest.Mock; flush: jest.Mock };
const run = {
  id: "native-run",
  startedAt: "2026-10-17T00:00:00Z",
  distanceMeters: 1234,
  pointCount: 300,
};
async function press(title: string) {
  await act(async () => {
    await tree.root
      .findAll(
        (n) =>
          typeof n.props.onPress === "function" &&
          typeof n.props.children?.props?.children === "string" &&
          n.props.children.props.children.includes(title),
      )[0]
      .props.onPress();
  });
}
beforeEach(() => {
  mockRunId = undefined;
  queue = {
    state: [],
    enqueue: jest.fn(async (id) => {
      queue.state = [{ id, status: "pending", attempts: 0 }];
    }),
    flush: jest.fn(async () => {
      queue.state = [];
      return [];
    }),
  };
  jest.mocked(nativeQueue).mockResolvedValue(queue as never);
  jest
    .mocked(signInWithEmailAndPassword)
    .mockResolvedValue({ user: { uid: "owner" } } as never);
  jest
    .mocked(RunRepository.getReviewPage)
    .mockResolvedValue([
      run,
      { ...run, id: "trash", trashedAt: 1 },
      { ...run, id: "damaged", error: "broken" },
    ] as never);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.clearAllMocks();
});
test("native login and metadata preview never send; selection excludes trash and broken records, then explicit retry completes", async () => {
  await act(async () => {
    tree = create(createElement(CloudSync));
  });
  await press("ログイン");
  await press("送信対象の履歴を確認");
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(queue.flush).not.toHaveBeenCalled();
  const boxes = tree.root.findAll(
    (n) =>
      n.props.accessibilityRole === "checkbox" &&
      typeof n.props.onPress === "function",
  );
  expect(boxes).toHaveLength(2);
  expect(boxes[1].props.disabled).toBe(true);
  await press("選択した履歴を送信キューへ登録");
  expect(queue.enqueue).toHaveBeenCalledWith("native-run");
  expect(queue.enqueue).toHaveBeenCalledTimes(1);
  expect(queue.flush).not.toHaveBeenCalled();
  await press("キューを送信");
  expect(queue.flush).toHaveBeenCalledWith(expect.any(Number), true);
  expect(JSON.stringify(tree.toJSON())).toContain("キュー送信完了");
  await press("ログアウト");
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain("所有者 UID");
});
test("native authentication errors remain visible and rapid duplicate login is ignored", async () => {
  let reject!: (error: Error) => void;
  jest.mocked(signInWithEmailAndPassword).mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  await act(async () => {
    tree = create(createElement(CloudSync));
  });
  const login = tree.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      n.props.children?.props?.children === "ログイン",
  )[0];
  await act(async () => {
    login.props.onPress();
    login.props.onPress();
  });
  expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("network unavailable"));
  });
  expect(JSON.stringify(tree.toJSON())).toContain("network unavailable");
  expect(nativeQueue).not.toHaveBeenCalled();
});
test('RUN completion shortcut offers only that saved run', async () => {
  mockRunId = 'native-run';
  jest.mocked(RunRepository.getReviewPage).mockResolvedValue([run, { ...run, id: 'another-run' }] as never);
  await act(async () => { tree = create(createElement(CloudSync)); });
  await press('ログイン'); await press('送信対象の履歴を確認');
  expect(tree.root.findAll(n => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function')).toHaveLength(1);
  await press('選択した履歴を送信キューへ登録');
  expect(queue.enqueue).toHaveBeenCalledWith('native-run');
  expect(queue.enqueue).toHaveBeenCalledTimes(1);
});
