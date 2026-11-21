use serde::Serialize;
use std::{fmt, io::Read, panic::catch_unwind};

const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_PDF_PAGES: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DocumentFormat {
  Pdf,
  Text,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum DocumentPickResult {
  Ready {
    name: String,
    format: DocumentFormat,
    sections: Vec<String>,
  },
  Cancelled,
  Empty,
  Inaccessible,
  Oversized,
  Scanned,
  Unsupported,
}

use DocumentPickResult::*;

pub(crate) fn extract_document(reader: impl Read, name: String, mime: &str) -> DocumentPickResult {
  let lowercase_name = name.to_ascii_lowercase();
  let format = if mime == "application/pdf" || lowercase_name.ends_with(".pdf") {
    DocumentFormat::Pdf
  } else if mime == "text/plain" || lowercase_name.ends_with(".txt") {
    DocumentFormat::Text
  } else {
    return Unsupported;
  };

  let max_bytes = match format {
    DocumentFormat::Pdf => MAX_INPUT_BYTES,
    DocumentFormat::Text => MAX_TEXT_BYTES,
  };
  let mut bytes = Vec::new();
  if reader
    .take((max_bytes + 1) as u64)
    .read_to_end(&mut bytes)
    .is_err()
  {
    return Inaccessible;
  }
  if bytes.len() > max_bytes {
    return Oversized;
  }

  let sections = match format {
    DocumentFormat::Pdf => {
      if !bytes.starts_with(b"%PDF-") {
        return Unsupported;
      }
      // The existing PDF parser can panic on malformed structures, not just return errors.
      match catch_unwind(|| extract_pdf(&bytes)).unwrap_or(Err(Unsupported)) {
        Ok(sections) => sections,
        Err(result) => return result,
      }
    }
    DocumentFormat::Text => {
      let Ok(text) = String::from_utf8(bytes) else {
        return Unsupported;
      };
      let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
      if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\t' | '\n' | '\r' | '\u{c}'))
      {
        return Unsupported;
      }
      if text.trim().is_empty() {
        return Empty;
      }
      vec![text.to_owned()]
    }
  };
  Ready {
    name,
    format,
    sections,
  }
}

struct BoundedPage {
  text: String,
  remaining: usize,
  overflow: bool,
}

impl fmt::Write for BoundedPage {
  fn write_str(&mut self, text: &str) -> fmt::Result {
    if text.len() > self.remaining {
      self.overflow = true;
      return Err(fmt::Error);
    }
    self.remaining -= text.len();
    self.text.push_str(text);
    Ok(())
  }
}

impl<'a> pdf_extract::ConvertToFmt for &'a mut BoundedPage {
  type Writer = Self;
  fn convert(self) -> Self::Writer {
    self
  }
}

fn extract_pdf(bytes: &[u8]) -> Result<Vec<String>, DocumentPickResult> {
  let document = pdf_extract::Document::load_mem(bytes).map_err(|_| Unsupported)?;
  if document.is_encrypted() {
    return Err(Unsupported);
  }
  let pages = document.get_pages();
  if pages.is_empty() {
    return Err(Unsupported);
  }
  if pages.len() > MAX_PDF_PAGES {
    return Err(Oversized);
  }

  let mut remaining = MAX_TEXT_BYTES;
  let mut sections = Vec::with_capacity(pages.len());
  for (page, object_id) in pages {
    let mut writer = BoundedPage {
      text: String::new(),
      remaining,
      overflow: false,
    };
    if !document.get_page_contents(object_id).is_empty() {
      let mut output = pdf_extract::PlainTextOutput::new(&mut writer);
      pdf_extract::output_doc_page(&document, &mut output, page).map_err(|_| {
        if writer.overflow {
          Oversized
        } else {
          Unsupported
        }
      })?;
    }
    remaining = writer.remaining;
    sections.push(writer.text.trim().to_owned());
  }
  if sections.iter().all(|page| page.trim().is_empty()) {
    return Err(Scanned);
  }
  Ok(sections)
}

#[cfg(test)]
mod tests {
  use super::*;
  use pdf_extract::{dictionary, Document, Object, Stream};

  fn pdf(pages: &[&str]) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let tree = doc.new_object_id();
    let font = doc.add_object(
      dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" },
    );
    let image = doc.add_object(Stream::new(
      dictionary! {
        "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
        "BitsPerComponent" => 8, "ColorSpace" => "DeviceGray",
      },
      vec![0],
    ));
    let kids = pages
      .iter()
      .map(|content| {
        let stream = doc.add_object(Stream::new(dictionary! {}, content.as_bytes().to_vec()));
        Object::Reference(doc.add_object(dictionary! {
          "Type" => "Page", "Parent" => tree, "Contents" => stream,
          "Resources" => dictionary! { "Font" => dictionary! { "F1" => font }, "XObject" => dictionary! { "I1" => image } },
        }))
      })
      .collect::<Vec<_>>();
    doc.objects.insert(
      tree,
      Object::Dictionary(dictionary! {
        "Type" => "Pages", "Count" => kids.len() as u32, "Kids" => kids,
        "MediaBox" => vec![0.into(), 0.into(), 200.into(), 200.into()],
      }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => tree });
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
  }

  #[test]
  fn extracts_pdf_pages_without_renumbering_blank_pages() {
    let bytes = pdf(&["", "BT /F1 12 Tf 10 100 Td (River on page two) Tj ET"]);
    let Ready {
      format: DocumentFormat::Pdf,
      sections,
      ..
    } = extract_document(&bytes[..], "source.pdf".into(), "application/pdf")
    else {
      panic!("expected extracted PDF pages");
    };
    assert_eq!(sections, ["", "River on page two"]);
  }

  #[test]
  fn detects_non_text_pdf_and_rejects_invalid_or_oversized_documents() {
    let bytes = pdf(&["q 32 0 0 32 0 0 cm /I1 Do Q"]);
    assert!(matches!(
      extract_document(&bytes[..], "scan.pdf".into(), "application/pdf"),
      Scanned
    ));
    assert!(matches!(
      extract_document(&b"%PDF-nope"[..], "bad.pdf".into(), "application/pdf"),
      Unsupported
    ));
    let pages = vec![""; MAX_PDF_PAGES + 1];
    assert!(matches!(
      extract_document(&pdf(&pages)[..], "large.pdf".into(), "application/pdf"),
      Oversized
    ));
    assert!(matches!(
      extract_document(std::io::repeat(0), "large.txt".into(), "text/plain"),
      Oversized
    ));
  }

  #[test]
  fn accepts_utf8_text_and_preserves_line_breaks_without_accepting_binary() {
    let text = "\u{feff}中文\r\n\r\nRiver\n";
    let Ready {
      format: DocumentFormat::Text,
      sections,
      ..
    } = extract_document(text.as_bytes(), "source.txt".into(), "text/plain")
    else {
      panic!("expected UTF-8 text");
    };
    assert_eq!(sections, ["中文\r\n\r\nRiver\n"]);
    assert!(matches!(
      extract_document(&b"\0\xff"[..], "invalid.txt".into(), "text/plain"),
      Unsupported
    ));
    assert!(matches!(
      extract_document(&b"hello"[..], "other.zip".into(), "application/zip"),
      Unsupported
    ));
    assert!(matches!(
      extract_document(&b" \n "[..], "empty.txt".into(), "text/plain"),
      Empty
    ));
  }
}
