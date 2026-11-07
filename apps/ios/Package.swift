// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DoompileCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "DoompileCore", targets: ["DoompileCore"])],
    targets: [
        .target(name: "DoompileCore", path: "Shared", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "DoompileCoreTests", dependencies: ["DoompileCore"], path: "Tests")
    ]
)
