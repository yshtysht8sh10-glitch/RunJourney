import * as Application from 'expo-application';
export const isStandaloneTest = () => Application.applicationId === 'app.runjourney.mobile.test';
