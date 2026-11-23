import { JSDOM } from 'jsdom';
import { routeMapHtml } from '@/domain/route-map-html';
const preview={points:[[.88,.39,true],[.881,.391,false]] as [number,number,boolean][],bounds:[.88,.39,.881,.391] as [number,number,number,number],read:2,omitted:0,valid:2};
test('offline renderer makes no tile elements and online renderer overlays a bounded attributed map',()=>{
  const offline=new JSDOM(routeMapHtml(preview,false),{runScripts:'dangerously'});
  expect(offline.window.document.querySelectorAll('image')).toHaveLength(0);
  expect(offline.window.document.querySelector('path')!.getAttribute('d')).toMatch(/^M/);
  expect(offline.window.document.querySelectorAll('circle')).toHaveLength(2);offline.window.close();
  const online=new JSDOM(routeMapHtml(preview,true),{runScripts:'dangerously'});
  const images=online.window.document.querySelectorAll('image');expect(images.length).toBeGreaterThan(0);expect(images.length).toBeLessThanOrEqual(24);
  images.forEach(image=>expect(image.getAttribute('href')).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/));
  expect(online.window.document.getElementById('credit')!.textContent).toContain('OpenStreetMap');
  online.window.document.getElementById('plus')!.click();expect(online.window.document.querySelectorAll('image').length).toBeLessThanOrEqual(24);
  expect(online.window.document.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain("default-src 'none'");online.window.close();
});
