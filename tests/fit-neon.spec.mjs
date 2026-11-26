import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {localizedPage} from '../scripts/build-languages.mjs';
const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
async function setup(context,baseURL,lang='en'){
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==new URL(baseURL).origin)return route.abort();
  if(u.pathname==='/test-fit.html')return route.fulfill({contentType:'text/html',body:lang==='en'?source:localizedPage(source,'index.html',lang)});
  return route.continue();
 });
}
for(const lang of ['en','ms','zh'])test(`${lang}: neon loads on view, settles to readable text, preserves heading layout`,async({page,context,baseURL})=>{
 await setup(context,baseURL,lang);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/test-fit.html');
 const heading=page.locator('[data-fit-neon]');
 const original=await heading.textContent();
 await expect(heading.locator('canvas')).toHaveCount(0);
 const before=await heading.boundingBox();
 await heading.scrollIntoViewIfNeeded();
 await expect(heading.locator('canvas')).toHaveCount(1);
 await expect(heading.locator('.e2NeonActive')).toHaveCount(1);
 const after=await heading.boundingBox();
 expect(after.width).toBeCloseTo(before.width,0);expect(after.height).toBeCloseTo(before.height,0);
 await page.waitForTimeout(700); // Capture the middle of the one-time light sweep.
 await page.screenshot({path:`test-results/fit-neon-${lang}-${test.info().project.name}.png`});
 await expect(heading.locator('.e2NeonActive')).toHaveCount(0);
 await expect(heading).toHaveText(original);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(heading.locator('canvas')).toHaveCount(0);
 await expect(heading.locator('.e2NeonText')).toHaveCSS('opacity','1');
 expect(errors.filter(e=>/neon|shader|cleanup|undefined/i.test(e))).toEqual([]);
});
test('reduced motion keeps native heading without loading renderer',async({page,context,baseURL})=>{
 await setup(context,baseURL);await page.emulateMedia({reducedMotion:'reduce'});
 const renderer=[];page.on('request',r=>{if(r.url().includes('fit-neon-renderer'))renderer.push(r.url());});
 await page.goto('/test-fit.html');await page.locator('[data-fit-neon]').scrollIntoViewIfNeeded();
 await expect(page.locator('[data-fit-neon]')).toHaveText('Find your fit.');
 await expect(page.locator('[data-fit-neon] canvas')).toHaveCount(0);expect(renderer).toEqual([]);
});
test('WebGL unavailable leaves original heading visible',async({page,context,baseURL})=>{
 await setup(context,baseURL);
 await context.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args)};});
 await page.goto('/test-fit.html');const h=page.locator('[data-fit-neon]');await h.scrollIntoViewIfNeeded();
 await expect(h.locator('.e2NeonText')).toHaveCSS('opacity','1');await expect(h.locator('canvas')).toHaveCount(0);
});
