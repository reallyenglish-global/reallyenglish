import { provisionLeadSchema } from './twenty-schema.mjs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const container = execFileSync('docker',['compose','-f','compose.ci.yml','ps','-q','twenty-server'],{encoding:'utf8'}).trim();
const inspect = JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
const network = Object.values(inspect.NetworkSettings.Networks)[0];
if (!network || !/^172\.|^192\.168\.|^10\./.test(network.IPAddress)) throw new Error('invalid_sandbox_ip');
const base = `http://${network.IPAddress}:3000`;
console.log(JSON.stringify({stage:'transport',sandboxIP:network.IPAddress,ports:inspect.NetworkSettings.Ports}));
const mask = value => { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`); return value; };
let stage = 'signup';
async function gql(query, variables, token) {
  const response = await fetch(`${base}/metadata`, {method:'POST', headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json', ...(token ? {authorization:`Bearer ${token}`} : {})}, body:JSON.stringify({query,variables}), signal:AbortSignal.timeout(300000)});
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    // Only schema/error codes are safe to log, never API bodies or tokens.
    console.error(JSON.stringify({stage,status:response.status,codes:result.errors?.map(e=>e.extensions?.code || 'graphql_error'),messages:result.errors?.map(e=>e.message.replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]').slice(0,240))}));
    throw new Error(`bootstrap_${stage}_failed`);
  }
  return result.data;
}
try {
 const email = `ci-${process.env.GITHUB_RUN_ID || Date.now()}@example.invalid`;
 // Pinned auth.util.ts PASSWORD_REGEX is /^.{8,50}$/; 24 hex bytes + suffix exceeded 50.
 const password = mask(`${randomBytes(20).toString('hex')}Aa!7`);
 const signup = await gql('mutation($email:String!,$password:String!){signUp(email:$email,password:$password){tokens{accessOrWorkspaceAgnosticToken{token}}}}',{email,password});
 const agnostic = mask(signup.signUp.tokens.accessOrWorkspaceAgnosticToken.token);
 stage='workspace';
 const created = await gql('mutation($input:SignUpInNewWorkspaceInput!){signUpInNewWorkspace(input:$input){workspace{id workspaceUrls{subdomainUrl customUrl}} loginToken{token}}}',{input:{displayName:'CI disposable',subdomain:`ci-${process.env.GITHUB_RUN_ID || Date.now()}`}},agnostic);
 const workspace = created.signUpInNewWorkspace.workspace;
 const login = mask(created.signUpInNewWorkspace.loginToken.token);
 stage='exchange';
 const origin = workspace.workspaceUrls.customUrl || workspace.workspaceUrls.subdomainUrl || base;
 if (new URL(origin).hostname !== 'localhost') throw new Error('workspace_not_loopback');
 const exchanged = await gql('mutation($loginToken:String!,$origin:String!){getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin){tokens{accessOrWorkspaceAgnosticToken{token}}}}',{loginToken:login,origin});
 const access = mask(exchanged.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token);
 stage='activate';
 await gql('mutation{activateWorkspace(data:{displayName:"CI disposable"}){id}}',{},access);
 stage='api_key';
 let output;
 // CLI allows DEVELOPMENT or TEST. TEST prefixes cache keys integration-tests:
 // (pinned get-cache-storage-key.util.ts), so its role-target invalidation cannot
 // reach the production server/worker namespace. DEVELOPMENT shares their keys.
 try { output = execFileSync('docker',['compose','-f','compose.ci.yml','exec','-T','-e','NODE_ENV=development','twenty-server','yarn','command:prod','workspace:generate-api-key','--workspace-id',workspace.id,'--name','ci-synthetic','--expires-in','1'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000}); }
 catch { throw new Error('key_command_failed'); }
 const matches = [...output.matchAll(/TOKEN:\s*([A-Za-z0-9_.-]+)/g)];
 if(matches.length!==1) throw new Error('key_missing_or_ambiguous');
 const apiKey = mask(matches[0][1]);
 stage='metadata';
 const response = await fetch(`${base}/rest/metadata/objects`,{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error(`metadata_http_${response.status}`);
 const metadata = await response.json();
 stage='lead_schema';
 const schema = await provisionLeadSchema(base,access);
 await provisionLeadSchema(base,access); // Idempotency on the same workspace.
 stage='runtime_permissions';
 // Compare identical authenticated reads before any app/proxy transport; no rows
 // or credentials are logged. This distinguishes principal/cache from proxy bugs.
 for(const [principal,token] of [['api-key',apiKey],['workspace-admin',access]]) {
  for(const path of ['/rest/companies?limit=1','/rest/websiteLeads?limit=1']) {
   const res=await fetch(base+path,{headers:{authorization:`Bearer ${token}`,host:'localhost:3000'},signal:AbortSignal.timeout(30000)});
   console.log(JSON.stringify({stage,principal,path,status:res.status}));
  }
 }
 mkdirSync('.ci/private',{recursive:true,mode:0o700});
 writeFileSync('.ci/private/twenty.json',JSON.stringify({apiKey,base,workspaceId:workspace.id}),{mode:0o600});
 console.log(JSON.stringify({stage:'bootstrap_complete',workspaceId:workspace.id,metadataResponseKeys:Object.keys(metadata),fullSiteAcceptance:false}));
} catch(error) { console.error(JSON.stringify({stage,error:error.message,cause:error.cause?.code})); process.exitCode=1; }
