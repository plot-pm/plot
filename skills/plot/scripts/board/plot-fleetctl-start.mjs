#!/usr/bin/env node
var u=a=>{let{harnessName:o,harnessBin:t,harnessEnv:n,shadow:s,shadowIsOther:d,platform:i,fleetd:e}=a;if(!t.startsWith("/")){let r=n===""?"PLOT_HARNESS is unset, so the default name 'claude' was looked for.":`PLOT_HARNESS is set to '${n}', so that is the name looked for.`;return`plot-fleetctl: cannot resolve the agent harness '${o}' to a file on PATH
  ${r}
  The unit bakes the harness's directory into its PATH permanently, and a
  worker that cannot find its harness exits 127 after you have moved on.
  Fix it: put the harness on PATH (or set PLOT_HARNESS to its name or
  absolute path), check with 'command -v ${o}', then run this again.`}if(d)return`plot-fleetctl: node's directory holds another '${o.replace(/^.*\//,"")}' (${s})
  The unit puts that directory first, so workers would run it instead of ${t}.
  Fix it: remove or rename it, or use the node from the directory that holds the harness, then run this again.`;if(i==="none")return`plot-fleetctl: neither launchd nor systemd here \u2014 there is no unit to fill
  Run the supervisor by hand instead: node ${e}`},c=a=>{let{label:o,platform:t,loaded:n,pid:s,commit:d,dryRun:i}=a;return n?i?{kind:"preview",message:`would reload ${o} (${t}) \u2014 agents untouched
  supervisor pid: ${s||"unreadable"}
  bundle commit:  ${d||"unknown"}`}:{kind:"reload"}:{kind:"refuse",message:`plot-fleetctl: no unit is loaded under '${o}', so there is no supervisor to restart; nothing was done. Run /plot-fleet --start`}},f=({label:a,platform:o,unit:t,uid:n})=>{if(o==="launchd")return["launchctl","kickstart","-k",`gui/${n}/${a}`];if(o==="systemd")return["systemctl","--user","restart",t]},m=a=>{let{label:o,oldPid:t,newPid:n,commit:s,waitSeconds:d,readCmd:i}=a,e=t||"unreadable";return n===""||n===t?{ok:!1,message:`plot-fleetctl: '${o}' reported no new pid within ${d}s (was ${e}, now ${n||"unreadable"})
  Read it: ${i}`}:{ok:!0,message:`supervisor restarted \u2014 ${o}
  old pid: ${e}
  new pid: ${n}
  bundle commit: ${s||"unknown"}
  agents untouched`}};import{accessSync as g,constants as y,realpathSync as b,statSync as h}from"node:fs";import w from"node:path";import{pathToFileURL as $}from"node:url";var p=a=>new Promise((o,t)=>{let n=()=>{process.exit(a)},s=!1,d=!1,i=()=>{s||(s=!0,d&&n())},e=()=>{d||(d=!0,s&&n())};process.stdout.once("error",r=>{r.code==="EPIPE"&&n()}),process.stderr.once("error",r=>{r.code==="EPIPE"&&n()}),process.stdout.write("",i),process.stderr.write("",e)});var R=(a,o)=>{let t;try{if(t=h(a),!t.isFile())return!1;g(a,y.X_OK)}catch{return!1}try{let n=h(o);return t.dev!==n.dev||t.ino!==n.ino}catch{return!0}},v={probe:6,restart:6,reload:3,restarted:6},P=(a,o=s=>process.stdout.write(s),t=s=>process.stderr.write(s),n=process.getuid?.()??0)=>{let[s,...d]=a,i=s===void 0?void 0:v[s];if(i===void 0||d.length<i)return t(`plot-fleetctl-start: expected one of probe, restart, reload, restarted with its arguments, got '${a.join(" ")}'
`),2;let e=r=>d[r]??"";switch(s){case"probe":{let r=`${w.dirname(e(3))}/${e(0).replace(/^.*\//,"")}`,l=u({harnessName:e(0),harnessBin:e(1),harnessEnv:e(2),shadow:r,shadowIsOther:e(1).startsWith("/")&&R(r,e(1)),platform:e(4),fleetd:e(5)});return l===void 0?0:(t(`${l}
`),1)}case"restart":{let r=c({label:e(0),platform:e(1),loaded:e(2)==="loaded",pid:e(3),commit:e(4),dryRun:e(5)==="1"});return r.kind==="refuse"?(t(`${r.message}
`),1):(r.kind==="preview"&&o(`${r.message}
`),0)}case"reload":{let r=f({label:e(0),platform:e(1),unit:e(2),uid:n});return r===void 0?(t(`plot-fleetctl-start: no reload command for platform '${e(1)}'
`),2):(o(`${r.join(" ")}
`),0)}default:{let r=m({label:e(0),oldPid:e(1),newPid:e(2),commit:e(3),waitSeconds:e(4),readCmd:e(5)});return(r.ok?o:t)(`${r.message}
`),r.ok?0:1}}};process.argv[1]&&import.meta.url===$(b(process.argv[1])).href&&p(P(process.argv.slice(2)));export{P as run,R as shadowIsOther};
