#!/usr/bin/env node
var c=(e,o,u)=>{let i=e.reduce((p,a)=>p+a.rows,0),n=e.at(-1),r=n?.envelopeNext??"unknown";return{stops:n===void 0||r!=="present"||i>=o||n.rows===0||e.length>=Math.ceil(o/u),rows:Math.min(i,o),envelopeNext:i>o?"present":r}};var d=e=>typeof e!="object"||e===null||Array.isArray(e)||!Object.hasOwn(e,"values")||!Object.hasOwn(e,"page")?"unknown":Object.hasOwn(e,"next")?"present":"absent";import{readFileSync as w,realpathSync as f,writeFileSync as y}from"node:fs";import{pathToFileURL as m}from"node:url";var b=10,N=(e,o,u=n=>process.stdout.write(n),i=(n,r)=>y(n,r))=>{let[n,r]=[Number(e[0]),Number(e[1])];if(!(n>=1)||!(r>=1))return process.stderr.write(`plot-listing-walk: usage: plot-listing-walk.mjs <limit> <pagelen> [<next-file>]
`),3;let l=[];for(let s of o.split(`
`).filter(t=>t.trim()!=="")){let t;try{t=JSON.parse(s)}catch{return process.stderr.write(`plot-listing-walk: a page is not JSON
`),3}if(t!==null&&(typeof t!="object"||Array.isArray(t)))return process.stderr.write(`plot-listing-walk: a page is not a JSON object
`),3;l.push(t??{})}let p=l.map(s=>Array.isArray(s.values)?s.values:[]),a=c(l.map((s,t)=>({rows:p[t].length,envelopeNext:d(s)})),n,r),g=l.at(-1)?.next;if(!a.stops&&typeof g=="string"&&g!=="")return 0;let x={present:"1",absent:"0",unknown:""}[a.envelopeNext];return e[2]&&i(e[2],`${x}
`),u(`${JSON.stringify(p.flat().slice(0,n))}
`),b};process.argv[1]&&import.meta.url===m(f(process.argv[1])).href&&(process.exitCode=N(process.argv.slice(2),w(0,"utf8")));export{b as ANSWERED,N as run};
