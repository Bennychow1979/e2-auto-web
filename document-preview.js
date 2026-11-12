import {fileType, MAX_BYTES} from './document-fields.js';

// Only the renderer's code/fonts are public. Document bytes come from the caller's
// authenticated Storage download and are never sent to a document-viewer service.
const PDF_ASSETS = new URL('./vendor/pdfjs/', import.meta.url);
let pdfLibrary;
async function loadPDFLibrary() {
  if (!pdfLibrary) pdfLibrary = import('./vendor/pdfjs/pdf.mjs?v=6.4.299').catch(error => {
    pdfLibrary = null;
    throw error;
  });
  const pdfjs = await pdfLibrary;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs?v=6.4.299', PDF_ASSETS).href;
  return pdfjs;
}

export function createDocumentPreview({dialog, title, content, closeButton, download, isCurrent = () => true, translate = (text,values={}) => text.replace(/\{(\w+)\}/g,(m,k)=>values[k]??m)}) {
  let active = null;
  dialog.classList.add('documentPreview');
  content.classList.add('documentPreviewContent');
  dialog.setAttribute('aria-labelledby', title.id);

  function release() {
    const state = active;
    active = null;
    if (state) {
      state.observer?.disconnect();
      state.renderTask?.cancel();
      // destroy() also terminates the private PDF worker and releases its bytes.
      if (state.loadingTask) void state.loadingTask.destroy().catch(() => {});
      if (state.url) URL.revokeObjectURL(state.url);
    }
    content.querySelectorAll('canvas').forEach(canvas => { canvas.width = canvas.height = 1; });
    content.replaceChildren();
    content.removeAttribute('aria-busy');
    title.textContent = translate('Document preview');
  }

  function close() {
    release();
    if (dialog.open) dialog.close();
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // A close event may be queued from a previous open. Never clear a newer preview.
  dialog.addEventListener('close', () => { if (!dialog.open) release(); });
  window.addEventListener('pagehide', close);
  window.addEventListener('popstate', close);

  async function open(file, stillCurrent = isCurrent) {
    release();
    const state = {url: null, loadingTask: null, renderTask: null, observer: null, renderId: 0};
    active = state;
    const current = () => active === state && dialog.open && stillCurrent();
    title.textContent = file.filename;
    const status = document.createElement('p');
    status.className = 'documentPreviewStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = translate('Loading document…');
    const actions = document.createElement('div');
    actions.className = 'documentPreviewActions';
    const pages = document.createElement('div');
    pages.className = 'documentPreviewPages';
    content.append(status, actions, pages);
    content.setAttribute('aria-busy', 'true');
    if (!dialog.open) dialog.showModal();
    closeButton.focus();
    let hasDownload = false;
    try {
      const blob = await download(file.path);
      if (!current()) return;
      if (!blob?.size || blob.size > MAX_BYTES) throw Error('Invalid document size.');
      const mime = await fileType(blob);
      if (!current()) return;
      state.url = URL.createObjectURL(new Blob([blob], {type: mime}));
      const link = document.createElement('a');
      link.className = 'secondary';
      link.href = state.url;
      link.download = file.filename;
      link.textContent = translate('Download file');
      actions.append(link);
      hasDownload = true;
      if (mime !== 'application/pdf') {
        const img = document.createElement('img');
        img.alt = translate('Uploaded document: {name}',{name:file.filename});
        img.onload = () => { if (current()) { status.textContent = translate('Document preview'); content.removeAttribute('aria-busy'); } };
        img.onerror = () => { if (current()) { status.textContent = translate('Preview unavailable. Download this file to open it on your device.'); content.removeAttribute('aria-busy'); } };
        img.src = state.url;
        pages.append(img);
        return;
      }

      status.textContent = translate('Loading PDF preview…');
      const [pdfjs, buffer] = await Promise.all([loadPDFLibrary(), blob.arrayBuffer()]);
      if (!current()) return;
      state.loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: new URL('cmaps/', PDF_ASSETS).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', PDF_ASSETS).href,
        iccUrl: new URL('iccs/', PDF_ASSETS).href,
        wasmUrl: new URL('wasm/', PDF_ASSETS).href,
        isEvalSupported: false,
        enableXfa: false,
      });
      const pdf = await state.loadingTask.promise;
      if (!current()) return;
      let pageNumber = 1;
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'secondary documentPreviewPrevious';
      previous.textContent = translate('Previous page');
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'secondary documentPreviewNext';
      next.textContent = translate('Next page');
      actions.prepend(previous, next);
      const textDetails = document.createElement('details');
      textDetails.className = 'documentPreviewText';
      const summary = document.createElement('summary');
      summary.textContent = translate('Page text');
      const pageText = document.createElement('p');
      textDetails.append(summary, pageText);
      content.append(textDetails);

      async function renderPage() {
        if (!current()) return;
        const renderId = ++state.renderId;
        state.renderTask?.cancel();
        const rendering = () => current() && renderId === state.renderId;
        previous.disabled = next.disabled = true;
        status.textContent = translate('Loading page {page} of {total}…',{page:pageNumber,total:pdf.numPages});
        content.setAttribute('aria-busy', 'true');
        textDetails.hidden = true;
        let page;
        try {
          page = await pdf.getPage(pageNumber);
          if (!rendering()) return;
          const original = page.getViewport({scale: 1});
          const width = Math.max(1, pages.clientWidth);
          const viewport = page.getViewport({scale: width / original.width});
          // Render one page at a time and cap its pixels for mobile memory limits.
          const resolution = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4000000 / (viewport.width * viewport.height)));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width * resolution));
          canvas.height = Math.max(1, Math.floor(viewport.height * resolution));
          canvas.style.width = '100%';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', translate('Page {page} of {total} of {name}. Expand Page text or download for an accessible copy.',{page:pageNumber,total:pdf.numPages,name:file.filename}));
          pages.querySelectorAll('canvas').forEach(old => { old.width = old.height = 1; });
          pages.replaceChildren(canvas);
          state.renderTask = page.render({canvasContext: canvas.getContext('2d'), viewport, transform: [resolution, 0, 0, resolution, 0, 0]});
          await state.renderTask.promise;
          if (!rendering()) return;
          status.textContent = translate('Page {page} of {total}',{page:pageNumber,total:pdf.numPages});
          previous.disabled = pageNumber === 1;
          next.disabled = pageNumber === pdf.numPages;
          content.removeAttribute('aria-busy');
          const text = await page.getTextContent();
          if (!rendering()) return;
          pageText.textContent = text.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') || translate('This page is scanned or has no extractable text. Download it to use your device’s accessibility tools.');
          textDetails.hidden = false;
        } catch (error) {
          if (!rendering()) return;
          status.textContent = translate('This page could not be previewed. Download the file to open it on your device.');
          previous.disabled = pageNumber === 1;
          next.disabled = pageNumber === pdf.numPages;
          content.removeAttribute('aria-busy');
        } finally {
          // PDF.js defers this while any render is active. Release decoded image
          // and operator caches as well as the canvas when pages are revisited.
          page?.cleanup();
        }
      }
      previous.onclick = () => { if (pageNumber > 1) { pageNumber--; content.scrollTop = 0; void renderPage(); } };
      next.onclick = () => { if (pageNumber < pdf.numPages) { pageNumber++; content.scrollTop = 0; void renderPage(); } };
      let lastWidth = pages.clientWidth;
      state.observer = new ResizeObserver(() => {
        const width = pages.clientWidth;
        if (Math.abs(width - lastWidth) < 1) return;
        lastWidth = width;
        void renderPage();
      });
      state.observer.observe(pages);
      await renderPage();
    } catch (error) {
      if (!current()) return;
      status.textContent = hasDownload
        ? translate('PDF preview unavailable. The file may be protected or damaged. Download it to open it on your device.')
        : translate('Could not load this document. Close this preview and try again. If access has changed, sign in again.');
      content.removeAttribute('aria-busy');
    }
  }
  return {open, close};
}
