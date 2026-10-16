import Foundation
import PDFKit
import Vision
import AppKit
let args = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: args[1]))!
let from = Int(args[2])!, to = min(Int(args[3])!, doc.pageCount)
for i in from...to {
  guard let page = doc.page(at: i-1) else { continue }
  let b = page.bounds(for: .mediaBox)
  let scale = 2400 / max(b.width, b.height)
  let img = page.thumbnail(of: NSSize(width: b.width*scale, height: b.height*scale), for: .mediaBox)
  guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let W = cg.width, H = cg.height
  print("=====PAGE \(i)=====")
  for col in 0..<2 {
    let rect = CGRect(x: col == 0 ? 0 : W/2, y: 0, width: W/2, height: H)
    guard let sub = cg.cropping(to: rect) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: sub).perform([req])
    let results: [VNRecognizedTextObservation] = req.results ?? []
    let obs = results.sorted { (a: VNRecognizedTextObservation, b: VNRecognizedTextObservation) in a.boundingBox.midY > b.boundingBox.midY }
    print("--col\(col)--")
    var prevBottom: CGFloat? = nil
    for o in obs {
      guard let t = o.topCandidates(1).first else { continue }
      let bb = o.boundingBox
      if let pb = prevBottom, pb - bb.maxY > bb.height * 0.9 { print("") }
      prevBottom = bb.minY
      print(t.string)
    }
  }
}
