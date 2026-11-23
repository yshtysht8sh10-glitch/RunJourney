import { useCallback, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RouteMapSettings } from '@/repositories/route-map-settings';
export function RouteMapEntry({id}:{id:string}) {
  const [enabled,setEnabled]=useState(false);
  useFocusEffect(useCallback(()=>{let active=true;void RouteMapSettings.get().then(value=>{if(active)setEnabled(value);}).catch(()=>{if(active)setEnabled(false);});return()=>{active=false;};},[]));
  return enabled?<Pressable testID="open-route-map" accessibilityRole="button" style={{minHeight:48,padding:14,borderWidth:1,borderColor:'#607D72',borderRadius:10}} onPress={()=>router.push({pathname:'/run-map',params:{id}})}><Text style={{color:'#F5F2EB',fontSize:16}}>地図・軌跡を見る</Text></Pressable>:null;
}
