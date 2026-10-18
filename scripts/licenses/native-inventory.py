#!/usr/bin/env python3
"""Offline provenance inventory. Consumes an already resolved Gradle report; never builds or fetches."""
import argparse, hashlib, io, json, re, subprocess, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--resolved', type=Path, required=True)
    ap.add_argument('--native-root', type=Path, required=True)
    ap.add_argument('--existing-notices', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--gradle-cache', type=Path, default=Path.home()/'.gradle/caches/modules-2/files-2.1')
    args = ap.parse_args()
    out=args.output; out.mkdir(parents=True, exist_ok=True)
    graph=json.loads(args.resolved.read_text())
    configurations=['releaseRuntimeClasspath','debugRuntimeClasspath']
    if sorted(graph)!=sorted(configurations): raise ValueError('Expected both runtime configurations')
    lock=args.native_root/'android/app/gradle.lockfile'
    locks={}
    for line in lock.read_text().splitlines():
        if line and not line.startswith('#') and not line.startswith('empty='):
            coordinate, configs=line.split('=',1); locks[coordinate]=configs.split(',')
    (out/'android-gradle.lockfile.txt').write_bytes(lock.read_bytes())
    modules={}; projects={}
    notice_pattern=re.compile(r'(^|/)(license[^/]*|notice[^/]*|copying[^/]*|copyright[^/]*|dependencies[^/]*)$',re.I)
    def archive_notices(path):
        notices=[]
        def scan(z, prefix=''):
            for info in z.infolist():
                if info.is_dir(): continue
                if notice_pattern.search(info.filename) and info.file_size <= 1024*1024:
                    data=z.read(info); sha=hashlib.sha256(data).hexdigest(); filename='android-notices/'+sha+'.txt'
                    (out/'android-notices').mkdir(exist_ok=True); (out/filename).write_bytes(data)
                    notices.append({'archiveEntry':prefix+info.filename,'file':filename,'sha256':sha,'bytes':len(data)})
                elif info.filename=='classes.jar' and info.file_size<=20*1024*1024:
                    with zipfile.ZipFile(io.BytesIO(z.read(info))) as nested: scan(nested,prefix+'classes.jar!/')
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as z: scan(z)
        return notices
    for config in configurations:
        data=graph[config]
        if any(x.get('unresolved') for x in data['edges']): raise ValueError('Unresolved dependency')
        for c in data['components']:
            coordinate=c['id']
            if coordinate.startswith('project '):
                projects.setdefault(coordinate,{'component':coordinate,'configurations':[]})['configurations'].append(config)
                continue
            if config not in locks.get(coordinate,[]): raise ValueError('Resolved runtime component missing from frozen lock: '+coordinate)
            entry=modules.setdefault(coordinate,{'coordinate':coordinate,'configurations':[],'artifacts':[]})
            entry['configurations'].append(config)
        for a in data['artifacts']:
            path=Path(a['file']); rel=path.relative_to(args.gradle_cache).as_posix()
            item={'filename':path.name,'gradleCachePath':rel,'sha256':digest(path),'bytes':path.stat().st_size,'notices':archive_notices(path)}
            if item not in modules[a['component']]['artifacts']:modules[a['component']]['artifacts'].append(item)
            # Keep graph reproducible without machine-specific absolute cache paths.
            a['file']='GRADLE_MODULE_CACHE/'+rel
    for coordinate,entry in modules.items():
        g,n,v=coordinate.split(':'); poms=sorted((args.gradle_cache/g/n/v).glob('*/*.pom'))
        if len({digest(p) for p in poms}) != 1: raise ValueError('Missing or ambiguous cached POM: '+coordinate)
        pom=poms[0]; rel='android-poms/'+coordinate.replace(':','__')+'.pom'; (out/'android-poms').mkdir(exist_ok=True)
        (out/rel).write_bytes(pom.read_bytes()); doc=ET.fromstring(pom.read_bytes())
        def children(element,name):return [x for x in element if x.tag.rsplit('}',1)[-1]==name]
        licenses=[]
        for container in children(doc,'licenses'):
            for lic in children(container,'license'):
                licenses.append({x.tag.rsplit('}',1)[-1]:(x.text or '').strip() for x in lic})
        entry['pom']={'file':rel,'sha256':digest(pom),'declaredLicenses':licenses}
        parent_doc=doc; ancestors=[]
        for depth in range(5):
            if licenses:break
            parents=children(parent_doc,'parent')
            if not parents:break
            fields={x.tag.rsplit('}',1)[-1]:(x.text or '').strip() for x in parents[0]}
            parts=[fields.get(k,'') for k in ['groupId','artifactId','version']]
            if not all(parts) or any('${' in part for part in parts):break
            paths=sorted((args.gradle_cache/parts[0]/parts[1]/parts[2]).glob('*/*.pom'))
            if len({digest(p) for p in paths})!=1:break
            parent=paths[0]; parent_file='android-poms/'+'__'.join(parts)+'.pom'; (out/parent_file).write_bytes(parent.read_bytes())
            parent_doc=ET.fromstring(parent.read_bytes()); parent_licenses=[]
            for container in children(parent_doc,'licenses'):
                for lic in children(container,'license'):parent_licenses.append({x.tag.rsplit('}',1)[-1]:(x.text or '').strip() for x in lic})
            ancestors.append({'coordinate':':'.join(parts),'file':parent_file,'sha256':digest(parent),'declaredLicenses':parent_licenses})
            licenses=parent_licenses
        entry['pom']['parentLicenseEvidence']=ancestors
        entry['pom']['effectiveDeclaredLicenses']=licenses
        entry['binaryStatus']='resolved runtime artifact' if entry['artifacts'] else 'metadata/platform component; no binary artifact in resolved view'
        entry['upstreamNoticeText']='extracted from resolved binary' if any(a['notices'] for a in entry['artifacts']) else 'unavailable in the resolved local binary/cache; cached POM declaration retained'
    npm=json.loads((args.existing_notices/'inventory.json').read_text())['packages']
    for item in projects.values():
        component=item['component'].removeprefix('project :')
        matches=[p for p in npm if p['package'].removeprefix('@').replace('/','-')==component]
        if matches:item['npmPackage']=matches[0];item['classification']='runtime project dependency; package notice mapped in existing inventory'
        elif component=='app':item['classification']='application source, not a third-party dependency'
        elif component=='capacitor-cordova-android-plugins':item['classification']='generated Capacitor adapter project; no separate external module version'
        else:raise ValueError('Unmapped project '+component)
    inventory={'schemaVersion':1,'scope':'Actual offline resolved release/debug runtime graph; provenance and notice evidence, not a legal opinion or assertion that shrinkers distribute every component. Build/test-only lock entries are separated below.','lockfile':{'file':'android-gradle.lockfile.txt','sha256':digest(lock)},'sourceGraphSha256':digest(args.resolved),'configurations':configurations,'runtimeModules':sorted(modules.values(),key=lambda x:x['coordinate']),'runtimeProjects':sorted(projects.values(),key=lambda x:x['component']),'buildOrTestOnlyLockedModules':[{'coordinate':c,'configurations':v,'classification':'not in either app runtime graph; build/test tooling only for this inventory'} for c,v in sorted(locks.items()) if c not in modules],'limitations':['License declarations are copied from exact cached upstream POMs without interpreting legal obligations.','Missing embedded upstream notice text is explicit per module. POM declarations are not substituted for missing copyright/NOTICE text.','Project dependencies map to existing direct npm notices. Runtime artifacts are hashed before any APK shrinking/packaging.','No dependency or notice was downloaded, no global package installed, and no release/legal approval implied.']}
    write_json(out/'android-inventory.json',inventory); write_json(out/'android-resolved-graph.json',graph)
    resolved=args.native_root/'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'
    checkout_root=args.native_root/'ios/build/SourcePackages/checkouts'; checkouts={p.name.lower():p for p in checkout_root.iterdir() if p.is_dir()}
    spm=[]
    for pin in json.loads(resolved.read_text())['pins']:
        checkout=checkouts[pin['identity']]
        revision=subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()
        if revision!=pin['state']['revision']:raise ValueError('SPM revision mismatch '+pin['identity'])
        notice=args.existing_notices/('spm-'+checkout.name+'.txt')
        if not notice.is_file():raise ValueError('Missing copied SPM notice '+pin['identity'])
        sha=digest(notice)
        normalize=lambda value:'\n'.join(line.rstrip() for line in value.splitlines()).strip()
        matches=[{'path':x.relative_to(checkout).as_posix(),'sha256':digest(x),'comparison':'byte-identical' if digest(x)==sha else 'identical after line-ending/trailing-whitespace normalization'} for x in checkout.iterdir() if x.is_file() and notice_pattern.search(x.name) and normalize(x.read_text())==normalize(notice.read_text())]
        if not matches:raise ValueError('Copied SPM notice does not match checkout '+pin['identity'])
        spm.append({**pin,'verifiedCheckoutRevision':revision,'notice':{'file':notice.name,'sha256':sha,'matchingUpstreamPaths':matches}})
    write_json(out/'spm-inventory.json',{'schemaVersion':1,'scope':'Exact Package.resolved revisions mapped to existing copied upstream notice texts; checked against local source checkouts.','packageResolvedSha256':digest(resolved),'packages':spm})
    print(json.dumps({'runtimeModules':len(modules),'runtimeProjectComponents':len(projects),'binaryArtifacts':sum(len(x['artifacts']) for x in modules.values()),'pomDeclarations':sum(bool(x['pom']['effectiveDeclaredLicenses']) for x in modules.values()),'modulesWithEmbeddedNotices':sum(any(a['notices'] for a in x['artifacts']) for x in modules.values()),'spmMapped':len(spm)}))
if __name__=='__main__':main()
