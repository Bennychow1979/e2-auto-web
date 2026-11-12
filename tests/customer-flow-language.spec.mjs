import {test,expect} from '@playwright/test';
import {mocks,applicationId} from './fixtures/customer-flow.mjs';
test.beforeEach(async({page,context,baseURL})=>{
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(baseURL).origin)return route.abort();
  if(mocks[url.pathname])return route.fulfill({contentType:'text/javascript; charset=utf-8',body:mocks[url.pathname]});
  return route.continue();
 });
});
test('Chinese loan labels keep original data and enum values across a Malay language switch',async({page})=>{
 await page.goto(`/my-e2.html?lang=zh&application=${applicationId}`);
 await expect(page.locator('.wizardBody h1')).toHaveText('先填写你的资料。');
 await expect(page.locator('#field_name')).toHaveValue('Single');
 await page.locator('#field_marital').selectOption({label:'已婚'});
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect(page.locator('#toast')).toHaveText('申请草稿已保存。');
 await page.getByRole('link',{name:'BM',exact:true}).click();
 await expect(page.locator('.wizardBody h1')).toHaveText('Mulakan dengan butiran anda.');
 await expect(page.locator('#field_marital')).toHaveValue('Married');
 await expect(page.locator('#field_marital option:checked')).toHaveText('Berkahwin');
 await expect(page.locator('#field_name')).toHaveValue('Single');
 await expect(page).toHaveURL(new RegExp(`application=${applicationId}.*lang=ms`));
 await page.getByRole('button',{name:'Dokumen ↗',exact:true}).click();
 await expect(page.locator('#applicantType')).toHaveValue('worker');
 await expect(page.getByRole('heading',{name:'Dokumen diperlukan',exact:true})).toBeVisible();
 await expect(page.locator('#returnLink')).toHaveAttribute('href',new RegExp(`application=${applicationId}.*lang=ms`));
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));expect(width.scroll).toBeLessThanOrEqual(width.viewport);
});
test('Chinese document preview and upload dialog keep filenames and month values unchanged',async({page})=>{
 await page.goto(`/documents.html?application=${applicationId}&lang=zh`);
 await expect(page.locator('.documentFile strong')).toHaveText('Draft.png');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await expect(page.locator('#previewTitle')).toHaveText('Draft.png');
 await expect(page.getByRole('link',{name:'下载文件',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭预览',exact:true}).click();
 await page.locator('[data-add="bank_statement"]').click();
 await expect(page.locator('#uploadTitle')).toHaveText('上传银行结单／交易记录');
 const months=page.locator('#monthChoices input');await expect(months).toHaveCount(3);
 for(const input of await months.all())expect(await input.getAttribute('value')).toMatch(/^\d{4}-\d{2}$/);
 await expect(page.locator('#uploadHint')).toContainText('薪资');
 await expect(page.locator('#uploadDialog')).not.toContainText('Choose one file');
});
test('guest invitation and full privacy notices follow the selected language',async({page})=>{
 await page.goto(`/intake.html?invite=${applicationId}&lang=zh`);
 await expect(page.locator('.intakeHead h1')).toContainText('更简单的第一步。');
 await expect(page.locator('.customerLanguages a[lang="ms"]')).toHaveAttribute('href',new RegExp(`lang=ms&invite=${applicationId}`));
 await page.getByRole('button',{name:'上传文件 ↗',exact:true}).click();
 await expect(page.locator('#kind')).toBeVisible();
 await expect(page.getByRole('button',{name:'提交给我的销售员 →',exact:true})).toBeVisible();
 for(const [file,heading]of [['loan-privacy','你的贷款申请资料。'],['customer-privacy','顾客隐私说明。'],['intake-privacy','你的资料。谨慎处理。']]){
  await page.goto(`/${file}.html?lang=zh`);
  await expect(page.locator('h1')).toHaveText(heading);
  await expect(page.locator('html')).toHaveAttribute('lang','zh-Hans');
  await expect(page.locator('[data-original-language]')).toBeHidden();
  await expect(page.getByRole('link',{name:'e2autosdnbhd@gmail.com'}).first()).toBeVisible();
 }
});
test('submitted progress translates states while retaining staff notes verbatim',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('e2-flow-demo',JSON.stringify({id:'11111111-1111-4111-8111-111111111111',customer_id:'demo',vehicle_id:'11111111-1111-4111-8111-111111111111',vehicle_summary:{name:'DEMO TEST CAR',plate:'DEMO'},status:'Submitted to E2',details:{name:'Single'},last_step:6,updated_at:'2026-11-13T01:00:00Z',revision:1}));});
 await page.goto(`/my-e2.html?application=${applicationId}&lang=zh`);
 await expect(page.locator('#main h1')).toHaveText('已提交给 E2.');
 await expect(page.locator('#loanHistory')).toContainText('待补充资料');
 await expect(page.locator('#loanHistory')).toContainText('Original staff note: Needs information');
 await expect(page.locator('#loanHistory')).toContainText('Please keep this staff note unchanged.');
});
