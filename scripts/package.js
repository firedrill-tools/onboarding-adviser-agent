/** Source archive with its npm lock, reproducible tests and fixture generator. */
import { mkdtemp, mkdir, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(await readFile(join(root,'package.json'))),temporary=await mkdtemp(join(tmpdir(),'onboarding-source-'));
const target=resolve(process.argv[2]??join(root,'dist',`${pkg.name}-${pkg.version}.tar.gz`));
try{
  const directory=join(temporary,'package');await mkdir(directory);
  for(const name of ['src','data','fixtures','test','scripts','scenarios','README.md','AGENTS.md','PLAN.md','COMPATIBILITY.md','.env.example','package.json','package-lock.json'])await cp(join(root,name),join(directory,name),{recursive:true});
  await mkdir(dirname(target),{recursive:true});execFileSync('tar',['-czf',target,'-C',temporary,'package'],{stdio:['ignore','pipe','pipe']});console.log(target);
}finally{await rm(temporary,{recursive:true,force:true});}
