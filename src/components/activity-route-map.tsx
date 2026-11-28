import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import type { PagedRunSource } from '@/domain/pages';

import { routePreview, type RoutePreview } from '@/domain/route-preview';
import { routeMapHtml } from '@/domain/route-map-html';
export function ActivityRouteMap({ loadEnabled, source, onBack }: { loadEnabled: () => Promise<boolean>; source: (id: string) => PagedRunSource; onBack?: (id: string) => void }) {
  const {id}=useLocalSearchParams<{id:string}>();
  const [view,setView]=useState<{id:string;preview:RoutePreview}|null>(null),[message,setMessage]=useState('地図を確認中…'),[tiles,setTiles]=useState(false);
  const preview=view?.id===id?view.preview:null;
  useFocusEffect(useCallback(()=>{let active=true;
    void loadEnabled().then(async enabled=>{
      if(!active)return;if(!enabled){setView(null);setMessage('地図・軌跡は設定でOFFです。');return;}
      if(typeof id!=='string'||!id||id.length>256)throw Error('INVALID_ID');
      const value=await routePreview(source(id),()=>!active);if(active){setView({id,preview:value});setMessage('');}
    }).catch(()=>{if(active){setView(null);setMessage('地図用GPSを読み込めませんでした。元の記録は保持されています。');}});return()=>{active=false;setView(null);setTiles(false);};},[id,loadEnabled,source]));
  const text={color:'#F5F2EB',fontSize:16};
  return <ScrollView style={{flex:1,backgroundColor:'#111418'}} contentContainerStyle={{padding:16,paddingTop:48,gap:16}}>
    <Pressable accessibilityRole="button" style={{minHeight:48,justifyContent:'center'}} onPress={()=>onBack ? onBack(id) : router.back()}><Text style={text}>‹ 走行詳細に戻る</Text></Pressable>
    <Text style={{...text,fontSize:24,fontWeight:'700'}}>地図・軌跡</Text>
    {!!message&&<Text style={text}>{message}</Text>}
    {preview&&<><Text style={text}>保存GPS {preview.read}点 / 描画 {preview.points.length}点。表示用の間引きのみで元GPSは変更しません。無効座標・極域の表示除外 {preview.omitted}点。</Text>
      {preview.valid>0?<><View style={{height:360}}><WebView testID="native-route-map" source={{html:routeMapHtml(preview,tiles)}} originWhitelist={['*']} javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} geolocationEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} mixedContentMode="never" setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} scrollEnabled={false} cacheEnabled userAgent="RunJourney/1.0 (+https://github.com/yshtysht8sh10-glitch/RunJourney)" onShouldStartLoadWithRequest={request=>{if(request.url==='https://www.openstreetmap.org/copyright')void Linking.openURL(request.url).catch(()=>setMessage('地図のライセンスページを開けませんでした。'));return request.url==='about:blank';}} onError={()=>setMessage('地図表示に失敗しました。原GPSは保持されています。')}/></View>
      <Text style={text}>背景地図をONにするとOpenStreetMapへ表示範囲のタイル要求（IPアドレスを含む通信）が送信されます。GPS一覧やRUN IDは送信しません。通信できなくても軌跡は表示できます。</Text>
      <Pressable accessibilityRole="switch" accessibilityState={{checked:tiles}} style={{minHeight:48,padding:14,backgroundColor:'#33424C'}} onPress={()=>setTiles(!tiles)}><Text style={text}>背景地図（通信）{tiles?'ON':'OFF'}</Text></Pressable></>:<Text style={text}>描画できるGPS座標がありません。</Text>}
    </>}
  </ScrollView>;
}
