import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function createMailer(config,dataDir){
 let transport;
 return {async send(message){
  if(config.mailMode==='file'){
   if(config.production)throw new Error('生产环境禁止文件邮件');
   const folder=path.join(dataDir,'mail-outbox');
   await fs.mkdir(folder,{recursive:true,mode:0o700});
   await fs.writeFile(path.join(folder,Date.now()+'-'+randomUUID()+'.json'),JSON.stringify(message,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});
   return;
  }
  if(!transport){
   const {default:nodemailer}=await import('nodemailer');
   const s=config.smtp;
   transport=nodemailer.createTransport({host:s.host,port:s.port,secure:s.port===465,requireTLS:s.port!==465,auth:{user:s.user,pass:s.pass},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
  }
  await transport.sendMail({from:config.smtp.from,to:message.to,subject:message.subject,text:message.text});
 }};
}
