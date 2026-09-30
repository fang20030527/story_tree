import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../..');
const app=resolve(here,'../app');
const variants=[{id:'ipad',label:'iPad 版',port:8769,cls:'wide ipad-platform'},{id:'mini',label:'小程序版',port:8770,cls:'mini-platform'},{id:'web',label:'网页版',port:8771,cls:'wide web-platform'}];
const files=new Map([
  ...['style.css','data.js','ui.js','screens.js'].map(name=>['/'+name,resolve(app,name)]),
  ['/runtime.js',resolve(app,'app.js')],
  ['/platform.js',resolve(here,'platform.js')],
  ['/platform.css',resolve(here,'platform.css')],
  ['/base.css',resolve(here,'../v2/style.css')],
  ['/assets/InstrumentSerif-Regular.ttf',resolve(here,'../v2/assets/InstrumentSerif-Regular.ttf')],
  ['/assets/SourceSerif4-Regular.ttf',resolve(here,'../assets/SourceSerif4-Regular.ttf')],
  ['/assets/Ionicons.ttf',resolve(root,'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')],
  ['/app/assets/images/black-hole-english-logo.svg',resolve(root,'app/assets/images/black-hole-english-logo.svg')],
  ...['new-cat-species-002.jpg','ai-arms-race.jpg','viking-word-independence-001.webp','secret-agent-sketchbook-011.jpg'].map(name=>['/app/assets/images/editorial/'+name,resolve(root,'app/assets/images/editorial',name)]),
]);
const types={'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf'};
const template=await readFile(resolve(here,'index.html'),'utf8');
for(const variant of variants){
  const html=template.replaceAll('__PLATFORM__',variant.id).replaceAll('__LABEL__',variant.label).replaceAll('__CLASS__',variant.cls);
  createServer(async(req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(path==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:html);return;}
    const file=files.get(path);
    if(!file){res.writeHead(404);res.end('Not found');return;}
    try{const body=await readFile(file);res.writeHead(200,{...headers,'Content-Type':types[extname(file)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);}
    catch{res.writeHead(500);res.end('Preview asset unavailable');}
  }).listen(variant.port,'127.0.0.1',()=>process.stdout.write(`${variant.label}原型：http://127.0.0.1:${variant.port}\n`));
}
