import { createElement } from 'react';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { Platform,Text,StyleSheet } from 'react-native';
import { DetectorJournalControls,DetectorJournalDetails } from '@/components/detector-journal-controls';
import { DetectorJournal } from '@/services/detector-journal';
jest.mock('expo-application',()=>({applicationId:'app.runjourney.mobile.test'}));
jest.mock('expo-router',()=>({useFocusEffect:(fn:()=>void)=>jest.requireActual('react').useEffect(fn,[fn])}));
jest.mock('@/repositories/run-repository',()=>({RunRepository:{getActiveRun:async()=>null}}));
jest.mock('../../../modules/run-announcer',()=>({__esModule:true,default:{
 detectorJournalOpen:async()=> 'test-capture',detectorJournalOffer:()=>true,detectorJournalStop:()=>undefined,
 detectorJournalList:async()=>JSON.stringify([{id:'test-capture',sealState:'SEALED'}]),
}}));
const label=(tree:ReactTestRenderer)=>tree.root.findByProps({accessibilityLiveRegion:'polite'}).props.children.join('');
beforeEach(()=>{jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');DetectorJournal.stop();});
afterEach(()=>{DetectorJournal.stop();jest.restoreAllMocks();jest.clearAllTimers();jest.useRealTimers();});
test('primary arm action is immediately visible and switches to ARMED with readable styles',async()=>{
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(DetectorJournalControls,{buildGitHash:'test'}));});
 expect(label(tree)).toContain('OFF');
 const button=tree.root.findAll(n=>n.props.accessibilityLabel==="次のRUNの診断をON" && typeof n.props.onPress==="function")[0];
 expect(button.findByType(Text).props.children).toBe('次のRUNの診断をON');
 expect(StyleSheet.flatten(button.findByType(Text).props.style).color).toBe('#FFFFFF');
 await act(async()=>{button.props.onPress();});
 expect(label(tree)).toContain('ARMED');
 expect(DetectorJournal.captureId).toBe('test-capture');
 expect(tree.root.findAll(n=>n.props.accessibilityLabel==="次のRUNの診断をON" && typeof n.props.onPress==="function")[0].props.disabled).toBe(true);
 const run={id:'synthetic-ui',startedAt:new Date(Date.now()).toISOString(),createdAt:'',updatedAt:'',points:[],distanceMeters:0};
 DetectorJournal.begin(run);
 await act(async()=>{jest.advanceTimersByTime(1000);});
 expect(label(tree)).toContain('RECORDING');
 DetectorJournal.end(run);
 await act(async()=>{jest.advanceTimersByTime(1000);});
 expect(label(tree)).toContain('SEALED');
 act(()=>tree.unmount());
});
test('advanced tools are collapsed by default and do not obscure the arm action',async()=>{
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(DetectorJournalDetails,{buildGitHash:'test'}));});
 expect(tree.root.findAllByType(Text).map(t=>t.props.children).join('')).toContain('診断詳細・検証を表示');
 expect(tree.root.findAllByType(Text).map(t=>t.props.children).join('')).not.toContain('人工入力を検証中');
 await act(async()=>{tree.root.findAll(n=>n.props.accessibilityLabel==="診断詳細・検証を表示" && typeof n.props.onPress==="function")[0].props.onPress();});
 expect(tree.root.findAllByType(Text).map(t=>t.props.children).join('')).toContain('実機検証：短時間ON/OFF比較');
 expect(tree.root.findAllByType(Text).find(t=>t.props.selectable)?.props.numberOfLines).toBe(6);
 act(()=>tree.unmount());
});
