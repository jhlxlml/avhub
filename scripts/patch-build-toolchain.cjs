// Build-time compatibility for pinned electron-winstaller 5.4.0 only.
// Its obsolete temp -> rimraf2 -> glob7 chain cannot use patched minimatch11.
// The npm override replaces temp with maintained tmp; adapt the two APIs that
// this exact upstream module actually calls, without changing installer logic.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),requireRoot=createRequire(path.join(root,'package.json'));
const installer=requireRoot.resolve('electron-winstaller/package.json'),requireInstaller=createRequire(installer);
const info=JSON.parse(fs.readFileSync(installer,'utf8'));
if(info.version!=='5.4.0')throw new Error('Review the build-time temp adaptation for changed electron-winstaller');
const replacement=requireInstaller.resolve('temp/package.json'),tmp=JSON.parse(fs.readFileSync(replacement,'utf8'));
if(tmp.name!=='tmp'||tmp.version!=='0.2.7'||!fs.realpathSync(replacement).toLowerCase().startsWith((path.join(root,'node_modules')+path.sep).toLowerCase()))throw new Error('Expected owned temp alias to pinned tmp 0.2.7');
const target=path.join(path.dirname(installer),'lib/temp-utils.js'),source=fs.readFileSync(target,'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const original='b5e0c74a54d7ad23fda2bb709533e4976dd359d872188ba223876ea25a2ab541';
const before='temp.track();\nvar createTempDir = (0, util_1.promisify)(temp.mkdir);';
const after='temp.setGracefulCleanup();\nvar createTempDir = (0, util_1.promisify)(function (prefix, callback) { temp.dir({ prefix: prefix, unsafeCleanup: true }, callback); });';
const reverted=source.replace(after,before);
if(hash(reverted)!==original||!reverted.includes(before))throw new Error('Unexpected electron-winstaller temp-utils bytes; refusing to overwrite');
const patched=reverted.replace(before,after);
if(source!==patched)fs.writeFileSync(target,patched);
console.log('Verified build-only electron-winstaller temp adaptation:',hash(patched));
