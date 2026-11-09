import { createElement } from 'react';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { Switch } from 'react-native';
import { GoalCueSettingsPanel } from '@/components/goal-cue-settings';
import { GoalCueSettings } from '@/repositories/goal-cue-settings';
import { resetNative } from '@/test/native-driver';
import { RunRepository } from '@/repositories/run-repository';
import { database } from '@/repositories/database';
jest.mock('expo-router',()=>({useFocusEffect:(fn:()=>void)=>jest.requireActual('react').useEffect(fn,[fn])}));
test('two settings persist independently across remount; old RUN/trash/settings unchanged',async()=>{
 resetNative();await RunRepository.importRuns([{id:'old',startedAt:new Date(0).toISOString(),endedAt:new Date(60000).toISOString(),createdAt:'',updatedAt:'',points:[],distanceMeters:0,trashedAt:1}]);
 const db=await database(),before=await db.snapshot();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(GoalCueSettingsPanel));});expect(tree.root.findAllByType(Switch).map(s=>s.props.value)).toEqual([false,false]);
 await act(async()=>{await tree.root.findAllByType(Switch)[0].props.onValueChange(true);});expect(await GoalCueSettings.get()).toMatchObject({turnaround:true,countdown:false});
 act(()=>tree.unmount());await act(async()=>{tree=create(createElement(GoalCueSettingsPanel));});expect(tree.root.findAllByType(Switch).map(s=>s.props.value)).toEqual([true,false]);
 await act(async()=>{await tree.root.findAllByType(Switch)[1].props.onValueChange(true);});await act(async()=>{await tree.root.findAllByType(Switch)[0].props.onValueChange(false);});expect(await GoalCueSettings.get()).toMatchObject({turnaround:false,countdown:true});
 expect((await db.snapshot()).runs).toEqual(before.runs);expect((await db.snapshot()).protectedIds).toEqual(before.protectedIds);act(()=>tree.unmount());
});
