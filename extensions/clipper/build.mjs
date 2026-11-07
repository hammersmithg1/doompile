import {readFile, writeFile, mkdir, rm, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {asciiScript} from './script-encoding.mjs';
import {execFileSync} from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
let commit=process.env.DOOMPILE_BUILD_COMMIT||process.env.GITHUB_SHA;
if(!commit)try{commit=execFileSync('git',['rev-parse','--short=12','HEAD'],{cwd:here,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{commit='development';}
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) {
  throw new Error('Usage: node extensions/clipper/build.mjs [--out-dir <directory>]');
}
// Keep a separate output when a native build runs alongside a live temporary extension.
const outputRoot = args.length ? path.resolve(args[1]) : path.join(here, 'dist');
const sources = ['core.js','transport.js','layout.js','selection.js','content.js','popup.html','popup.css','popup.js','composer.js','composer.css','receipt.html','receipt.css','receipt.js'];
const contracts = await readFile(path.join(here,'src/contracts.js'),'utf8');
const design = await readFile(path.join(here,'src/design.generated.js'),'utf8');
const brand = JSON.parse(await readFile(path.join(here,'../../packages/design/brand.json'),'utf8'));
const designDist = path.join(here,'../../packages/design/dist');
const diagnostics = await build({entryPoints:[path.join(here,'src/diagnostics.ts')],bundle:true,minify:true,write:false,format:'iife',globalName:'DoompileDiagnostics',target:'safari17'});
const core = contracts + '\n' + design + '\n' + diagnostics.outputFiles[0].text + '\n' + await readFile(path.join(here,'src/core.js'),'utf8');
const background = await readFile(path.join(here,'src/background.js'),'utf8');
const telemetry = await build({entryPoints:[path.join(here,'src/telemetry.ts')],bundle:true,minify:true,write:false,format:'iife',globalName:'DoompileTelemetryRuntime',target:'safari17'});
const sharedStyles=await Promise.all(['media.css','blocks.css'].map(name=>readFile(path.join(here,'../../packages/editor/src',name),'utf8')));
const designTokens=await readFile(path.join(here,'../../packages/design/tokens.generated.css'),'utf8');
const composerCSS=designTokens+'\n'+sharedStyles.map(css=>css.replace(/@import[^;]+;/g,'')).join('\n')+'\n'+await readFile(path.join(here,'src/composer.css'),'utf8');
const richEditor=await build({entryPoints:[path.join(here,'src/rich-editor.js')],bundle:true,minify:true,write:false,format:'iife',target:'safari17'});
const editorHash=createHash('sha256').update(richEditor.outputFiles[0].text).digest('hex').slice(0,16);
const editorFile=`rich-editor-${editorHash}.js`;
const editorConfig='globalThis.DoompileEditorBuild='+JSON.stringify({file:editorFile,hash:editorHash})+';\n';
const base = {
  manifest_version:3, name:'Doompile — '+brand.copy.tagline, version:'0.11.0',
  description:'Сохраняй ссылки, статьи, цитаты и моменты видео вместе со своими мыслями.',
  permissions:['activeTab','scripting','storage','unlimitedStorage','alarms','contextMenus'],
  optional_host_permissions:['https://*/*','http://localhost/*','http://127.0.0.1/*'],
  action:{default_title:'Сохранить в Doompile', default_popup:'popup.html', default_icon:{16:'icons/icon-16.png',32:'icons/icon-32.png'}},
  icons:{48:'icons/icon-48.png',128:'icons/icon-128.png'},
  background:{service_worker:'background.js'},
  content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'"}
};

for (const browser of ['chromium','firefox','safari']) {
  const dir=path.join(outputRoot,browser);
  await rm(dir,{recursive:true,force:true});
  await mkdir(path.join(dir,'icons'),{recursive:true});
  const manifest=structuredClone(base);
  if(browser==='chromium')manifest.permissions.push('readingList');
  if (browser === 'firefox') {
    manifest.background={scripts:['background.js']};
    manifest.browser_specific_settings={gecko:{id:'clipper@doompile.app',strict_min_version:'128.0',data_collection_permissions:{required:['websiteContent','browsingActivity']}}};
  }
  if (browser === 'safari') {
    // App Store validation limits Safari extension names to 40 characters.
    manifest.name='Doompile';
    // Safari treats the toolbar artwork as a native monochrome template.
    manifest.action.default_icon={16:'icons/toolbar-16.png',19:'icons/toolbar-19.png',32:'icons/toolbar-32.png',38:'icons/toolbar-38.png'};
    manifest.background={scripts:['background.js'],persistent:false};
    manifest.permissions.push('nativeMessaging');
    manifest.content_scripts=[{matches:['https://*/*','http://*/*'],js:['selection.js'],run_at:'document_idle',all_frames:true}];
    manifest.host_permissions=['http://localhost/*','http://127.0.0.1/*'];
  }
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const buildConfig='globalThis.DoompileBuild='+JSON.stringify({platform:'clipper_'+browser,release:(base.version+'.'+commit).slice(0,80)})+';\n';
  await writeFile(path.join(dir,'background.js'),asciiScript(buildConfig+telemetry.outputFiles[0].text+'\n'+editorConfig+core+'\n'+background));
  for (const name of sources) {
    if(name.endsWith('.js'))await writeFile(path.join(dir,name),asciiScript((name==='core.js'?contracts+'\n'+design+'\n'+diagnostics.outputFiles[0].text+'\n':'')+(name==='composer.js'?design+'\n'+editorConfig+'globalThis.DoompileComposerCSS='+JSON.stringify(composerCSS)+';\n':'')+(name==='receipt.js'?design+'\n':'')+await readFile(path.join(here,'src',name),'utf8')));
    else if(name==='composer.css')await writeFile(path.join(dir,name),composerCSS);
    else if(name==='receipt.css') await writeFile(path.join(dir,name),designTokens+'\n'+await readFile(path.join(here,'src',name),'utf8'));
    else await copyFile(path.join(here,'src',name),path.join(dir,name));
  }
  await writeFile(path.join(dir,editorFile),asciiScript(richEditor.outputFiles[0].text+'\nglobalThis.DoompileRichEditor.build='+JSON.stringify(editorHash)+';'));
  for (const size of [16,32,48,64,96,128,256,512]) await copyFile(path.join(designDist,`app-${size}.png`),path.join(dir,'icons',`icon-${size}.png`));
  for(const size of [16,19,32,38,64,128]) await copyFile(path.join(designDist,`toolbar-${size}.png`),path.join(dir,'icons',`toolbar-${size}.png`));
  console.log(`Built ${path.relative(process.cwd(),dir)}`);
}
