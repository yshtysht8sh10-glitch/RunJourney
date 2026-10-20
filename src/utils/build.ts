import * as Application from 'expo-application';
export const isStandaloneTest = () => ['app.runjourney.mobile.test', 'app.runjourney.mobile.pace'].includes(Application.applicationId ?? '');
