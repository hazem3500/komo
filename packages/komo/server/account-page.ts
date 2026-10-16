// The hosted account page: sign in with Google, then create, list and revoke
// personal access tokens for bots and CI. Rendered with DOM APIs only (no
// innerHTML), under a nonce-based CSP.
const css = `
:root{--bg:#fff;--surface:#f7f7f9;--fg:#1d1d1f;--fg2:#6e6e73;--fg3:#6f6f75;--accent:#c8b5f4;--accent-fg:#352a50;--line:#0000001a;--danger:#b3261e;--ok:#1d7a46;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1e;--surface:#262629;--fg:#eeeef0;--fg2:#b0afb7;--fg3:#a4a2ad;--accent:#d3bdf5;--line:#ffffff1f;--danger:#ff8a80;--ok:#7fd69f;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
a{color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.skip{position:absolute;left:12px;top:-60px;background:var(--surface);padding:8px 12px;border-radius:8px;z-index:5}
.skip:focus{top:12px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:760px;margin:0 auto;padding:28px 24px 0}
.brand{font-size:24px;font-weight:600;letter-spacing:-.8px;color:var(--accent);text-decoration:none}
.who{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--fg2);min-width:0}
.who img,.who .initial{width:28px;height:28px;border-radius:50%;flex:none;background:var(--surface);display:grid;place-items:center;font-weight:600;color:var(--fg2)}
.who span.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:44px 24px 96px}
h1{font-size:32px;letter-spacing:-1.2px;line-height:1.15;font-weight:600;margin:0 0 10px}
.lede{margin:0;color:var(--fg2);max-width:560px}
.bar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:28px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border:0;border-radius:12px;background:var(--surface);color:var(--fg);font-weight:500;box-shadow:inset 0 0 0 1px var(--line);transition:background .15s,transform .15s}
.btn:hover{background:var(--line)}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--accent);color:var(--accent-fg);box-shadow:inset 0 1px 0 #ffffff40,0 2px 4px #0002}
.btn.primary:hover{filter:brightness(1.05)}
.btn.danger{color:var(--danger)}
.btn[disabled]{opacity:.55;cursor:default}
.panel{background:var(--surface);border-radius:16px;box-shadow:inset 0 0 0 1px var(--line)}
.notice{padding:20px 22px;color:var(--fg2)}
.notice strong{display:block;color:var(--fg);font-weight:600;margin-bottom:4px}
.notice.error{color:var(--danger)}
.tokens{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.token{padding:18px 20px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:start}
.token h2{margin:0;font-size:16px;font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.mono{font-family:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:13px;color:var(--fg2);overflow-wrap:anywhere}
.badge{font-size:12px;font-weight:500;line-height:1;padding:5px 8px;border-radius:999px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg2)}
.badge.warn{color:var(--danger)}
.meta{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px 20px;margin:10px 0 0;font-size:13px}
.meta div{min-width:0}
.meta dt{color:var(--fg3);font-size:12px;margin-bottom:2px}
.meta dd{margin:0;overflow-wrap:anywhere}
.skeleton{height:96px;border-radius:16px;background:linear-gradient(90deg,var(--surface),var(--line),var(--surface));background-size:200% 100%;animation:shimmer 1.4s infinite}
@keyframes shimmer{to{background-position:-200% 0}}
dialog{width:min(480px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;border:0;border-radius:20px;padding:0;background:var(--bg);color:var(--fg);box-shadow:0 0 0 1px var(--line),0 24px 60px -12px #0007}
dialog::backdrop{background:#0006;backdrop-filter:blur(2px)}
dialog[open]{animation:pop .18s ease-out}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}}
form,.reveal{padding:24px;display:grid;gap:18px}
dialog h2{margin:0;font-size:20px;letter-spacing:-.4px}
label.field,fieldset{display:grid;gap:6px;border:0;margin:0;padding:0;min-width:0;font-size:14px}
legend,label.field>span{font-weight:500;padding:0}
input[type=text],select{min-height:44px;padding:0 12px;border-radius:10px;border:0;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);width:100%}
.choice{display:flex;align-items:center;gap:10px;min-height:36px;color:var(--fg)}
.choice input{width:18px;height:18px;accent-color:var(--accent);margin:0}
.choice small{color:var(--fg3)}
.projects{display:grid;gap:2px;max-height:160px;overflow:auto;padding:6px 10px;border-radius:10px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.hint{color:var(--fg3);font-size:13px;margin:0}
.actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.secret{display:flex;gap:8px;align-items:stretch}
.secret code{flex:1;min-width:0;padding:12px;border-radius:10px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font:13px/1.5 ui-monospace,"SFMono-Regular",Consolas,monospace;overflow-wrap:anywhere;user-select:all}
.warning{padding:12px 14px;border-radius:10px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;margin:0}
.error-text{color:var(--danger);font-size:14px;margin:0}
.live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
[hidden]{display:none!important}
@media (max-width:560px){main{padding-top:32px}h1{font-size:28px}.bar{flex-direction:column;align-items:stretch}.bar .btn{width:100%}.token{grid-template-columns:1fr}.token .btn{width:100%}.secret{flex-direction:column}.actions .btn{flex:1}.who span.name{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const script = `
const cfg=JSON.parse(document.getElementById("cfg").textContent);
const $=(s)=>document.querySelector(s);
const KEY="komo-account-session";
let session=null,user=null,data=null;
const el=(tag,props,...kids)=>{const n=document.createElement(tag);for(const k in props||{}){if(k==="class")n.className=props[k];else if(k.startsWith("on"))n.addEventListener(k.slice(2),props[k]);else if(props[k]===true)n.setAttribute(k,"");else if(props[k]!==false&&props[k]!=null)n.setAttribute(k,props[k])}n.append(...kids.flat().filter((x)=>x!=null));return n};
const live=(t)=>{$("#live").textContent="";setTimeout(()=>{$("#live").textContent=t},30)};
const date=(t)=>new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(new Date(t));
const ago=(t)=>{if(!t)return "Never";const s=Math.max(0,(Date.now()-t)/1000);if(s<90)return "Just now";if(s<5400)return Math.round(s/60)+" min ago";if(s<129600)return Math.round(s/3600)+" hr ago";return date(t)};
async function api(path,method,body){
  const r=await fetch(cfg.base+path+"?project="+encodeURIComponent(cfg.project),{method:method||"GET",headers:{...(session?{Authorization:"Bearer "+session}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  let j={};try{j=await r.json()}catch{}
  if(r.status===401&&session&&path!=="/auth/google/start"){session=null;sessionStorage.removeItem(KEY);user=null;render()}
  if(!r.ok){const e=new Error(j.error||"Request failed ("+r.status+").");e.status=r.status;throw e}
  return j}
function view(name){for(const v of ["loading","signin","guest","tokens"])$("#v-"+v).hidden=v!==name}
function render(){
  const header=$("#who");header.replaceChildren();
  if(!session||!user){view(session?"loading":"signin");return}
  const google=user.verified&&String(user.id).startsWith("google:");
  header.append(user.avatarUrl?el("img",{src:user.avatarUrl,alt:"",referrerpolicy:"no-referrer"}):el("span",{class:"initial","aria-hidden":"true"},(user.name||"?").slice(0,1).toUpperCase()),el("span",{class:"name"},user.name),el("button",{class:"btn",type:"button",onclick:signOut},"Sign out"));
  if(!google){view("guest");return}
  view("tokens");list()}
function list(){
  const ul=$("#list");ul.replaceChildren();
  if(!data){ul.append(el("li",{class:"skeleton"}));return}
  $("#empty").hidden=data.tokens.length>0;
  for(const t of data.tokens){
    const scopes=t.scopes.join(", ");
    const projects=t.projects?t.projects.join(", "):"All projects";
    ul.append(el("li",{class:"panel token"},
      el("div",null,el("h2",null,t.name,t.expired?el("span",{class:"badge warn"},"Expired"):null),el("div",{class:"mono"},t.prefix+"…"+t.last4)),
      el("button",{class:"btn danger",type:"button","aria-label":"Revoke "+t.name,onclick:()=>confirmRevoke(t)},"Revoke"),
      el("dl",{class:"meta"},
        meta("Scopes",scopes),meta("Projects",projects),meta("Created",date(t.createdAt)),meta("Expires",t.expiresAt?date(t.expiresAt):"Never"),meta("Last used",ago(t.lastUsedAt)))))}}
const meta=(k,v)=>el("div",null,el("dt",null,k),el("dd",null,v));
async function load(){
  try{data=await api("/account/tokens");list()}
  catch(e){if(e.status===403)view("guest");else if(e.status!==401){$("#list").replaceChildren(el("li",{class:"panel notice error"},e.message))}}}
async function boot(){
  session=sessionStorage.getItem(KEY);
  if(!session){render();return}
  view("loading");
  try{user=(await api("/me")).user;render();await load()}catch(e){if(e.status!==401){view("signin");$("#signin-error").textContent=e.message}}}
async function signIn(){
  const btn=$("#signin");btn.disabled=true;$("#signin-error").textContent="";
  const popup=window.open("about:blank","komo-account-auth","width=500,height=700");
  try{
    const {url}=await api("/auth/google/start","POST");
    if(!popup){throw new Error("Allow pop-ups to sign in with Google.")}
    popup.location.href=url;
    await new Promise((resolve,reject)=>{
      const done=(fn,v)=>{removeEventListener("message",on);clearInterval(poll);fn(v)};
      const on=(e)=>{if(e.origin!==location.origin||e.source!==popup||e.data?.type!=="branch-comments:auth")return;session=e.data.token;sessionStorage.setItem(KEY,session);user=e.data.user;done(resolve)};
      const poll=setInterval(()=>{if(popup.closed&&!session)done(reject,new Error("Sign-in was cancelled."))},600);
      addEventListener("message",on)});
    render();await load()
  }catch(e){try{popup&&popup.close()}catch{}$("#signin-error").textContent=e.message}finally{btn.disabled=false}}
async function signOut(){
  try{await api("/me","DELETE")}catch{}
  session=null;user=null;data=null;sessionStorage.removeItem(KEY);render()}

const dlg=$("#create"),rev=$("#reveal"),conf=$("#confirm");
$("#new").onclick=()=>{
  $("#form").reset();$("#form-error").textContent="";
  const has=data&&data.projects.length>0;
  $("#project-scope").hidden=!has;
  const box=$("#project-list");box.replaceChildren(...(data?data.projects:[]).map((p)=>el("label",{class:"choice"},el("input",{type:"checkbox",name:"project",value:p}),p)));
  box.hidden=true;
  dlg.showModal();$("#name").focus()};
for(const r of document.querySelectorAll("input[name=limit]"))r.onchange=()=>{$("#project-list").hidden=document.querySelector("input[name=limit]:checked").value!=="some"};
$("#cancel").onclick=()=>dlg.close();
$("#form").onsubmit=async(e)=>{
  e.preventDefault();
  const f=e.target,b=$("#submit");$("#form-error").textContent="";
  const scopes=[...f.querySelectorAll("input[name=scope]:checked")].map((i)=>i.value);
  if(!scopes.length){$("#form-error").textContent="Choose at least one scope.";return}
  const some=f.querySelector("input[name=limit]:checked").value==="some";
  const projects=some?[...f.querySelectorAll("input[name=project]:checked")].map((i)=>i.value):[];
  if(some&&!projects.length){$("#form-error").textContent="Choose at least one project, or allow all projects.";return}
  const days=f.expiry.value;
  b.disabled=true;
  try{
    const r=await api("/account/tokens","POST",{name:f.tokenName.value.trim(),scopes,projects,expiresInDays:days==="never"?null:Number(days)});
    dlg.close();
    $("#secret").textContent=r.token;$("#copy").textContent="Copy";
    rev.showModal();$("#copy").focus();live("Token created. Copy it now; it will not be shown again.");
    data.tokens.unshift(r.item);list();
  }catch(err){$("#form-error").textContent=err.message}finally{b.disabled=false}};
$("#copy").onclick=async()=>{
  const t=$("#secret").textContent;
  try{await navigator.clipboard.writeText(t)}catch{const r=document.createRange();r.selectNodeContents($("#secret"));getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand&&document.execCommand("copy")}
  $("#copy").textContent="Copied";live("Token copied to clipboard.")};
$("#done").onclick=()=>{rev.close()};
rev.addEventListener("close",()=>{$("#secret").textContent=""});
rev.addEventListener("cancel",(e)=>{if(!confirm("Close without copying? This token will not be shown again."))e.preventDefault()});
let target=null;
function confirmRevoke(t){target=t;$("#confirm-text").textContent="Revoke \\u201C"+t.name+"\\u201D? Anything using it stops working immediately. This can\\u2019t be undone.";$("#confirm-error").textContent="";conf.showModal()}
$("#keep").onclick=()=>conf.close();
$("#revoke").onclick=async()=>{
  const b=$("#revoke");b.disabled=true;
  try{await api("/account/tokens/"+target.id,"DELETE");data.tokens=data.tokens.filter((t)=>t.id!==target.id);conf.close();list();live("Token revoked.");$("#new").focus()}
  catch(e){$("#confirm-error").textContent=e.message}finally{b.disabled=false}};
$("#signin").onclick=signIn;
$("#guest-out").onclick=signOut;
boot();
`;

export function accountPage(env: Env, url: URL) {
  const nonce = crypto.randomUUID();
  const configured = Object.keys(JSON.parse(env.PROJECTS));
  const requested = url.searchParams.get("project");
  // Hosted sign-in uses the management project; self-hosted servers use one of their own.
  const project =
    env.KOMO_HOSTED === "true"
      ? "_komo"
      : requested && configured.includes(requested)
        ? requested
        : (configured[0] ?? "_komo");
  const config = JSON.stringify({
    base: env.KOMO_PUBLIC_PATH ?? "",
    project,
  }).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Access tokens · komo</title><link rel="icon" href="data:,"><style nonce="${nonce}">${css}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="/">komo</a><div class="who" id="who"></div></header>
<main id="main">
<div id="v-loading"><div class="skeleton"></div></div>
<section id="v-signin" hidden><h1>Access tokens</h1><p class="lede">Sign in with Google to create tokens that let bots and CI use the komo CLI as you.</p><p><button class="btn primary" id="signin" type="button">Continue with Google</button></p><p class="error-text" id="signin-error" role="alert"></p></section>
<section id="v-guest" hidden><h1>Access tokens</h1><div class="panel notice"><strong>Sign in with Google to manage tokens</strong><span>Guest sessions can’t create access tokens, because a token would carry an identity that can’t be verified.</span></div><p><button class="btn" id="guest-out" type="button">Sign out</button></p></section>
<section id="v-tokens" hidden>
<div class="bar"><div><h1>Access tokens</h1><p class="lede">Use a token as <code class="mono">KOMO_TOKEN</code> so bots and CI can read or write comments as you. Treat tokens like passwords.</p></div><button class="btn primary" id="new" type="button">New token</button></div>
<ul class="tokens" id="list" aria-label="Your access tokens"></ul>
<div class="panel notice" id="empty" hidden><strong>No tokens yet</strong>Create one for a bot, a script, or a CI job.</div>
</section>
</main>
<dialog id="create" aria-labelledby="create-title"><form id="form" novalidate><h2 id="create-title">New access token</h2>
<label class="field"><span>Name</span><input id="name" name="tokenName" type="text" required maxlength="60" autocomplete="off" placeholder="e.g. Deploy bot"></label>
<label class="field"><span>Expiration</span><select name="expiry"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">No expiration</option></select></label>
<fieldset><legend>Scopes</legend><label class="choice"><input type="checkbox" name="scope" value="comments:read" checked>comments:read <small>list and read threads</small></label><label class="choice"><input type="checkbox" name="scope" value="comments:write">comments:write <small>create, reply, resolve</small></label></fieldset>
<fieldset id="project-scope"><legend>Projects</legend><label class="choice"><input type="radio" name="limit" value="all" checked>All projects you can access</label><label class="choice"><input type="radio" name="limit" value="some">Only selected projects</label><div class="projects" id="project-list" hidden></div></fieldset>
<p class="error-text" id="form-error" role="alert"></p>
<div class="actions"><button class="btn" id="cancel" type="button">Cancel</button><button class="btn primary" id="submit" type="submit">Create token</button></div></form></dialog>
<dialog id="reveal" aria-labelledby="reveal-title"><div class="reveal"><h2 id="reveal-title">Copy your token</h2><p class="warning">This is the only time it will be shown. Store it in your secret manager, never in source control.</p><div class="secret"><code id="secret" tabindex="0" aria-label="Access token"></code><button class="btn primary" id="copy" type="button">Copy</button></div><div class="actions"><button class="btn" id="done" type="button">Done</button></div></div></dialog>
<dialog id="confirm" aria-labelledby="confirm-title"><div class="reveal"><h2 id="confirm-title">Revoke token</h2><p id="confirm-text" class="hint"></p><p class="error-text" id="confirm-error" role="alert"></p><div class="actions"><button class="btn" id="keep" type="button">Keep token</button><button class="btn danger" id="revoke" type="button">Revoke</button></div></div></dialog>
<div class="live" id="live" role="status" aria-live="polite"></div>
<script type="application/json" id="cfg">${config}</script>
<script nonce="${nonce}">${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      },
    }
  );
}
