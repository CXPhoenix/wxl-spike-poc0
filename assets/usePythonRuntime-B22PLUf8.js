import{e as y}from"./cookieCarrier-tEwKOqdH.js";const f=`
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
`,h=new Set(["sqlite3","ssl","lzma","numpy","pandas"]);class b{pyodide=null;initPromise=null;loadPyodide;getPyodide(){return this.pyodide}constructor(e){this.loadPyodide=e}async initialize(e,i={},r=[]){return this.initPromise?this.initPromise:(this.initPromise=this._init(e,i,r),this.initPromise)}async _init(e,i,r){this.pyodide=await this.loadPyodide();for(const[s,_]of Object.entries(i)){const n=s.split("/").slice(1,-1);let o="";for(const d of n){o+="/"+d;try{this.pyodide.FS.mkdir(o)}catch{}}this.pyodide.FS.writeFile(s,_)}const p=r.filter(s=>h.has(s)),a=r.filter(s=>!h.has(s));if(p.length>0&&await this.pyodide.loadPackage(p),a.length>0){await this.pyodide.loadPackage("micropip");const s=JSON.stringify(a);await this.pyodide.runPythonAsync(`import micropip; await micropip.install(${s})`)}await this.pyodide.runPythonAsync(e),await this._installAndPatchRequests(),await this.pyodide.runPythonAsync(`
import json as _json, base64 as _b64, inspect as _inspect, io as _io

def _is_wsgi(application):
    """True if app looks like a 2-arg WSGI callable (not a coroutine function)."""
    if _inspect.iscoroutinefunction(application):
        return False
    try:
        params = [
            p for p in _inspect.signature(application).parameters.values()
            if p.default is _inspect.Parameter.empty
        ]
        return len(params) == 2
    except (ValueError, TypeError):
        return False

async def _asgi_bridge(method, path, query_string, js_headers, body_bytes):
    body = bytes(body_bytes) if body_bytes else b""
    headers_pairs = js_headers.to_py() if js_headers else []

    if _is_wsgi(app):
        # ── WSGI path (Flask) ────────────────────────────────────────────────
        environ = {
            "REQUEST_METHOD": method.upper(),
            "SCRIPT_NAME": "",
            "PATH_INFO": path,
            "QUERY_STRING": query_string or "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "443",
            "SERVER_PROTOCOL": "HTTP/1.1",
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "https",
            "wsgi.input": _io.BytesIO(body),
            "wsgi.errors": _io.StringIO(),
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }
        for k, v in headers_pairs:
            key = k.upper().replace("-", "_")
            if key == "CONTENT_TYPE":
                environ["CONTENT_TYPE"] = v
            elif key == "CONTENT_LENGTH":
                environ["CONTENT_LENGTH"] = v
            else:
                environ["HTTP_" + key] = v
        # Always override CONTENT_LENGTH with actual body size so Flask/Werkzeug
        # can read the body even when the caller omits the Content-Length header.
        environ["CONTENT_LENGTH"] = str(len(body))
        _w_status = [200]
        _w_headers = [[]]
        def _start_response(status, response_headers, exc_info=None):
            _w_status[0] = int(status.split(" ", 1)[0])
            _w_headers[0] = [[k, v] for k, v in response_headers]
        wsgi_result = app(environ, _start_response)
        wsgi_body = b"".join(wsgi_result)
        return _json.dumps({
            "status": _w_status[0],
            "headers": _w_headers[0],
            "body": _b64.b64encode(wsgi_body).decode("ascii"),
        })
    else:
        # ── ASGI path (FastAPI / async Flask) ────────────────────────────────
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method.upper(),
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": query_string.encode("utf-8") if query_string else b"",
            "root_path": "",
            "scheme": "https",
            "headers": [(k.encode("utf-8"), v.encode("utf-8")) for k, v in headers_pairs],
            "server": ("localhost", 443),
        }
        _called = False
        async def receive():
            nonlocal _called
            if not _called:
                _called = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}
        resp_status = 200
        resp_headers = []
        resp_body = b""
        async def send(event):
            nonlocal resp_status, resp_headers, resp_body
            t = event.get("type", "")
            if t == "http.response.start":
                resp_status = int(event["status"])
                resp_headers = [
                    (hk.decode("utf-8", "replace"), hv.decode("utf-8", "replace"))
                    for hk, hv in event.get("headers", [])
                ]
            elif t == "http.response.body":
                resp_body += event.get("body", b"")
        await app(scope, receive, send)
        return _json.dumps({
            "status": resp_status,
            "headers": resp_headers,
            "body": _b64.b64encode(resp_body).decode("ascii"),
        })
`)}async _installAndPatchRequests(){this.pyodide&&(await this.pyodide.loadPackage("micropip"),await this.pyodide.runPythonAsync("import micropip; await micropip.install('requests')"),await this.pyodide.runPythonAsync(f))}async handleRequest(e){if(!this.pyodide)throw new Error("PythonRuntime not initialized");const i=this.pyodide.globals.get("_asgi_bridge"),r=new URL(e.url),p=e.body?new Uint8Array(await e.arrayBuffer()):new Uint8Array,a=[...e.headers.entries()].filter(([t])=>!t.toLowerCase().startsWith("x-wxlsh-")).map(([t,l])=>[t.toLowerCase(),l]),s=e.headers.get("x-wxlsh-cookie");s&&a.push(["cookie",s]);const _=await i(e.method.toUpperCase(),r.pathname,r.search.slice(1),a,p),n=JSON.parse(_),o=new Headers,d=[];for(const[t,l]of n.headers)t.toLowerCase()==="set-cookie"?d.push(l):o.set(t,l);d.length>0&&o.set("X-Wxlsh-Set-Cookie",y(d));const u=Uint8Array.from(atob(n.body),t=>t.charCodeAt(0));return new Response(u,{status:n.status,headers:o})}get isReady(){return this.pyodide!==null}}const g="https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js";async function w(){await import(g);const c=globalThis.loadPyodide;if(typeof c!="function")throw new Error("loadPyodide not available after loading pyodide.js");return c}export{g as PYODIDE_CDN_URL,b as PythonRuntime,w as loadPyodideFromCdn};
