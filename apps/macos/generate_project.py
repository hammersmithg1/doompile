#!/usr/bin/env python3
"""Generate the native Mac project and stage existing offline bundles.

Requires Python 3 only. The build commands belong to the caller: this script never
mutates extensions/clipper/dist, which may be loaded in a live Safari session.
"""
from pathlib import Path
import hashlib
import json
import os
import plistlib
import shutil
import sys
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
build_commit = os.environ.get('DOOMPILE_BUILD_COMMIT') or os.environ.get('GITHUB_SHA') or subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=REPO, capture_output=True, text=True).stdout.strip() or 'development'
sys.path.insert(0, str(REPO / 'infra'))
from apple_links import link_configuration
from update_configuration import update_configuration
link_info, link_entitlements = link_configuration(previous=os.environ.get('DOOMPILE_PREVIOUS_PUBLIC_URL'))
update_info = update_configuration()

clipper = Path(os.environ.get('DOOMPILE_CLIPPER_DIR', str(REPO / 'extensions/clipper/dist/safari'))).expanduser().resolve()
editor = REPO / 'packages/editor/dist'
for path in [clipper / 'manifest.json', editor / 'editor.html']:
    if not path.is_file():
        sys.exit('Missing offline bundle: ' + str(path) + '. Run npm run clipper:build and npm run editor:build before generating.')

for source, destination in [(clipper, ROOT / 'Safari/Resources'), (editor, ROOT / 'Doompile/EditorResources')]:
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)

# Native messaging must target this platform's containing app. These patches are
# applied to our copy only, preserving a user's loaded temporary Safari folder.
resources = ROOT / 'Safari/Resources'
background = resources / 'background.js'
background.write_text(background.read_text().replace("sendNativeMessage('app.doompile',", "sendNativeMessage('app.doompile.macos',"))
popup = resources / 'popup.html'
popup.write_text(popup.read_text().replace('Use iPhone app connection', 'Use Mac app connection').replace('Use app connection', 'Use Mac app connection'))
script = resources / 'popup.js'
script.write_text(script.read_text().replace('Could not read the iPhone app connection. Connect the app first, or enter your server and token here.', 'Could not read the Mac app connection. Open Doompile and connect it first, or enter your server and token here.'))

def plist(path, value):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(plistlib.dumps(value, sort_keys=False))

base = {
    **link_info,
    'DoompileBuildCommit': build_commit,
    'CFBundleDevelopmentRegion': 'ru', 'CFBundleExecutable': '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion': '6.0',
    'CFBundleName': '$(PRODUCT_NAME)', 'CFBundlePackageType': '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString': '$(MARKETING_VERSION)', 'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
    'LSMinimumSystemVersion': '$(MACOSX_DEPLOYMENT_TARGET)',
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
}
app = {
    **base, **update_info, 'CFBundleDisplayName': 'Doompile', 'NSPrincipalClass': 'NSApplication',
    'SUEnableInstallerLauncherService': True,
    'LSUIElement': True,
    'NSHighResolutionCapable': True, 'NSSupportsAutomaticGraphicsSwitching': True,
    'NSMicrophoneUsageDescription': 'Запиши голосовую заметку и сохрани её в Doompile.',
    'CFBundleURLTypes': [{'CFBundleURLName': 'app.doompile.macos', 'CFBundleURLSchemes': ['doompile']}],
}
safari = {
    **base, 'CFBundleDisplayName': 'Doompile Clipper',
    'NSExtension': {
        'NSExtensionPointIdentifier': 'com.apple.Safari.web-extension',
        'NSExtensionPrincipalClass': '$(PRODUCT_MODULE_NAME).SafariWebExtensionHandler',
    },
}
for folder, value in [('Doompile', app), ('Safari', safari)]:
    plist(folder + '/Info.plist', value)
    plist(folder + '/Info-Release.plist', value)
    entitlements = {
        'com.apple.security.app-sandbox': True,
        'com.apple.security.network.client': True,
        'com.apple.security.application-groups': ['group.app.doompile'],
    }
    if folder == 'Doompile':
        entitlements.update({**link_entitlements, 'com.apple.security.files.user-selected.read-write': True, 'com.apple.security.device.audio-input': True})
        entitlements['com.apple.security.temporary-exception.mach-lookup.global-name'] = ['$(PRODUCT_BUNDLE_IDENTIFIER)-spks', '$(PRODUCT_BUNDLE_IDENTIFIER)-spki']
    plist(folder + '/App.entitlements', entitlements)

assets = ROOT / 'Doompile/Assets.xcassets'
icons = assets / 'AppIcon.appiconset'
icons.mkdir(parents=True, exist_ok=True)
(assets / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
images = []
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        pixels = size * scale
        name = 'icon-' + str(pixels) + '.png'
        source = REPO / 'packages/design/dist' / f'app-macos-{pixels}.png'
        shutil.copyfile(source, icons / name)
        images.append({'filename': name, 'idiom': 'mac', 'size': f'{size}x{size}', 'scale': f'{scale}x'})
(icons / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')

objects = {}
def ident(name): return hashlib.sha1(('macos:' + name).encode()).hexdigest()[:24].upper()
def q(value): return json.dumps(str(value))
def arr(values): return '(' + ', '.join(values) + ',)' if values else '()'
def obj(key, isa, **values):
    identifier = ident(key)
    objects[identifier] = '{isa = ' + isa + '; ' + ' '.join(k + ' = ' + v + ';' for k, v in values.items()) + ' };'
    return identifier
file_ids = []
def file(path, filetype):
    identifier = obj('file:' + path, 'PBXFileReference', lastKnownFileType=q(filetype), path=q(path), sourceTree=q('<group>'))
    file_ids.append(identifier)
    return identifier

# Shared model/storage compile directly from their authoritative source.
shared = [file('../ios/Shared/' + path.name, 'sourcecode.swift') for path in sorted((REPO / 'apps/ios/Shared').glob('*.swift'))]
app_files = [file(str(path.relative_to(ROOT)), 'sourcecode.swift') for folder in ['Doompile', 'Support'] for path in sorted((ROOT / folder).glob('*.swift'))]
editor_resources = file('Doompile/EditorResources', 'folder')
icon = file('Doompile/Assets.xcassets', 'folder.assetcatalog')
brand_assets = file('../../packages/design/BrandAssets.xcassets', 'folder.assetcatalog')
handler = file('Safari/SafariWebExtensionHandler.swift', 'sourcecode.swift')
safari_resources = []
for resource in sorted(resources.iterdir()):
    filetype = 'folder' if resource.is_dir() else {'.js': 'sourcecode.javascript', '.json': 'text.json', '.html': 'text.html', '.css': 'text.css'}.get(resource.suffix, 'text')
    safari_resources.append(file(str(resource.relative_to(ROOT)), filetype))
for folder in ['Doompile', 'Safari']:
    for name, kind in [('Info.plist', 'text.plist.xml'), ('Info-Release.plist', 'text.plist.xml'), ('App.entitlements', 'text.plist.entitlements')]: file(folder + '/' + name, kind)

products = {}
targets = {}
sparkle_package = obj('package:Sparkle', 'XCRemoteSwiftPackageReference', repositoryURL=q('https://github.com/sparkle-project/Sparkle'), requirement='{kind = exactVersion; version = 2.10.0;}')
sparkle_product = obj('packageProduct:Sparkle', 'XCSwiftPackageProductDependency', package=sparkle_package, productName=q('Sparkle'))
marketing_version = json.loads((REPO / 'package.json').read_text())['version']
for target, folder, product, bundle in [('Doompile', 'Doompile', 'application', 'app.doompile.macos'), ('DoompileSafari', 'Safari', 'app-extension', 'app.doompile.macos.safari')]:
    app_target = product == 'application'
    extension = 'app' if app_target else 'appex'
    products[target] = obj('product:' + target, 'PBXFileReference', explicitFileType=q('wrapper.application' if app_target else 'wrapper.app-extension'), includeInIndex='0', path=q(target + '.' + extension), sourceTree=q('BUILT_PRODUCTS_DIR'))
    configs = []
    for name in ['Debug', 'Release']:
        settings = {
            'PRODUCT_BUNDLE_IDENTIFIER': q(bundle), 'PRODUCT_NAME': q('$(TARGET_NAME)'),
            'INFOPLIST_FILE': q(folder + ('/Info.plist' if name == 'Debug' else '/Info-Release.plist')),
            'CODE_SIGN_ENTITLEMENTS': q(folder + '/App.entitlements'), 'CODE_SIGN_STYLE': q('Automatic'),
            'SWIFT_VERSION': '5.0', 'OTHER_LDFLAGS': q('$(inherited) -lsqlite3'), 'MACOSX_DEPLOYMENT_TARGET': '14.0', 'SDKROOT': 'macosx',
            'CURRENT_PROJECT_VERSION': '1', 'MARKETING_VERSION': q(marketing_version),
            'ENABLE_USER_SCRIPT_SANDBOXING': 'YES', 'GENERATE_INFOPLIST_FILE': 'NO',
            'SWIFT_STRICT_CONCURRENCY': q('minimal'), 'ENABLE_HARDENED_RUNTIME': 'YES',
            'LD_RUNPATH_SEARCH_PATHS': q('$(inherited) @executable_path/../Frameworks' + ('' if app_target else ' @executable_path/../../../../Frameworks')),
        }
        if app_target: settings.update(ASSETCATALOG_COMPILER_APPICON_NAME=q('AppIcon'), ENABLE_PREVIEWS='YES', SWIFT_EMIT_LOC_STRINGS='YES')
        else: settings.update(APPLICATION_EXTENSION_API_ONLY='YES', SKIP_INSTALL='YES')
        configs.append(obj('config:' + target + name, 'XCBuildConfiguration', buildSettings='{' + ' '.join(k + ' = ' + v + ';' for k, v in settings.items()) + '}', name=q(name)))
    configuration_list = obj('configs:' + target, 'XCConfigurationList', buildConfigurations=arr(configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
    sources = shared + (app_files if app_target else [handler])
    sources_phase = obj('sources:' + target, 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=arr([obj('compile:' + target + resource, 'PBXBuildFile', fileRef=resource) for resource in sources]), runOnlyForDeploymentPostprocessing='0')
    target_resources = [icon, brand_assets, editor_resources] if app_target else safari_resources
    resources_phase = obj('resources:' + target, 'PBXResourcesBuildPhase', buildActionMask='2147483647', files=arr([obj('resource:' + target + resource, 'PBXBuildFile', fileRef=resource) for resource in target_resources]), runOnlyForDeploymentPostprocessing='0')
    frameworks = [obj('link:Sparkle', 'PBXBuildFile', productRef=sparkle_product)] if app_target else []
    frameworks_phase = obj('frameworks:' + target, 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files=arr(frameworks), runOnlyForDeploymentPostprocessing='0')
    dependencies = []
    phases = [sources_phase, frameworks_phase, resources_phase]
    if app_target:
        proxy = obj('proxy:DoompileSafari', 'PBXContainerItemProxy', containerPortal=ident('project'), proxyType='1', remoteGlobalIDString=ident('target:DoompileSafari'), remoteInfo=q('DoompileSafari'))
        dependencies.append(obj('dependency:DoompileSafari', 'PBXTargetDependency', target=ident('target:DoompileSafari'), targetProxy=proxy))
        embedded = obj('embed:DoompileSafari', 'PBXBuildFile', fileRef=ident('product:DoompileSafari'), settings='{ATTRIBUTES = (RemoveHeadersOnCopy, );}')
        phases.append(obj('embedExtensions', 'PBXCopyFilesBuildPhase', buildActionMask='2147483647', dstPath=q(''), dstSubfolderSpec='13', files=arr([embedded]), name=q('Embed App Extensions'), runOnlyForDeploymentPostprocessing='0'))
    targets[target] = obj('target:' + target, 'PBXNativeTarget', buildConfigurationList=configuration_list, buildPhases=arr(phases), buildRules='()', dependencies=arr(dependencies), packageProductDependencies=arr([sparkle_product] if app_target else []), name=q(target), productName=q(target), productReference=products[target], productType=q('com.apple.product-type.' + product))

ui_target = 'DoompileUITests'
ui_source = file('UITests/ComposerTests.swift', 'sourcecode.swift')
products[ui_target] = obj('product:' + ui_target, 'PBXFileReference', explicitFileType=q('wrapper.cfbundle'), includeInIndex='0', path=q(ui_target + '.xctest'), sourceTree=q('BUILT_PRODUCTS_DIR'))
ui_settings = '{PRODUCT_BUNDLE_IDENTIFIER = "app.doompile.macos.uitests"; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; SWIFT_VERSION = 5.0; MACOSX_DEPLOYMENT_TARGET = 14.0; TEST_TARGET_NAME = Doompile; CODE_SIGN_STYLE = Automatic;}'
ui_configs = [obj('config:' + ui_target + name, 'XCBuildConfiguration', buildSettings=ui_settings, name=q(name)) for name in ['Debug', 'Release']]
ui_configurations = obj('configs:' + ui_target, 'XCConfigurationList', buildConfigurations=arr(ui_configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
ui_build_file = obj('compile:' + ui_target, 'PBXBuildFile', fileRef=ui_source)
ui_sources = obj('sources:' + ui_target, 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=arr([ui_build_file]), runOnlyForDeploymentPostprocessing='0')
ui_frameworks = obj('frameworks:' + ui_target, 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files='()', runOnlyForDeploymentPostprocessing='0')
ui_proxy = obj('proxy:UITestHost', 'PBXContainerItemProxy', containerPortal=ident('project'), proxyType='1', remoteGlobalIDString=targets['Doompile'], remoteInfo=q('Doompile'))
ui_dependency = obj('dependency:UITestHost', 'PBXTargetDependency', target=targets['Doompile'], targetProxy=ui_proxy)
targets[ui_target] = obj('target:' + ui_target, 'PBXNativeTarget', buildConfigurationList=ui_configurations, buildPhases=arr([ui_sources, ui_frameworks]), buildRules='()', dependencies=arr([ui_dependency]), name=q(ui_target), productName=q(ui_target), productReference=products[ui_target], productType=q('com.apple.product-type.bundle.ui-testing'))

products_group = obj('products', 'PBXGroup', children=arr(list(products.values())), name=q('Products'), sourceTree=q('<group>'))
main_group = obj('main', 'PBXGroup', children=arr(file_ids + [products_group]), sourceTree=q('<group>'))
project_configs = []
for name in ['Debug', 'Release']:
    settings = '{CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; SDKROOT = macosx; MACOSX_DEPLOYMENT_TARGET = 14.0; SWIFT_OPTIMIZATION_LEVEL = ' + q('-Onone' if name == 'Debug' else '-O') + '; DEBUG_INFORMATION_FORMAT = ' + q('dwarf' if name == 'Debug' else 'dwarf-with-dsym') + '; SWIFT_ACTIVE_COMPILATION_CONDITIONS = ' + q('DEBUG $(inherited)' if name == 'Debug' else '$(inherited)') + ';}'
    project_configs.append(obj('projectConfig:' + name, 'XCBuildConfiguration', buildSettings=settings, name=q(name)))
project_config = obj('projectConfigs', 'XCConfigurationList', buildConfigurations=arr(project_configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
project = obj('project', 'PBXProject', attributes='{LastUpgradeCheck = 2620; BuildIndependentTargetsInParallel = YES;}', buildConfigurationList=project_config, compatibilityVersion=q('Xcode 14.0'), developmentRegion=q('ru'), hasScannedForEncodings='0', knownRegions='(ru, en, Base,)', mainGroup=main_group, productRefGroup=products_group, projectDirPath=q(''), projectRoot=q(''), packageReferences=arr([sparkle_package]), targets=arr(list(targets.values())))
project_dir = ROOT / 'Doompile.xcodeproj'
project_dir.mkdir(exist_ok=True)
(project_dir / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(k + ' = ' + v for k, v in objects.items()) + '\n}; rootObject = ' + project + '; }\n')
scheme_dir = project_dir / 'xcshareddata/xcschemes'
scheme_dir.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets["Doompile"]}" BuildableName="Doompile.app" BlueprintName="Doompile" ReferencedContainer="container:Doompile.xcodeproj"/>'
ui_reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets[ui_target]}" BuildableName="{ui_target}.xctest" BlueprintName="{ui_target}" ReferencedContainer="container:Doompile.xcodeproj"/>'
(scheme_dir / 'Doompile.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2620" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ui_reference}</TestableReference></Testables></TestAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print('Generated apps/macos/Doompile.xcodeproj: native Mac app and embedded Safari WebExtension.')
