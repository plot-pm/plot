#!/usr/bin/env node
var d=r=>r.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),p=r=>new RegExp(`(?:^|[/\\s"'=])${d(r)}(?:$|[\\s"';&|)])`),c=(r,t,n)=>{let e=r.trim(),s=`set 'Worker command' to '${t.command}'`;return e===""?{start:"unconfigured",repair:`${s}, which /plot-dispatch offers to write`}:e.toLowerCase()==="none"?{start:"declined"}:n==="assigned"||p(t.name).test(e)?{start:"run",command:e}:{start:"refused",why:`the 'Worker command' does not run ${t.name}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,repair:`${s}, and move the harness call into .plot/worker-prompt.sh \u2014 plot-install-prompt.sh writes one from the template`}};import{realpathSync as m}from"node:fs";import{pathToFileURL as u}from"node:url";var a={ok:0,usage:2,refused:3},g=(r,t,n=e=>process.stdout.write(e))=>{let[e="",s="",i=""]=t;if(e!=="free"&&e!=="assigned"||s===""||i==="")return a.usage;let o=c(r,{name:s,command:i},e);switch(o.start){case"run":return n(`run	${o.command}
`),a.ok;case"unconfigured":return n(`unconfigured	${o.repair}
`),a.ok;case"declined":return n(`declined
`),a.ok;case"refused":return n(`${o.why}
${o.repair}
`),a.refused}};if(process.argv[1]&&import.meta.url===u(m(process.argv[1])).href){let r=[];for await(let t of process.stdin)r.push(t);process.exit(g(Buffer.concat(r).toString("utf8"),process.argv.slice(2)))}export{a as EXIT,g as run};
