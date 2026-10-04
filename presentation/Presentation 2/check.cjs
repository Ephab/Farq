const {chromium}=require('C:/Users/x1Ras/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'msedge'});console.log('browser ready');await b.close()})().catch(e=>{console.error(e.message);process.exit(1)});
