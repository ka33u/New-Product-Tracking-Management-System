import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Explicit, bounded build-policy test. Never sends samples to an HTTP service,
// imports business data, or runs an unbounded parser in the parent process.
const root = path.resolve(process.argv[2] || fileURLToPath(new URL("../", import.meta.url)));
const child = String.raw`
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.cwd(),'package.json'));
const {loadConfigFromFile}=await import(pathToFileURL(require.resolve('vite')));
const config=await loadConfigFromFile({command:'build',mode:'production'},path.join(process.cwd(),'vite.config.ts'));
assert.ok(config,'actual Vite configuration must load');
const plugins=config.config.plugins.flat(Infinity);
const plugin=plugins.find(p=>p?.name==='vinext:image-imports');
assert.equal(typeof plugin?.load,'function');
const vinextEntry=fileURLToPath(import.meta.resolve('vinext'));
const {createMetadataRouteEntryData}=await import(pathToFileURL(path.join(path.dirname(vinextEntry),'server/metadata-route-build-data.js')));
console.log('config-ready');
const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const box=(name,payload=Buffer.alloc(0),declared)=>Buffer.concat([uint(declared??8+payload.length),Buffer.from(name),payload]);
const heif=brand=>Buffer.concat([box('ftyp',Buffer.concat([Buffer.from(brand),uint(0),Buffer.from(brand)])),
 box('meta',Buffer.concat([uint(0),box('iprp',box('ipco',box('ispe',Buffer.concat([uint(0),uint(1),uint(1)]),0)))]))]);
const jxl=Buffer.concat([box('JXL ',Buffer.from([13,10,135,10])),box('ftyp',Buffer.concat([Buffer.from('jxl '),uint(0),Buffer.from('jxl ')])),box('jxlp',uint(0),0)]);
const samples=[
 ['svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'),null],
 ['png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','base64'),null],
 ['icns',Buffer.from([105,99,110,115,0,0,0,16,105,99,48,56,0,0,0,0]),'icns'],
 ['heif',heif('mif1'),'heif'],['heic',heif('heic'),'heif'],['avif',heif('avif'),'heif'],
 ['jxl',jxl,'jxl'],['jxl-stream',Buffer.from([255,10,0,0,0,0,0,0]),'jxl-stream']];
const temp=await mkdtemp(path.join(tmpdir(),'hengda-image-policy-fixtures-'));
try {
 for(const [name,bytes,disabled] of samples){
  // The misleading .png suffix proves content detection, not an extension denylist.
  const file=path.join(temp,name+'.png');await writeFile(file,bytes);
  const route={type:'icon',isDynamic:false,filePath:file,servedUrl:'/icon.png',contentType:'image/png',routePrefix:'/',routeSegments:[]};
  console.log('probe-ready:'+name);
  const result=await plugin.load.call({},'\0vinext-image-meta:'+file);
  assert.equal(result,disabled?'export default {"width":0,"height":0};':'export default {"width":1,"height":1};');
  if(disabled)assert.throws(()=>createMetadataRouteEntryData(route),new RegExp('disabled file type: '+disabled));
  else {const meta=createMetadataRouteEntryData(route);assert.equal(meta.headData.sizes,'1x1');assert.equal(meta.fileDataBase64,bytes.toString('base64'));}
  console.log('probe-passed:'+name);
 }
}finally{await rm(temp,{recursive:true,force:true});}
console.log('policy-runtime-passed');
`;
const result = spawnSync(process.execPath, ["--max-old-space-size=192", "--input-type=module", "-e", child], {
  cwd: root, encoding: "utf8", timeout: 20000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.error, undefined, `bounded policy test failed: ${result.error?.code}`);
assert.equal(result.signal, null, `child terminated: ${result.signal}`);
assert.equal(result.status, 0, "actual framework image paths must obey policy");
assert.match(result.stdout, /policy-runtime-passed/);
