import {test as base, expect} from '@playwright/test';
import {readFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {
  applicationId, browserFixture, documentDataMock, intakeDataMock, pdfBytes, initializePreviewFixture,
} from './fixtures/preview-fixtures.mjs';

// Parse the emitted module source during test collection, even when Chromium
// cannot launch. Checking the generator alone cannot catch template mistakes.
for (const source of [documentDataMock(false), documentDataMock(true), intakeDataMock()]) {
  await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

const test = base.extend({
  audit: async ({page, context, baseURL}, use) => {
    const audit = {externalRequests: [], pageErrors: []};
    page.on('pageerror', error => audit.pageErrors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL).origin) {
        audit.externalRequests.push(url.href);
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(audit);
    // There must be no backend calls, PDF viewer SaaS requests, or CDN imports.
    expect(audit.externalRequests, 'All preview resources must stay on the local origin').toEqual([]);
    expect(audit.pageErrors, 'Unhandled page errors').toEqual([]);
  },
});

const screens = [
  {name: 'customer Documents', path: `/documents.html?application=${applicationId}`, dialog: '#previewDialog', trigger: '[data-preview="FILE"]'},
  {name: 'staff Documents', path: `/documents.html?application=${applicationId}&staff=1`, dialog: '#previewDialog', trigger: '[data-preview="FILE"]', staff: true},
  {name: 'staff Customer intake', path: '/intake-workspace.html', dialog: '#staffFilePreview', trigger: '[data-file="FILE"]', intake: true},
];

async function installFixture(page, screen) {
  await page.addInitScript(initializePreviewFixture, browserFixture);
  await page.route('**/document-data.js*', route => route.fulfill({contentType: 'text/javascript', body: documentDataMock(Boolean(screen.staff))}));
  await page.route('**/intake-staff-data.js*', route => route.fulfill({contentType: 'text/javascript', body: intakeDataMock()}));
  await page.goto(screen.path);
  if (screen.intake) await page.locator(`[data-open="${applicationId}"]`).click();
  await expect(trigger(page, screen, 'pdf-file')).toBeVisible();
}

const trigger = (page, screen, id) => page.locator(screen.trigger.replace('FILE', id));
const dialog = (page, screen) => page.locator(screen.dialog);
const downloadLink = (page, screen) => dialog(page, screen).getByRole('link', {name: 'Download file', exact: true});

async function waitForPage(page, screen, number) {
  const modal = dialog(page, screen);
  await expect(modal).toBeVisible();
  await expect(modal.getByText(`Page ${number} of 2`, {exact: true})).toBeVisible();
  await expect(modal.locator('.documentPreviewPages canvas')).toHaveCount(1);
  await expect.poll(() => modal.locator('canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return data[0] > 150 && data[2] < 100 ? 'red' : data[2] > 150 && data[0] < 100 ? 'blue' : 'blank';
  })).toBe(number === 1 ? 'red' : 'blue');
}

async function expectNoResources(page, screen) {
  await expect(dialog(page, screen)).not.toBeVisible();
  await expect(dialog(page, screen).locator('canvas, img, a[download]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__previewFixture.liveURLs.size)).toBe(0);
}

async function closePreview(page, screen) {
  await dialog(page, screen).getByRole('button', {name: 'Close preview', exact: true}).click();
  await expectNoResources(page, screen);
}

async function releaseDownload(page, index, settled) {
  await page.evaluate(index => window.__previewFixture.release(index), index);
  await expect.poll(() => page.evaluate(() => window.__previewFixture.settled)).toBe(settled);
  // Let blob inspection and the queued dialog close event finish. This waits on
  // browser frames, not a race-prone fixed storage-download delay.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.beforeEach(async ({page, audit}) => {
      void audit;
      await installFixture(page, screen);
    });

    test('renders both PDF pages locally, stays within the viewport, and preserves download bytes', async ({page}, testInfo) => {
      await trigger(page, screen, 'pdf-file').click();
      await waitForPage(page, screen, 1);
      const modal = dialog(page, screen);
      await expect(modal).toHaveClass(/documentPreview/);
      await expect(modal.getByRole('heading', {name: 'synthetic-two-pages.pdf', exact: true})).toBeVisible();
      await expect(modal.locator('.documentPreviewPrevious')).toBeDisabled();
      await expect(modal.locator('.documentPreviewNext')).toBeEnabled();
      await expect(modal.locator('iframe, object, embed')).toHaveCount(0);
      const bounds = await modal.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
      const canvasBounds = await modal.locator('canvas').boundingBox();
      expect(canvasBounds.width).toBeGreaterThan(100);
      expect(canvasBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(canvasBounds.x + canvasBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      await modal.locator('.documentPreviewNext').click();
      await waitForPage(page, screen, 2);
      await expect(modal.locator('.documentPreviewNext')).toBeDisabled();
      await expect(modal.locator('.documentPreviewPrevious')).toBeEnabled();
      const screenshot = await modal.screenshot();
      await testInfo.attach('local-pdf-second-page', {body: screenshot, contentType: 'image/png'});
      if (process.env.PLAYWRIGHT_SCREENSHOT_DIR && screen.name === 'customer Documents') {
        await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, {recursive: true});
        const device = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop';
        await modal.screenshot({path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `e2-pdf-preview-${device}.png`)});
      }
      const originalViewport = page.viewportSize();
      await page.setViewportSize({width: 844, height: 390});
      await waitForPage(page, screen, 2);
      const landscapeBounds = await modal.boundingBox();
      expect(landscapeBounds.x).toBeGreaterThanOrEqual(0);
      expect(landscapeBounds.x + landscapeBounds.width).toBeLessThanOrEqual(845);
      const landscapeCanvas = await modal.locator('canvas').boundingBox();
      expect(landscapeCanvas.x + landscapeCanvas.width).toBeLessThanOrEqual(landscapeBounds.x + landscapeBounds.width + 1);
      await expect(modal.getByRole('button', {name: 'Close preview'})).toBeVisible();
      await page.setViewportSize(originalViewport);
      await waitForPage(page, screen, 2);
      await modal.locator('.documentPreviewPrevious').click();
      await waitForPage(page, screen, 1);
      const downloading = page.waitForEvent('download');
      await downloadLink(page, screen).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('synthetic-two-pages.pdf');
      expect(await readFile(await download.path())).toEqual(pdfBytes);
      await closePreview(page, screen);
    });

    test('keeps image previews and their download link working', async ({page}) => {
      await trigger(page, screen, 'image-file').click();
      const image = dialog(page, screen).locator('img');
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(dialog(page, screen).locator('canvas')).toHaveCount(0);
      await expect(downloadLink(page, screen)).toHaveAttribute('download', 'synthetic-image.png');
      await expect(downloadLink(page, screen)).toHaveAttribute('href', /^blob:/);
      await closePreview(page, screen);
    });

    test('opens immediately and lets Close cancel a pending download', async ({page}) => {
      await page.evaluate(() => { window.__previewFixture.mode = 'deferred'; });
      await trigger(page, screen, 'pdf-file').click();
      await expect(dialog(page, screen)).toBeVisible();
      await expect(dialog(page, screen)).toContainText(/loading|opening/i);
      await expect(dialog(page, screen).getByRole('button', {name: 'Close preview'})).toBeEnabled();
      await expect.poll(() => page.evaluate(() => window.__previewFixture.pending.length)).toBe(1);
      await closePreview(page, screen);
      await releaseDownload(page, 0, 1);
      await expectNoResources(page, screen);
    });

    test('Escape cancels loading and a later open starts cleanly', async ({page}) => {
      await page.evaluate(() => { window.__previewFixture.mode = 'deferred'; });
      await trigger(page, screen, 'pdf-file').click();
      await expect(dialog(page, screen)).toBeVisible();
      await page.keyboard.press('Escape');
      await expectNoResources(page, screen);
      await releaseDownload(page, 0, 1);
      await expectNoResources(page, screen);
      await page.evaluate(() => { window.__previewFixture.mode = 'ready'; });
      await trigger(page, screen, 'pdf-file').click();
      await waitForPage(page, screen, 1);
      await closePreview(page, screen);
    });

    for (const event of ['SIGNED_OUT', 'USER_UPDATED']) {
      test(`discards a pending private file after ${event === 'SIGNED_OUT' ? 'sign out' : 'an account switch'}`, async ({page}) => {
        await page.evaluate(() => { window.__previewFixture.mode = 'deferred'; });
        await trigger(page, screen, 'pdf-file').click();
        await expect(dialog(page, screen)).toBeVisible();
        await page.evaluate(event => window.__previewFixture.auth(event,
          event === 'SIGNED_OUT' ? null : {user: {id: 'different-authenticated-user'}}), event);
        await expectNoResources(page, screen);
        await releaseDownload(page, 0, 1);
        await expectNoResources(page, screen);
        await expect(page.getByText('synthetic-two-pages.pdf', {exact: true})).not.toBeVisible();
        await expect(page.getByRole('link', {name: /sign in/i})).toBeVisible();
      });
    }

    test('clears an already-rendered private PDF on sign out', async ({page}) => {
      await trigger(page, screen, 'pdf-file').click();
      await waitForPage(page, screen, 1);
      await page.evaluate(() => window.__previewFixture.auth('SIGNED_OUT', null));
      await expectNoResources(page, screen);
      await expect(page.getByText('synthetic-two-pages.pdf', {exact: true})).not.toBeVisible();
    });

    test('repeated opens restart at page one and release every object URL', async ({page}) => {
      for (let cycle = 0; cycle < 3; cycle++) {
        await trigger(page, screen, 'pdf-file').click();
        await waitForPage(page, screen, 1);
        await dialog(page, screen).locator('.documentPreviewNext').click();
        await waitForPage(page, screen, 2);
        await page.keyboard.press('Escape');
        await expectNoResources(page, screen);
      }
      const urls = await page.evaluate(() => ({created: window.__previewFixture.createdURLs, revoked: window.__previewFixture.revokedURLs}));
      expect(urls.created.length).toBeGreaterThanOrEqual(3);
      for (const url of urls.created) expect(urls.revoked).toContain(url);
    });

    test('a stale older open cannot replace the newest file', async ({page}) => {
      await page.evaluate(() => { window.__previewFixture.mode = 'deferred'; });
      // A pair of queued click handlers may begin before a user sees the modal.
      // Dispatch both in one turn to exercise request replacement deterministically.
      await page.evaluate(selectors => selectors.forEach(selector => document.querySelector(selector).click()),
        [screen.trigger.replace('FILE', 'pdf-file'), screen.trigger.replace('FILE', 'image-file')]);
      await expect.poll(() => page.evaluate(() => window.__previewFixture.pending.length)).toBe(2);
      await releaseDownload(page, 1, 1);
      await expect(dialog(page, screen).locator('img')).toBeVisible();
      await expect(downloadLink(page, screen)).toHaveAttribute('download', 'synthetic-image.png');
      await releaseDownload(page, 0, 2);
      await expect(dialog(page, screen).getByRole('heading', {name: 'synthetic-image.png', exact: true})).toBeVisible();
      await expect(dialog(page, screen).locator('img')).toHaveCount(1);
      await expect(dialog(page, screen).locator('canvas')).toHaveCount(0);
      await expect(downloadLink(page, screen)).toHaveAttribute('download', 'synthetic-image.png');
      await closePreview(page, screen);
    });

    test('a corrupt PDF keeps a usable download fallback', async ({page}) => {
      await trigger(page, screen, 'corrupt-file').click();
      await expect(downloadLink(page, screen)).toHaveAttribute('download', 'synthetic-corrupt.pdf');
      await expect(dialog(page, screen)).toContainText(/could not|couldn.t|unable|unavailable|cannot|can.t/i);
      await expect(dialog(page, screen).locator('canvas')).toHaveCount(0);
      await expect(downloadLink(page, screen)).toHaveAttribute('href', /^blob:/);
      const downloading = page.waitForEvent('download');
      await downloadLink(page, screen).click();
      expect((await downloading).suggestedFilename()).toBe('synthetic-corrupt.pdf');
      await closePreview(page, screen);
    });

    test('a renderer loading failure keeps the original PDF downloadable', async ({page}) => {
      await page.route('**/vendor/pdfjs/pdf.mjs*', route => route.abort('failed'));
      await trigger(page, screen, 'pdf-file').click();
      await expect(dialog(page, screen)).toContainText(/could not|couldn.t|unable|unavailable|cannot|can.t/i);
      await expect(downloadLink(page, screen)).toHaveAttribute('download', 'synthetic-two-pages.pdf');
      const downloading = page.waitForEvent('download');
      await downloadLink(page, screen).click();
      const download = await downloading;
      expect(await readFile(await download.path())).toEqual(pdfBytes);
      await closePreview(page, screen);
    });

    test('a failed storage download remains dismissible and can be retried', async ({page}) => {
      await page.evaluate(() => { window.__previewFixture.mode = 'failed'; });
      await trigger(page, screen, 'pdf-file').click();
      await expect(dialog(page, screen)).toBeVisible();
      await expect(dialog(page, screen)).toContainText(/failed|could not|couldn.t|unable/i);
      await expect(downloadLink(page, screen)).toHaveCount(0);
      await closePreview(page, screen);
      await page.evaluate(() => { window.__previewFixture.mode = 'ready'; });
      await trigger(page, screen, 'pdf-file').click();
      await waitForPage(page, screen, 1);
      await closePreview(page, screen);
    });
  });
}
