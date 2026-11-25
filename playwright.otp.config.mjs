import base from './playwright.config.mjs';
export default {...base,webServer:{...base.webServer,command:'node tests/serve.mjs'}};
