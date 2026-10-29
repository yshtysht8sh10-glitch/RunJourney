import { Alert } from 'react-native';
import { bindPaceEditor, paceEditorDirty, requestPaceLeave } from '@/services/pace-edit-guard';
beforeEach(()=>jest.spyOn(Alert,'alert').mockImplementation(()=>{}));
afterEach(()=>jest.restoreAllMocks());
const choose=(label:string)=>{const buttons=jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;buttons.find(b=>b.text===label)!.onPress!();};
test('clean navigation does not prompt; cancel retains unsaved edits; discard replays destination',()=>{
  const action=jest.fn(),discard=jest.fn();let cleanup=bindPaceEditor({dirty:false,save:async()=>{},discard});
  expect(requestPaceLeave(action)).toBe(false);expect(action).toHaveBeenCalledTimes(1);cleanup();
  cleanup=bindPaceEditor({dirty:true,save:async()=>{},discard});requestPaceLeave(action);choose('編集に戻る');expect(paceEditorDirty()).toBe(true);expect(action).toHaveBeenCalledTimes(1);
  requestPaceLeave(action);choose('破棄して移動');expect(discard).toHaveBeenCalledTimes(1);expect(action).toHaveBeenCalledTimes(2);cleanup();
});
test('save must succeed before navigation; failure stays editable and does not mark saved',async()=>{
  let fail=true;const action=jest.fn();const cleanup=bindPaceEditor({dirty:true,save:async()=>{if(fail)throw Error('disk full');},discard:()=>{}});
  requestPaceLeave(action);choose('保存して移動');await Promise.resolve();await Promise.resolve();expect(action).not.toHaveBeenCalled();expect(paceEditorDirty()).toBe(true);
  fail=false;requestPaceLeave(action);choose('保存して移動');await Promise.resolve();expect(action).toHaveBeenCalledTimes(1);expect(paceEditorDirty()).toBe(false);cleanup();
});

test('save-time re-render registration cannot re-prompt the replayed navigation',async()=>{
  let resolve!:()=>void; const saved=new Promise<void>(r=>{resolve=r;});
  const destination=jest.fn();bindPaceEditor({dirty:true,save:()=>saved,discard:()=>{}});
  const replay=()=>requestPaceLeave(destination);
  requestPaceLeave(replay);choose('保存して移動');
  bindPaceEditor({dirty:true,save:async()=>{},discard:()=>{}}); // busy render before save completes
  resolve();await Promise.resolve();
  expect(destination).toHaveBeenCalledTimes(1);expect(Alert.alert).toHaveBeenCalledTimes(1);
});
