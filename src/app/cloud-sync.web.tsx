import { Redirect } from 'expo-router';
export default function CloudRedirect() { return <Redirect href={{ pathname: '/', params: { view: 'settings' } }} />; }
