#!/usr/bin/env swift
// Run from the repository root: swift scripts/generate-icons.swift
// Uses only macOS tools. build/icon.svg is the editable source of truth.
import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let build = root.appendingPathComponent("build")
let source = build.appendingPathComponent("icon.svg")
guard let image = NSImage(contentsOf: source) else {
    fatalError("Could not load \(source.path)")
}

func render(size: Int, to destination: URL) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not create a bitmap context")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    image.draw(in: rect, from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode PNG")
    }
    try data.write(to: destination)
}

let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }
let iconset = temporary.appendingPathComponent("icon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    try render(size: size, to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size: size * 2, to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try render(size: 1024, to: build.appendingPathComponent("icon.png"))

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["--convert", "icns", "--output", build.appendingPathComponent("icon.icns").path, iconset.path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Generated build/icon.png and build/icon.icns from build/icon.svg")
