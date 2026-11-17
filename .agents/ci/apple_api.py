"""App Store Connect helper; use only via agent_secrets.py. No private-key files."""
import base64
import functools
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

APP_ID = '6828764230'


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


@functools.lru_cache(maxsize=1)
def access_token():
    names=['APP_STORE_CONNECT_KEY_ID','APP_STORE_CONNECT_ISSUER_ID','APP_STORE_CONNECT_P8_BASE64']
    if not all(os.environ.get(n) for n in names):
        raise RuntimeError('Load Apple inputs through the setec wrapper')
    now=int(time.time())
    header={'alg':'ES256','kid':os.environ[names[0]],'typ':'JWT'}
    payload={'iss':os.environ[names[1]],'iat':now-15,'exp':now+600,'aud':'appstoreconnect-v1'}
    signing=(b64(json.dumps(header,separators=(',',':')).encode())+'.'+b64(json.dumps(payload,separators=(',',':')).encode())).encode()
    key=base64.b64decode(''.join(os.environ[names[2]].split()),validate=True)
    read_fd,write_fd=os.pipe()
    try:
        os.write(write_fd,key)
        os.close(write_fd);write_fd=None
        r=subprocess.run(['openssl','dgst','-sha256','-sign','/dev/fd/'+str(read_fd)],input=signing,
                         pass_fds=(read_fd,),capture_output=True)
    finally:
        os.close(read_fd)
        if write_fd is not None:os.close(write_fd)
    if r.returncode:raise RuntimeError('Could not sign Apple token (details withheld)')
    der=r.stdout
    def length(index):
        n=der[index];index+=1
        if n&128:
            count=n&127;n=int.from_bytes(der[index:index+count], 'big');index+=count
        return n,index
    assert der[0]==48
    _,index=length(1)
    parts=[]
    for _ in range(2):
        assert der[index]==2
        n,index=length(index+1)
        part=der[index:index+n].lstrip(b'\0');index+=n
        assert len(part)<=32
        parts.append(part.rjust(32,b'\0'))
    return signing.decode()+'.'+b64(b''.join(parts))


def request(path, method='GET', data=None):
    if not path.startswith('/v1/'):
        raise RuntimeError('Only App Store Connect v1 endpoints are supported')
    body=json.dumps(data).encode() if data is not None else None
    # Only reads are safe to repeat without an idempotency guarantee from Apple.
    attempts=6 if method=='GET' else 1
    for attempt in range(attempts):
        req=urllib.request.Request('https://api.appstoreconnect.apple.com'+path,data=body,method=method,
            headers={'Authorization':'Bearer '+access_token(),'Content-Type':'application/json'})
        delay=min(2**(attempt+1),30)
        try:
            with urllib.request.urlopen(req,timeout=45) as response:
                raw=response.read()
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            try:
                with error:
                    codes=[e.get('code','') for e in json.loads(error.read()).get('errors',[])]
            except Exception:codes=[]
            message='App Store Connect HTTP '+str(error.code)+' '+','.join(codes)
            if error.code not in (429,500,502,503,504) or attempt+1==attempts:
                raise RuntimeError(message) from None
            retry_after=error.headers.get('Retry-After','') if error.headers else ''
            if retry_after.isdecimal():
                delay=min(60,max(delay,int(retry_after)))
        except (urllib.error.URLError,TimeoutError):
            message='App Store Connect network request failed'
            if attempt+1==attempts:
                raise RuntimeError(message) from None
        print(message+'; retrying read in '+str(delay)+'s',file=sys.stderr,flush=True)
        time.sleep(delay)


def builds():
    # The app-scoped endpoint needs no relationship expansion or global filter.
    # Follow every page: next_build must not reuse a number hidden on a later page.
    query=urllib.parse.urlencode({'limit':200,'fields[builds]':'version,uploadedDate,processingState'})
    path='/v1/apps/'+APP_ID+'/builds?'+query
    records=[]
    visited=set()
    while path:
        if path in visited:
            raise RuntimeError('App Store Connect repeated a builds page')
        visited.add(path)
        page=request(path)
        records.extend(page.get('data',[]))
        next_url=page.get('links',{}).get('next')
        path=None
        if next_url:
            link=urllib.parse.urlsplit(next_url)
            if link.scheme!='https' or link.netloc!='api.appstoreconnect.apple.com' or not link.path.startswith('/v1/'):
                raise RuntimeError('Unexpected App Store Connect pagination URL')
            path=link.path+('?' + link.query if link.query else '')
    return {'data':records}


def next_build():
    versions=[x.get('attributes',{}).get('version','') for x in builds().get('data',[])]
    first=[int(v.split('.')[0]) for v in versions if re.fullmatch(r'\d+(?:\.\d+){0,2}',v)]
    return str(max(first,default=0)+1)+'.1'


if __name__=='__main__':
    try:
        if len(sys.argv)>1 and sys.argv[1]=='next-build':print(next_build())
        else:
            result=builds()
            print(json.dumps({'app_id':APP_ID,'recent_builds':[{'id':b['id'],**b['attributes']} for b in result.get('data',[])[:12]],
                              'next_build':next_build()},indent=2))
    except Exception as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(1)
