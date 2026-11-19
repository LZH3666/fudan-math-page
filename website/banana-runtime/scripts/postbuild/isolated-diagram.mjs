import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
// Private broker credentials remain in the parent's environment; never emitted.
export function isolatedDiagram(input){return new Promise((resolve,reject)=>{
 const script=process.env.FUDAN_ISOLATED_DIAGRAM_SCRIPT||fileURLToPath(new URL('../../../isolated-diagram.mjs',import.meta.url));const child=spawn(process.execPath,[script],{env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('隔离图形排版超时'))},180000);
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>28*1024*1024){child.kill();reject(new Error('图形输出过大'))}});child.stderr.on('data',b=>stderr=(stderr+b).slice(-3000));child.stdin.on('error',()=>{});child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error(stderr||'隔离图形编译失败'));return}try{resolve(JSON.parse(stdout))}catch{reject(new Error('隔离图形结果无效'))}});child.stdin.end(JSON.stringify(input));
})}
