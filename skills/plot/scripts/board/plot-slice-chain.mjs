#!/usr/bin/env node
var i=r=>{if(r.length<=1)return!0;for(let n=1;n<r.length;n++)if(!(r[n].waits_on??[]).includes(r[n-1].branch))return!1;return!0};import{realpathSync as s}from"node:fs";import{pathToFileURL as c}from"node:url";var h=r=>{let n;try{n=JSON.parse(r)}catch{throw new Error(`not valid JSON: '${r}'`)}if(typeof n!="object"||n===null||!Array.isArray(n.branches))throw new Error(`expected an object with a 'branches' array, got '${r}'`);return n.branches},p=r=>i(h(r))?"chained":"uncut",d=(r,n=e=>process.stdout.write(e))=>{let e=r.split(`
`).filter(t=>t.trim()!==""),a=0;for(let t of e)try{n(`${p(t)}
`)}catch(o){process.stderr.write(`plot-slice-chain: ${o.message}
`),a=2}return a};if(process.argv[1]&&import.meta.url===c(s(process.argv[1])).href){let r=[];for await(let n of process.stdin)r.push(n);process.exit(d(Buffer.concat(r).toString("utf8")))}export{p as answer,h as headingFrom,d as run};
