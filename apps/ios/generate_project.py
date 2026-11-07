#!/usr/bin/env python3
"""Generate a deterministic Xcode project and stage the shared Safari WebExtension.

Requires only Python 3. Run `npm run clipper:build` first (or node extensions/clipper/build.mjs).
No XcodeGen, CocoaPods or third-party project generator is needed on a Linux devbox.
"""
from pathlib import Path
import hashlib
import json
import plistlib
import os
import shutil
import sys
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
build_commit = os.environ.get('DOOMPILE_BUILD_COMMIT') or os.environ.get('GITHUB_SHA') or subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=REPO, capture_output=True, text=True).stdout.strip() or 'development'
sys.path.insert(0, str(REPO / 'infra'))
from apple_links import link_configuration
link_info, link_entitlements = link_configuration()

source = Path(os.environ.get('DOOMPILE_CLIPPER_DIR', str(REPO / 'extensions/clipper/dist/safari'))).expanduser().resolve()
if not (source / 'manifest.json').is_file():
    sys.exit('Build the clipper first: node extensions/clipper/build.mjs')
destination = ROOT / 'Safari/Resources'
if destination.exists():
    shutil.rmtree(destination)
shutil.copytree(source, destination)
editor_source = REPO / 'packages/editor/dist'
editor_destination = ROOT / 'Doompile/EditorResources'
if not (editor_source / 'editor.html').is_file():
    sys.exit('Build the offline editor first: npm run editor:build')
if editor_destination.exists():
    shutil.rmtree(editor_destination)
shutil.copytree(editor_source, editor_destination)

def plist(path, value):
    (ROOT / path).write_bytes(plistlib.dumps(value, sort_keys=False))

base = {
    'DoompileBuildCommit': build_commit,
    'CFBundleDevelopmentRegion': 'ru',
    'ITSAppUsesNonExemptEncryption': False,
    'CFBundleExecutable': '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleInfoDictionaryVersion': '6.0',
    'CFBundleName': '$(PRODUCT_NAME)',
    'CFBundlePackageType': '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString': '$(MARKETING_VERSION)',
    'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
    'DoompileKeychainGroup': '$(AppIdentifierPrefix)app.doompile.shared',
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
}
plist('Doompile/Info.plist', {
    **base, **link_info, 'CFBundleDisplayName': 'Doompile', 'LSRequiresIPhoneOS': True,
    'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False},
    'UISupportedInterfaceOrientations': ['UIInterfaceOrientationPortrait'],
    'UILaunchScreen': {'UIColorName': 'LaunchBackground'},
    'NSMicrophoneUsageDescription': 'Запиши голосовую заметку и сохрани её в Doompile.',
    'CFBundleURLTypes': [{'CFBundleURLName': 'app.doompile', 'CFBundleURLSchemes': ['doompile']}],
})
plist('Share/Info.plist', {
    **base, 'CFBundleDisplayName': 'Doompile',
    'NSExtension': {
        'NSExtensionPointIdentifier': 'com.apple.share-services',
        'NSExtensionPrincipalClass': '$(PRODUCT_MODULE_NAME).ShareViewController',
        'NSExtensionAttributes': {
            'NSExtensionJavaScriptPreprocessingFile': 'Preprocess',
            'NSExtensionActivationRule': {
                'NSExtensionActivationSupportsText': True,
                'NSExtensionActivationSupportsWebURLWithMaxCount': 1,
                'NSExtensionActivationSupportsWebPageWithMaxCount': 1,
                'NSExtensionActivationSupportsImageWithMaxCount': 20,
                'NSExtensionActivationSupportsMovieWithMaxCount': 1,
                'NSExtensionActivationSupportsFileWithMaxCount': 20,
            },
        },
    },
})
# A separate action keeps Doompile in both the app row and the quick-action list.
(ROOT / 'Action').mkdir(exist_ok=True)
action_info = plistlib.loads((ROOT / 'Share/Info.plist').read_bytes())
action_info['CFBundleDisplayName'] = 'Сохранить в Doompile'
action_info['CFBundleIcons'] = {'CFBundlePrimaryIcon': {'CFBundleIconFiles': ['SaveAction']}}
action_info['CFBundleIconFile'] = 'SaveAction'
action_info['NSExtension']['NSExtensionPointIdentifier'] = 'com.apple.ui-services'
plist('Action/Info.plist', action_info)
plist('Safari/Info.plist', {
    **base, 'CFBundleDisplayName': 'Doompile Clipper',
    'NSExtension': {
        'NSExtensionPointIdentifier': 'com.apple.Safari.web-extension',
        'NSExtensionPrincipalClass': '$(PRODUCT_MODULE_NAME).SafariWebExtensionHandler',
    },
})
for folder in ['Doompile', 'Share', 'Safari', 'Action']:
    plist(folder + '/App.entitlements', {
        'com.apple.security.application-groups': ['group.app.doompile'],
        'keychain-access-groups': ['$(AppIdentifierPrefix)app.doompile.shared'],
        **(link_entitlements if folder == 'Doompile' else {}),
    })

assets = ROOT / 'Doompile/Assets.xcassets'
(assets / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
(assets / 'AppIcon.appiconset/Contents.json').write_text(json.dumps({'images': [{'filename': 'AppIcon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
# Launch colors and artwork are exported by npm run shared:generate.

objects = {}
def ident(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
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

shared = [file(str(path.relative_to(ROOT)), 'sourcecode.swift') for path in sorted((ROOT / 'Shared').glob('*.swift'))]
app_sources = [file(str(path.relative_to(ROOT)), 'sourcecode.swift') for path in sorted((ROOT / 'Doompile').glob('*.swift'))]
editor_resources = file('Doompile/EditorResources', 'folder')
share = file('Share/ShareViewController.swift', 'sourcecode.swift')
safari = file('Safari/SafariWebExtensionHandler.swift', 'sourcecode.swift')
icon = file('Doompile/Assets.xcassets', 'folder.assetcatalog')
brand_assets = file('../../packages/design/BrandAssets.xcassets', 'folder.assetcatalog')
preprocess = file('Share/Preprocess.js', 'sourcecode.javascript')
action_icons = [file('Action/' + name, 'image.png') for name in ['SaveAction@2x.png', 'SaveAction@3x.png']]
safari_resources = []
for resource in sorted(destination.iterdir()):
    extension = resource.suffix
    filetype = 'folder' if resource.is_dir() else {'.js': 'sourcecode.javascript', '.json': 'text.json', '.html': 'text.html', '.css': 'text.css'}.get(extension, 'text')
    safari_resources.append(file(str(resource.relative_to(ROOT)), filetype))
for folder in ['Doompile', 'Share', 'Safari', 'Action']:
    file(folder + '/Info.plist', 'text.plist.xml')
    file(folder + '/App.entitlements', 'text.plist.entitlements')

products = {}
targets = {}
configurations = {}
for target, folder, product, bundle in [
    ('Doompile', 'Doompile', 'application', 'app.doompile'),
    ('DoompileShare', 'Share', 'app-extension', 'app.doompile.share'),
    ('DoompileAction', 'Action', 'app-extension', 'app.doompile.action'),
    ('DoompileSafari', 'Safari', 'app-extension', 'app.doompile.safari')]:
    extension = 'app' if product == 'application' else 'appex'
    products[target] = obj('product:' + target, 'PBXFileReference', explicitFileType=q('wrapper.application' if extension == 'app' else 'wrapper.app-extension'), includeInIndex='0', path=q(target + '.' + extension), sourceTree=q('BUILT_PRODUCTS_DIR'))
    configs = []
    for name in ['Debug', 'Release']:
        settings = {
            'PRODUCT_BUNDLE_IDENTIFIER': q(bundle), 'PRODUCT_NAME': q('$(TARGET_NAME)'),
            'INFOPLIST_FILE': q(folder + '/Info.plist'), 'CODE_SIGN_ENTITLEMENTS': q(folder + '/App.entitlements'),
            'CODE_SIGN_STYLE': q('$(DOOMPILE_SIGNING_STYLE)'), 'DOOMPILE_SIGNING_STYLE': q('Automatic'),
            'PROVISIONING_PROFILE_SPECIFIER': q('$(DOOMPILE_PROFILE_' + ('APP' if target == 'Doompile' else 'SHARE' if target == 'DoompileShare' else 'ACTION' if target == 'DoompileAction' else 'SAFARI') + ')'), 'SWIFT_VERSION': '5.0', 'OTHER_LDFLAGS': q('$(inherited) -lsqlite3'), 'IPHONEOS_DEPLOYMENT_TARGET': '17.0',
            'TARGETED_DEVICE_FAMILY': q('1'), 'CURRENT_PROJECT_VERSION': '1', 'MARKETING_VERSION': '0.1.0',
            'ENABLE_USER_SCRIPT_SANDBOXING': 'YES', 'GENERATE_INFOPLIST_FILE': 'NO',
            'LD_RUNPATH_SEARCH_PATHS': q('$(inherited) @executable_path/Frameworks' + (' @executable_path/../../Frameworks' if product != 'application' else '')),
            'SWIFT_STRICT_CONCURRENCY': q('minimal'),
        }
        if product == 'application':
            settings.update(ASSETCATALOG_COMPILER_APPICON_NAME=q('AppIcon'), ENABLE_PREVIEWS='YES', SWIFT_EMIT_LOC_STRINGS='YES')
        else:
            settings.update(APPLICATION_EXTENSION_API_ONLY='YES', SKIP_INSTALL='YES')
        configs.append(obj('config:' + target + name, 'XCBuildConfiguration', buildSettings='{' + ' '.join(k+' = '+v+';' for k,v in settings.items()) + '}', name=q(name)))
    configurations[target] = obj('configs:' + target, 'XCConfigurationList', buildConfigurations=arr(configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
    sources = shared + (app_sources if target == 'Doompile' else [share] if target in ['DoompileShare', 'DoompileAction'] else [safari])
    sources_phase = obj('sources:' + target, 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=arr([obj('compile:' + target + resource, 'PBXBuildFile', fileRef=resource) for resource in sources]), runOnlyForDeploymentPostprocessing='0')
    resources = [icon, brand_assets, editor_resources] if target == 'Doompile' else [preprocess, brand_assets] if target == 'DoompileShare' else [preprocess, brand_assets] + action_icons if target == 'DoompileAction' else safari_resources
    resources_phase = obj('resources:' + target, 'PBXResourcesBuildPhase', buildActionMask='2147483647', files=arr([obj('resource:' + target + resource, 'PBXBuildFile', fileRef=resource) for resource in resources]), runOnlyForDeploymentPostprocessing='0')
    frameworks_phase = obj('frameworks:' + target, 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files='()', runOnlyForDeploymentPostprocessing='0')
    dependencies = []
    phases = [sources_phase, frameworks_phase, resources_phase]
    if target == 'Doompile':
        embedded = []
        for child in ['DoompileShare', 'DoompileSafari', 'DoompileAction']:
            proxy = obj('proxy:' + child, 'PBXContainerItemProxy', containerPortal=ident('project'), proxyType='1', remoteGlobalIDString=ident('target:' + child), remoteInfo=q(child))
            dependencies.append(obj('dependency:' + child, 'PBXTargetDependency', target=ident('target:' + child), targetProxy=proxy))
            embedded.append(obj('embed:' + child, 'PBXBuildFile', fileRef=ident('product:' + child), settings='{ATTRIBUTES = (RemoveHeadersOnCopy, );}'))
        phases.append(obj('embedExtensions', 'PBXCopyFilesBuildPhase', buildActionMask='2147483647', dstPath=q(''), dstSubfolderSpec='13', files=arr(embedded), name=q('Embed App Extensions'), runOnlyForDeploymentPostprocessing='0'))
    targets[target] = obj('target:' + target, 'PBXNativeTarget', buildConfigurationList=configurations[target], buildPhases=arr(phases), buildRules='()', dependencies=arr(dependencies), name=q(target), productName=q(target), productReference=products[target], productType=q('com.apple.product-type.' + product))

# UI regression tests run against the actual SwiftUI/WKWebView shell.
ui_source = file('UITests/TouchUXTests.swift', 'sourcecode.swift')
ui_name = 'DoompileUITests'
products[ui_name] = obj('product:' + ui_name, 'PBXFileReference', explicitFileType=q('wrapper.cfbundle'), includeInIndex='0', path=q(ui_name + '.xctest'), sourceTree=q('BUILT_PRODUCTS_DIR'))
ui_configs = []
for name in ['Debug', 'Release']:
    ui_settings = {
        'PRODUCT_BUNDLE_IDENTIFIER': q('app.doompile.uitests'), 'PRODUCT_NAME': q('$(TARGET_NAME)'),
        'GENERATE_INFOPLIST_FILE': 'YES', 'SWIFT_VERSION': '5.0', 'OTHER_LDFLAGS': q('$(inherited) -lsqlite3'), 'IPHONEOS_DEPLOYMENT_TARGET': '17.0',
        'TARGETED_DEVICE_FAMILY': '1', 'TEST_TARGET_NAME': q('Doompile'),
        'CODE_SIGN_STYLE': q('Automatic'), 'SWIFT_STRICT_CONCURRENCY': q('minimal'),
    }
    ui_configs.append(obj('config:' + ui_name + name, 'XCBuildConfiguration', buildSettings='{' + ' '.join(k+' = '+v+';' for k,v in ui_settings.items()) + '}', name=q(name)))
ui_configuration = obj('configs:' + ui_name, 'XCConfigurationList', buildConfigurations=arr(ui_configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
ui_phase = obj('sources:' + ui_name, 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=arr([obj('compile:' + ui_name, 'PBXBuildFile', fileRef=ui_source)]), runOnlyForDeploymentPostprocessing='0')
ui_frameworks = obj('frameworks:' + ui_name, 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files='()', runOnlyForDeploymentPostprocessing='0')
ui_proxy = obj('proxy:UITestHost', 'PBXContainerItemProxy', containerPortal=ident('project'), proxyType='1', remoteGlobalIDString=targets['Doompile'], remoteInfo=q('Doompile'))
ui_dependency = obj('dependency:UITestHost', 'PBXTargetDependency', target=targets['Doompile'], targetProxy=ui_proxy)
targets[ui_name] = obj('target:' + ui_name, 'PBXNativeTarget', buildConfigurationList=ui_configuration, buildPhases=arr([ui_phase, ui_frameworks]), buildRules='()', dependencies=arr([ui_dependency]), name=q(ui_name), productName=q(ui_name), productReference=products[ui_name], productType=q('com.apple.product-type.bundle.ui-testing'))

products_group = obj('products', 'PBXGroup', children=arr(list(products.values())), name=q('Products'), sourceTree=q('<group>'))
main_group = obj('main', 'PBXGroup', children=arr(file_ids + [products_group]), sourceTree=q('<group>'))
project_configs = []
for name in ['Debug', 'Release']:
    settings = '{CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_OPTIMIZATION_LEVEL = ' + q('-Onone' if name == 'Debug' else '-O') + '; DEBUG_INFORMATION_FORMAT = ' + q('dwarf' if name == 'Debug' else 'dwarf-with-dsym') + '; SWIFT_ACTIVE_COMPILATION_CONDITIONS = ' + q('DEBUG $(inherited)' if name == 'Debug' else '$(inherited)') + ';}'
    project_configs.append(obj('projectConfig:' + name, 'XCBuildConfiguration', buildSettings=settings, name=q(name)))
project_config = obj('projectConfigs', 'XCConfigurationList', buildConfigurations=arr(project_configs), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))
project = obj('project', 'PBXProject', attributes='{LastUpgradeCheck = 2620; BuildIndependentTargetsInParallel = YES;}', buildConfigurationList=project_config, compatibilityVersion=q('Xcode 14.0'), developmentRegion=q('ru'), hasScannedForEncodings='0', knownRegions='(ru, en, Base,)', mainGroup=main_group, productRefGroup=products_group, projectDirPath=q(''), projectRoot=q(''), targets=arr(list(targets.values())))
project_dir = ROOT / 'Doompile.xcodeproj'
project_dir.mkdir(exist_ok=True)
(project_dir / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(k + ' = ' + v for k, v in objects.items()) + '\n}; rootObject = ' + project + '; }\n')
scheme_dir = project_dir / 'xcshareddata/xcschemes'
scheme_dir.mkdir(parents=True, exist_ok=True)
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2620" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['Doompile']}" BuildableName="Doompile.app" BlueprintName="Doompile" ReferencedContainer="container:Doompile.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['DoompileUITests']}" BuildableName="DoompileUITests.xctest" BlueprintName="DoompileUITests" ReferencedContainer="container:Doompile.xcodeproj"/></TestableReference></Testables></TestAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['Doompile']}" BuildableName="Doompile.app" BlueprintName="Doompile" ReferencedContainer="container:Doompile.xcodeproj"/></BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['Doompile']}" BuildableName="Doompile.app" BlueprintName="Doompile" ReferencedContainer="container:Doompile.xcodeproj"/></BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(scheme_dir / 'Doompile.xcscheme').write_text(scheme)
print('Generated apps/ios/Doompile.xcodeproj with app, Share Extension, Save Action and Safari Web Extension.')
