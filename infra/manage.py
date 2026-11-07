#!/usr/bin/env python3
"""Doompile operations. All durable project state is below this repository."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

from instance import instance_environment, site_origin

SOURCE = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('DOOMPILE_PROJECT_ROOT') or SOURCE).resolve()
CONFIG = json.loads((SOURCE/'infra/environments.json').read_text())
RUNTIME = ROOT/'runtime'

def run(args, *, env=None, capture=False, cwd=ROOT):
    result = subprocess.run([str(a) for a in args], cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): '+str(args[0]))
    return result.stdout.strip() if capture else None

def dump(value):
    print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+'.new')
    temp.write_text(json.dumps(value, indent=2)+'\n')
    temp.chmod(0o600)
    temp.replace(path)

def state(environment):
    path = RUNTIME/environment/'release.json'
    return json.loads(path.read_text()) if path.exists() else None

def container(environment, service='app'):
    value = run(['docker','ps','--filter',f'label=com.docker.compose.project=doompile-{environment}',
                 '--filter',f'label=com.docker.compose.service={service}','--format','{{.ID}}'],capture=True)
    if not value or '\n' in value:
        raise RuntimeError(f'Expected one running {environment}/{service} container')
    return value

def release(release_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,120}', release_id):
        raise RuntimeError('Invalid release ID')
    return json.loads((ROOT/'releases'/release_id/'manifest.json').read_text())

def compose_env(environment, current):
    cfg = CONFIG['environments'][environment]
    settings = instance_environment(ROOT)
    origin = site_origin(settings, environment)
    base = RUNTIME/environment
    for name in ['data','s3','downloads/macos','backups']:
        p = base/name
        p.mkdir(parents=True,exist_ok=True,mode=0o750)
        os.chown(p,1000,1000)
    return {**settings,
        'DOOMPILE_COMPOSE_PROJECT':f'doompile-{environment}',
        'DOOMPILE_APP_IMAGE':current['image'], 'DOOMPILE_MINIO_IMAGE':current['minio_image'],
        'DOOMPILE_BUILD_COMMIT':current['release'],
        'DOOMPILE_PUBLIC_URL':origin,
        'DOOMPILE_PORT':str(cfg['port']), 'DOOMPILE_S3_PORT':str(cfg['s3_port']),
        'DOOMPILE_DATA_PATH':str(base/'data'), 'DOOMPILE_S3_DATA_PATH':str(base/'s3'),
        'DOOMPILE_MACOS_RELEASES_PATH':str(base/'downloads/macos'),
        'DOOMPILE_S3_BUCKET_PREFIX':cfg['bucket_prefix'],
    }

def compose(environment, current):
    env = compose_env(environment,current)
    run(['docker','compose','-f',SOURCE/'infra/compose.yml','up','-d','--no-build','--wait','--wait-timeout','240'],env=env)
    cfg = CONFIG['environments'][environment]
    with urllib.request.urlopen(f'http://127.0.0.1:{cfg["port"]}/api/health',timeout=15) as response:
        health=json.load(response)
    if health.get('status')!='ok' or health.get('commit')!=current['release']:
        raise RuntimeError('Health check did not match selected release')

def backup(environment):
    app = container(environment)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_id = 'backup-'+stamp
    temp_name = '.ops-'+backup_id
    run(['docker','exec',app,'node','/app/infra/backup.mjs','/data/'+temp_name])
    run(['docker','exec',app,'node','/app/infra/verify-backup.mjs','/data/'+temp_name])
    target = RUNTIME/environment/'backups'/backup_id
    if target.exists():raise RuntimeError('Backup destination exists')
    shutil.move(str(RUNTIME/environment/'data'/temp_name),target)
    dump({'environment':environment,'backup':str(target),'verified':True})
    return target

def build(source):
    source = source.resolve()
    commit=run(['git','rev-parse','--short=12','HEAD'],cwd=source,capture=True)
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dt%H%M%Sz')
    release_id=f'r{stamp}-{commit}'
    destination=ROOT/'releases'/release_id
    destination.mkdir(parents=True)
    excludes=['.git','node_modules/','.next*/','build/','DerivedData/','.build/','apps/macos/dist/',
              'extensions/clipper/dist/','packages/editor/dist/','/data/','/runtime/','/migration/','/releases/',
              'test-results/','playwright-report/','.test-build/','__pycache__/','.DS_Store','/.agents/',
              '.env*','*.p8','*.p12','*.mobileprovision']
    command=['rsync','-a']
    command.extend('--exclude='+p for p in excludes)
    run(command+[str(source)+'/',str(destination/'source')+'/'])
    minio_hash=hashlib.sha256((destination/'source/infra/minio.Dockerfile').read_bytes()).hexdigest()[:12]
    minio_image='doompile-minio:'+minio_hash
    exists=subprocess.run(['docker','image','inspect','--format','{{.Id}}',minio_image],capture_output=True).returncode==0
    if not exists:
        run(['docker','build','-f',destination/'source/infra/minio.Dockerfile','-t',minio_image,destination/'source'])
    image='doompile-app:'+release_id
    run(['docker','build','--build-arg','DOOMPILE_BUILD_COMMIT='+release_id,
         '-f',destination/'source/infra/Dockerfile','-t',image,destination/'source'])
    digest=run(['docker','image','inspect','--format','{{.Id}}',image],capture=True)
    current={'release':release_id,'image':image,'image_id':digest,'minio_image':minio_image,'git_commit':commit,
             'created':dt.datetime.now(dt.timezone.utc).isoformat(),'source':str(destination/'source')}
    atomic(destination/'manifest.json',current)
    atomic(RUNTIME/'last-build.json',current)
    dump(current)
    return current

def deploy(environment,current):
    origin = site_origin(instance_environment(ROOT), environment)
    previous=state(environment)
    if previous and environment=='prod':backup(environment)
    try:
        compose(environment,current)
    except Exception:
        if previous:
            compose(environment,previous)
            print('Restored previous application image; database was not automatically reverted.',file=sys.stderr)
        raise
    if previous:atomic(RUNTIME/environment/'previous-release.json',previous)
    atomic(RUNTIME/environment/'release.json',current)
    dump({'environment':environment,'release':current['release'],'url':origin+'/doompile','healthy':True})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    for action in ['build','check']:
        p=sub.add_parser(action);p.add_argument('--source',type=Path,default=ROOT)
    for action in ['deploy','backup','rollback','logs','status','traces']:
        p=sub.add_parser(action)
        p.add_argument('environment',choices=['prod','staging'],default='staging',nargs='?')
        if action=='deploy':
            p.add_argument('--release');p.add_argument('--source',type=Path,default=ROOT)
        if action=='traces':p.add_argument('--trace');p.add_argument('--limit',type=int,default=100)
    sub.add_parser('promote')
    sub.add_parser('edge')
    args=parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    if args.action=='check':
        run(['mise','exec','--','npm','run','verify'],cwd=args.source)
    elif args.action=='status':
        rows=run(['docker','ps','-a','--filter',f'label=com.docker.compose.project=doompile-{args.environment}',
                  '--format','{{json .}}'],capture=True)
        dump({'environment':args.environment,'release':state(args.environment),'containers':[json.loads(v) for v in rows.splitlines() if v]})
    elif args.action=='logs':
        run(['docker','logs','--tail','200','--timestamps',container(args.environment)])
    elif args.action=='traces':
        if args.trace and not re.fullmatch('[0-9a-f]{32}',args.trace):raise RuntimeError('Invalid trace ID')
        path=RUNTIME/args.environment/'data/telemetry.sqlite'
        if not path.exists():return dump({'environment':args.environment,'events':[]})
        with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            where=' WHERE trace_id=?' if args.trace else ''
            values=[args.trace] if args.trace else []
            values.append(min(1000,max(1,args.limit)))
            rows=db.execute('SELECT seq,received_at,name,platform,level,trace_id,source,payload FROM events'+where+' ORDER BY seq DESC LIMIT ?',values).fetchall()
            events=[]
            for row in rows:
                event=dict(row);event['payload']=json.loads(event['payload']);events.append(event)
            dump({'environment':args.environment,'events':events})
    elif args.action=='edge':
        settings = instance_environment(ROOT)
        prod = site_origin(settings, 'prod')
        staging = site_origin(settings, 'staging')
        if prod == staging:
            raise ValueError('Production and staging must use separate origins.')
        edge_env = {**os.environ, 'DOOMPILE_PROD_URL': prod, 'DOOMPILE_STAGING_URL': staging,
                    'DOOMPILE_EDGE_RUNTIME': str(RUNTIME)}
        for name in ['caddy/data','caddy/config','logs/caddy']:(RUNTIME/name).mkdir(parents=True,exist_ok=True)
        edge = ['docker','compose','-f',SOURCE/'infra/caddy.compose.yml']
        run([*edge,'run','--rm','--no-deps','caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],env=edge_env)
        run([*edge,'up','-d','--wait'],env=edge_env)
    else:
        with (RUNTIME/'operations.lock').open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if args.action=='build':build(args.source)
            elif args.action=='backup':backup(args.environment)
            elif args.action=='deploy':
                site_origin(instance_environment(ROOT), args.environment)
                current=release(args.release) if args.release else build(args.source)
                deploy(args.environment,current)
            elif args.action=='promote':
                current=state('staging')
                if not current:raise RuntimeError('Deploy staging first')
                # Require the tested staging image to remain healthy before promoting it.
                cfg=CONFIG['environments']['staging']
                with urllib.request.urlopen(f'http://127.0.0.1:{cfg["port"]}/api/health',timeout=15) as r:health=json.load(r)
                if health.get('commit')!=current['release']:raise RuntimeError('Staging health does not match release')
                deploy('prod',current)
            elif args.action=='rollback':
                previous=json.loads((RUNTIME/args.environment/'previous-release.json').read_text())
                deploy(args.environment,previous)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(1)
