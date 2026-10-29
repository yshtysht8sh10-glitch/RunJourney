import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { bindPaceEditor, paceEditorDirty, requestPaceLeave } from '@/services/pace-edit-guard';
export function usePaceLeaveGuard(dirty: boolean, save: () => Promise<void>, discard: () => void) {
  const navigation = useNavigation();
  useFocusEffect(useCallback(() => {
    const unbind = bindPaceEditor({ dirty, save, discard });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!paceEditorDirty()) return false;
      requestPaceLeave(() => { if(navigation.canGoBack()) navigation.goBack(); else BackHandler.exitApp(); }); return true;
    });
    const remove = navigation.addListener('beforeRemove', event => {
      if (!paceEditorDirty()) return;
      event.preventDefault(); requestPaceLeave(() => navigation.dispatch(event.data.action));
    });
    return () => { unbind(); back.remove(); remove(); };
  }, [dirty, save, discard, navigation]));
}
