function a(e){return e.map(o=>t(o)).join(",")}function t(e){const o=new TextEncoder().encode(e);let n="";for(const r of o)n+=String.fromCharCode(r);return btoa(n)}export{t as b,a as e};
