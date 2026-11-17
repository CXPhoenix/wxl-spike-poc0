const S=/^[A-Za-z0-9+/]*={0,2}$/;function T(s,n){if(s==="")return[];const r=[];for(const o of s.split(","))if(S.test(o))try{r.push(E(o))}catch{}return r}function E(s){const n=atob(s),r=Uint8Array.from(n,o=>o.charCodeAt(0));return new TextDecoder().decode(r)}const v=`
import requests
from requests.adapters import HTTPAdapter
import json as _json
from pyodide.ffi import run_sync as _run_sync

import http.client as _http_client


class _WxlOriginalResponse:
    """Stands in for urllib3's _original_response; only .msg is consulted."""

    def __init__(self, msg):
        self.msg = msg

    def isclosed(self):
        return True

    def close(self):
        pass


class _WxlRawResponse:
    """Minimal urllib3.HTTPResponse stand-in carrying the Set-Cookie headers."""

    def __init__(self, set_cookies):
        msg = _http_client.HTTPMessage()
        for value in set_cookies:
            if value:
                msg.add_header("Set-Cookie", value)
        self.headers = msg
        self._original_response = _WxlOriginalResponse(msg)

    def read(self, *args, **kwargs):
        return b""

    def release_conn(self):
        pass

    def close(self):
        pass


_original_send = HTTPAdapter.send

def _patched_send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
    """Synchronous send that routes through the async JS dispatch bridge.

    The JS bridge (_wxlsh_dispatch_bridge) is async, but requests.send() is
    synchronous. We use pyodide.ffi.run_sync to bridge the gap — it drives
    the event loop until the JS Promise resolves, then returns the result.
    """
    method = request.method or "GET"
    url = request.url
    headers = dict(request.headers or {})
    body = request.body

    if body and isinstance(body, bytes):
        body = body.decode("utf-8", errors="replace")

    try:
        bridge = _wxlsh_dispatch_bridge
    except NameError:
        raise ConnectionError(
            "WXL dispatch bridge not initialized: _wxlsh_dispatch_bridge is not set. "
            "Ensure ChallengeLayout injects the bridge before requests is used."
        )

    try:
        headers_json = _json.dumps(headers)
        # bridge() returns a JS Promise (PyodideFuture); run_sync resolves it
        raw_json = _run_sync(bridge(method, url, headers_json, body or ""))
        result = _json.loads(raw_json)

        status = int(result["status"])
        resp_headers = result.get("headers", {})
        resp_body = (result.get("body", "") or "").encode("utf-8")

        # Set-Cookie values arrive unjoined in "set_cookies". Older payloads only
        # carry the comma-joined copy inside "headers"; fall back to that rather
        # than raising, but prefer the array — cookie attributes contain commas
        # of their own, so the joined form cannot be split back apart.
        set_cookies = result.get("set_cookies")
        if set_cookies is None:
            set_cookies = []
            for _k, _v in resp_headers.items():
                if _k.lower() == "set-cookie" and _v:
                    set_cookies = [_v]

        from requests.models import Response
        resp = Response()
        resp.status_code = status
        resp.headers.update(resp_headers)
        resp._content = resp_body
        resp.encoding = "utf-8"
        resp.url = url
        resp.request = request
        # requests.Session.send() populates its cookie jar via
        # extract_cookies_to_jar(jar, request, r.raw), which returns immediately
        # unless r.raw has a truthy _original_response whose .msg exposes
        # get_all("Set-Cookie"). Leaving raw unset is why the jar was always
        # empty and no challenge login ever stuck.
        resp.raw = _WxlRawResponse(set_cookies)
        return resp
    except ConnectionError:
        raise
    except Exception as e:
        raise ConnectionError(f"WXL dispatch bridge error: {e}") from e

HTTPAdapter.send = _patched_send
`;function _(s,n){const r={},o=[];for(const[a,l]of s.headers.entries())a.toLowerCase()==="x-wxlsh-set-cookie"?o.push(...T(l)):r[a]=l;return o.length>0&&(r["set-cookie"]=o.join(", ")),{status:s.status,headers:r,set_cookies:o,body:n}}const g="https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js";async function R(){await import(g);const s=globalThis.loadPyodide;if(typeof s!="function")throw new Error("loadPyodide not available after loading pyodide.js");return s}async function j(s,n){await s.loadPackage("micropip"),await s.runPythonAsync("import micropip; await micropip.install('requests')"),n&&s.globals.set("_wxlsh_dispatch_bridge",n),await s.runPythonAsync(v)}var C=Object.freeze({__proto__:null,PYODIDE_CDN_URL:g,buildBridgePayload:_,installRequestsPatch:j,loadPyodideFromCdn:R});function x(s,n){let r=null,o=1;const a=new Map;let l=null,u=()=>{};function p(){const e=new TextDecoder("utf-8");return{write:t=>{const i=e.decode(t,{stream:!0});return i&&u(i),t.length}}}const m=(e,t,i,d)=>{let y;try{y=Object.entries(JSON.parse(i||"{}"))}catch(c){return Promise.reject(new Error(`wxl dispatch bridge: could not parse the request header map: ${c instanceof Error?c.message:String(c)}`))}const f=o++;return new Promise(c=>{a.set(f,c),s.postMessage({type:"DISPATCH",id:f,method:e,url:t,headers:y,body:d})})};async function h(){r??=(async()=>{const e=await n.createPyodide(m);return e.setStdout(p()),e.setStderr(p()),e})();try{return await r}catch(e){throw r=null,e}}async function b(e){if(e)try{await e.runPythonAsync("import sys; sys.stdout.flush(); sys.stderr.flush()")}catch{}}async function w(e){if(l!==null){s.postMessage({type:"DONE",id:e.id,error:"a run is already running in this panel"});return}l=e.id,u=d=>s.postMessage({type:"STDOUT",id:e.id,chunk:d});let t=null,i=null;try{i=await h(),await i.runPythonAsync(e.code)}catch(d){t=d instanceof Error?d.message:String(d)}finally{await b(i),l=null,u=()=>{},s.postMessage({type:"DONE",id:e.id,error:t})}}function P(e){const t=a.get(e.id);if(!t)return;a.delete(e.id);const i=new Response(null,{status:e.status,headers:e.headers??[]});t(JSON.stringify(_(i,e.body??"")))}async function k(e){try{await h(),s.postMessage({type:"READY",id:e.id})}catch(t){s.postMessage({type:"INIT_FAILED",id:e.id,error:t instanceof Error?t.message:String(t)})}}s.onmessage=e=>{const t=e.data;t.type==="WARM_UP"?k({id:t.id}):t.type==="RUN_CODE"?w({id:t.id,code:t.code??""}):t.type==="DISPATCH_RESULT"&&P(t)}}async function q(s){const{loadPyodideFromCdn:n,installRequestsPatch:r}=await Promise.resolve().then(function(){return C}),a=await(await n())();return await r(a,s),a}typeof WorkerGlobalScope<"u"&&typeof self<"u"&&self instanceof WorkerGlobalScope&&x(self,{createPyodide:q});
