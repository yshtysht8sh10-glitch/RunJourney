import Storage from './storage';
export const ROUTE_MAP_KEY = '@runjourney/running/route-map/v1';
export const RouteMapSettings = {
  async get() { return await Storage.getItem(ROUTE_MAP_KEY) === 'on'; },
  async save(enabled: boolean) { await Storage.setItem(ROUTE_MAP_KEY, enabled ? 'on' : 'off'); },
};
