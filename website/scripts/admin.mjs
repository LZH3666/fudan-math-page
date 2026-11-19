import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {loadConfig} from '../config.mjs';
import {migrateGovernance,recordAction} from '../governance.mjs';

// Local operator command. Public registration never calls this code.
const [action,username,...rest]=process.argv.slice(2);
if(action!=='promote'||!username||rest.length)throw new Error('用法：node --env-file=/path/site.env scripts/admin.mjs promote 用户名');
const config=loadConfig(process.env);
if(!fs.existsSync(config.dbPath))throw new Error('数据库不存在；请先启动站点并注册、验证账号');
const db=new DatabaseSync(config.dbPath);
try{
 migrateGovernance(db);
 db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 const user=db.prepare('SELECT id,role,email_verified_at,blocked FROM users WHERE username_key=?').get(username.normalize('NFKC').toLowerCase());
 if(!user||!user.email_verified_at||user.blocked)throw new Error('只能提升已经验证邮箱且未封禁的现有账号');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
 db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
 recordAction(db,{action:'user.promote',targetType:'user',targetId:user.id,before:{role:user.role},after:{role:'admin'},reason:'本机维护者通过管理员命令设置'});
 db.exec('COMMIT');console.log('管理员设置完成；请重新登录。');
}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}finally{db.close()}
