use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub(crate) const MAX_PDF_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PDF_PAGES: usize = 256;
const MAX_EXTRACTED_CHARS: usize = 256 * 1024;
const MAX_HELPER_OUTPUT_BYTES: u64 = 320 * 1024;
const MAX_HELPER_ERROR_BYTES: u64 = 4 * 1024;
const EXTRACTION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfExtraction {
    pub content: String,
    pub page_count: usize,
    pub source_digest: String,
    pub warning: Option<String>,
}

pub(crate) fn extract_in_helper(path: &Path) -> Result<PdfExtraction, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the PDF extraction helper: {error}"))?;
    let mut child = Command::new(executable)
        .arg("--extract-pdf")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the PDF extraction helper: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "PDF extraction helper stdin is unavailable.".to_string())?;
    serde_json::to_writer(&mut stdin, &path.to_path_buf())
        .map_err(|error| format!("Could not send the selected PDF to the helper: {error}"))?;
    drop(stdin);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "PDF extraction helper stdout is unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "PDF extraction helper stderr is unavailable.".to_string())?;
    let output_reader = std::thread::spawn(move || read_bounded(stdout, MAX_HELPER_OUTPUT_BYTES));
    let error_reader = std::thread::spawn(move || read_bounded(stderr, MAX_HELPER_ERROR_BYTES));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not monitor PDF extraction: {error}"))?
        {
            break status;
        }
        if started.elapsed() >= EXTRACTION_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("PDF extraction exceeded the 15 second limit.".to_string());
        }
        std::thread::sleep(Duration::from_millis(10));
    };

    let output = join_reader(output_reader, "output")?;
    let diagnostic = join_reader(error_reader, "diagnostic")?;
    if !status.success() {
        let message = String::from_utf8_lossy(&diagnostic);
        return Err(if message.trim().is_empty() {
            "PDF extraction failed.".to_string()
        } else {
            format!("PDF extraction failed. {}", message.trim())
        });
    }
    serde_json::from_slice(&output)
        .map_err(|error| format!("PDF extraction returned an invalid result: {error}"))
}

pub fn run_helper() -> Result<(), String> {
    let path: PathBuf = serde_json::from_reader(std::io::stdin().take(32 * 1024))
        .map_err(|error| format!("PDF extraction received an invalid path: {error}"))?;
    let extraction = extract_document(&path)?;
    serde_json::to_writer(std::io::stdout(), &extraction)
        .map_err(|error| format!("Could not return PDF extraction: {error}"))?;
    std::io::stdout()
        .flush()
        .map_err(|error| format!("Could not flush PDF extraction: {error}"))
}

fn extract_document(path: &Path) -> Result<PdfExtraction, String> {
    let title = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("selected PDF");
    let metadata = path
        .metadata()
        .map_err(|error| format!("Could not inspect {title}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{title} is not a file."));
    }
    if metadata.len() > MAX_PDF_BYTES {
        return Err(format!("{title} exceeds the 16 MiB PDF limit."));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_PDF_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("Could not read {title}: {error}"))?;
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(format!("{title} exceeds the 16 MiB PDF limit."));
    }
    extract_bytes(&bytes, title)
}

fn extract_bytes(bytes: &[u8], title: &str) -> Result<PdfExtraction, String> {
    let result = std::panic::catch_unwind(|| extract_bytes_inner(bytes, title));
    result.map_err(|_| format!("{title} is malformed and could not be extracted."))?
}

fn extract_bytes_inner(bytes: &[u8], title: &str) -> Result<PdfExtraction, String> {
    let document = pdf_extract::Document::load_mem(bytes)
        .map_err(|_| format!("{title} is not a readable PDF."))?;
    if document.is_encrypted() {
        return Err(format!(
            "{title} is encrypted. Password-protected PDFs are not supported."
        ));
    }
    let page_count = document.get_pages().len();
    if page_count == 0 {
        return Err(format!("{title} has no pages."));
    }
    if page_count > MAX_PDF_PAGES {
        return Err(format!("{title} exceeds the {MAX_PDF_PAGES} page limit."));
    }
    drop(document);

    let pages = pdf_extract::extract_text_from_mem_by_pages(bytes)
        .map_err(|_| format!("Text could not be extracted from {title}."))?;
    if pages.len() != page_count {
        return Err(format!(
            "Text could not be extracted from every page of {title}."
        ));
    }

    let mut content = String::new();
    let mut empty_pages = 0_usize;
    let mut extracted_chars = 0_usize;
    for (index, page) in pages.into_iter().enumerate() {
        let page = sanitize_text(&page);
        let page = page.trim();
        if page.is_empty() {
            empty_pages += 1;
        }
        extracted_chars = extracted_chars.saturating_add(page.chars().count());
        if extracted_chars > MAX_EXTRACTED_CHARS {
            return Err(format!(
                "Extracted text from {title} exceeds the 262,144 character limit."
            ));
        }
        if !content.is_empty() {
            content.push_str("\n\n");
        }
        content.push_str(&format!("## Page {}\n\n", index + 1));
        content.push_str(if page.is_empty() {
            "[No extractable text on this page.]"
        } else {
            page
        });
    }
    if empty_pages == page_count {
        return Err(format!(
            "{title} has no extractable text. OCR is not available yet."
        ));
    }

    Ok(PdfExtraction {
        content,
        page_count,
        source_digest: format!("{:x}", Sha256::digest(bytes)),
        warning: (empty_pages > 0).then(|| {
            format!(
                "{empty_pages} of {page_count} pages had no extractable text. OCR was not used."
            )
        }),
    })
}

fn sanitize_text(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '\n' | '\r' | '\t' => character,
            value if value.is_control() => ' ',
            value => value,
        })
        .collect()
}

fn read_bounded(mut reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read PDF helper output: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err("PDF extraction exceeded its output limit.".to_string());
    }
    Ok(bytes)
}

fn join_reader(
    handle: std::thread::JoinHandle<Result<Vec<u8>, String>>,
    stream: &str,
) -> Result<Vec<u8>, String> {
    handle
        .join()
        .map_err(|_| format!("PDF helper {stream} reader stopped unexpectedly."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_extract::content::{Content, Operation};
    use pdf_extract::{dictionary, Document, Object, Stream};

    /// One positioned text run on a page: x, y, text.
    type Run<'a> = (i64, i64, &'a str);

    fn pdf_with_pages(pages: &[Option<&str>]) -> Vec<u8> {
        let runs = pages
            .iter()
            .map(|text| text.map_or_else(Vec::new, |text| vec![(72, 720, text)]))
            .collect::<Vec<_>>();
        pdf_with_page_runs(&runs)
    }

    fn pdf_with_page_runs(pages: &[Vec<Run>]) -> Vec<u8> {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let page_ids = pages
            .iter()
            .map(|runs| {
                let operations = runs
                    .iter()
                    .flat_map(|(x, y, text)| {
                        vec![
                            Operation::new("BT", vec![]),
                            Operation::new("Tf", vec!["F1".into(), 12.into()]),
                            Operation::new("Td", vec![(*x).into(), (*y).into()]),
                            Operation::new("Tj", vec![Object::string_literal(*text)]),
                            Operation::new("ET", vec![]),
                        ]
                    })
                    .collect::<Vec<_>>();
                let content = Content { operations }.encode().expect("encode page");
                let content_id = document.add_object(Stream::new(dictionary! {}, content));
                document.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "Contents" => content_id,
                })
            })
            .collect::<Vec<_>>();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => page_ids.into_iter().map(Object::Reference).collect::<Vec<_>>(),
                "Count" => pages.len() as i64,
                "Resources" => resources_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).expect("serialize PDF");
        bytes
    }

    #[test]
    fn extracts_page_markers_digest_and_partial_text_warning() {
        let bytes = pdf_with_pages(&[Some("First page"), None, Some("Third page")]);

        let extraction = extract_bytes(&bytes, "report.pdf").expect("extract PDF");

        assert_eq!(extraction.page_count, 3);
        assert!(extraction.content.contains("## Page 1\n\nFirst page"));
        assert!(extraction
            .content
            .contains("## Page 2\n\n[No extractable text on this page.]"));
        assert!(extraction.content.contains("## Page 3\n\nThird page"));
        assert_eq!(extraction.source_digest.len(), 64);
        assert_eq!(
            extraction.warning.as_deref(),
            Some("1 of 3 pages had no extractable text. OCR was not used.")
        );
    }

    #[test]
    fn rejects_malformed_and_image_only_pdfs() {
        assert!(extract_bytes(b"not a pdf", "broken.pdf")
            .expect_err("reject malformed PDF")
            .contains("readable PDF"));
        let image_only = pdf_with_pages(&[None]);
        assert!(extract_bytes(&image_only, "scan.pdf")
            .expect_err("reject image-only PDF")
            .contains("OCR is not available"));
    }

    // Document-intake fixture corpus. The report fixture reproduces, with
    // synthetic text, the shapes measured on a 21-page research PDF whose
    // license forbids checking in excerpts: a legal footer and a margin
    // number rail on every content page, section headings, a figure whose
    // chart data survives only as disordered axis labels, a footnote line
    // carrying a source URL and observation date, and a disclosure tail.
    const REPORT_FOOTER: &str = "REVIEW THE IMPORTANT DISCLOSURES AT THE END OF THIS DOCUMENT.";
    const REPORT_FOOTNOTE: &str =
        "3. Datasource https://example.com/asset/profile (Date: 9/7/2021)";
    const REPORT_FIGURE_CAPTION: &str = "FIGURE 2: TOTAL TOKEN DISTRIBUTION";
    const REPORT_PAGES: usize = 5;

    fn margin_rail(runs: &mut Vec<Run<'static>>) {
        for (index, label) in ["1", "2", "3", "4", "5", "6", "7"].iter().enumerate() {
            runs.push((20, 700 - (index as i64) * 24, label));
        }
    }

    fn report_shaped_pdf() -> Vec<u8> {
        let mut pages: Vec<Vec<Run>> = Vec::new();

        let mut title = vec![
            (72, 720, "An Introduction to the Example Network"),
            (72, 680, "Background 4"),
            (72, 660, "Key Features 9"),
            (72, 30, REPORT_FOOTER),
        ];
        margin_rail(&mut title);
        pages.push(title);

        let mut background = vec![
            (72, 720, "Background"),
            (
                72,
                690,
                "The example network coordinates decentralized computers into a shared platform.",
            ),
            (72, 30, REPORT_FOOTER),
        ];
        margin_rail(&mut background);
        pages.push(background);

        let mut history = vec![
            (72, 720, "Brief History"),
            (
                72,
                690,
                "The project was founded in 2015 and distributed tokens over two years.",
            ),
            (72, 640, REPORT_FIGURE_CAPTION),
            (100, 600, "13.9B"),
            (140, 590, "31%"),
            (300, 600, "5.2B"),
            (340, 590, "17%"),
            (72, 60, REPORT_FOOTNOTE),
            (72, 30, REPORT_FOOTER),
        ];
        margin_rail(&mut history);
        pages.push(history);

        pages.push(vec![
            (72, 720, "Important Disclosures and Other Information"),
            (
                72,
                690,
                "All content is original and may not be reproduced without express consent.",
            ),
            (72, 30, REPORT_FOOTER),
        ]);
        pages.push(vec![
            (
                72,
                720,
                "This document is for informational purposes only and is not an offer to sell.",
            ),
            (72, 30, REPORT_FOOTER),
        ]);

        assert_eq!(pages.len(), REPORT_PAGES);
        pdf_with_page_runs(&pages)
    }

    // Reduced excerpt of IOHK, "Why We Are Building Cardano", Charles
    // Hoskinson, 2017-06-28, CC-BY 4.0. The glyph spacing inside the
    // running header reproduces the damage in the document's real text
    // layer, so extraction-quality diagnostics have a true positive.
    const ESSAY_HEADER: &str = "IOHK |  WHY WE A RE B UILDING C ARDANO | 0 6/28/2017";
    const ESSAY_PAGES: usize = 3;

    fn essay_excerpt_pdf() -> Vec<u8> {
        pdf_with_page_runs(&[
            vec![
                (72, 760, ESSAY_HEADER),
                (72, 700, "WHY WE A RE B UILDING CARDANO"),
                (72, 660, "1. Introduction"),
                (72, 630, "Motivation"),
                (
                    72,
                    600,
                    "Cardano is a project that began in 2015 as an effort to change the way",
                ),
                (72, 580, "cryptocurrencies are designed and developed."),
            ],
            vec![
                (72, 760, ESSAY_HEADER),
                (72, 700, "2. Science a nd E ngineering"),
                (
                    72,
                    670,
                    "The overall focus beyond a particular set of innovations is to provide a",
                ),
                (72, 650, "more balanced and sustainable ecosystem."),
            ],
            vec![
                (72, 760, ESSAY_HEADER),
                (72, 700, "3. Interoperability"),
                (
                    72,
                    670,
                    "Cardano did not begin with a comprehensive roadmap or even an",
                ),
                (72, 650, "authoritative white paper."),
            ],
        ])
    }

    // The two baselines freeze what extraction hands an agent today, so the
    // structural-extraction work has a measured before state. They assert
    // the current flat contract on purpose; changing that contract means
    // changing these expectations deliberately.
    #[test]
    fn intake_baseline_report_repeats_furniture_and_flattens_structure() {
        let extraction =
            extract_bytes(&report_shaped_pdf(), "report.pdf").expect("extract report fixture");

        assert_eq!(extraction.page_count, REPORT_PAGES);
        // The footer arrives once per page, indistinguishable from prose.
        assert_eq!(
            extraction.content.matches(REPORT_FOOTER).count(),
            REPORT_PAGES
        );
        // The margin rail's digits interleave the body text on content pages.
        assert!(extraction.content.contains('7'));
        // The footnote's URL and observation date survive only as a plain
        // line, bound to nothing.
        assert!(extraction.content.contains(REPORT_FOOTNOTE));
        // The figure survives as its caption plus bare axis labels; nothing
        // marks the chart data as lost.
        assert!(extraction.content.contains(REPORT_FIGURE_CAPTION));
        assert!(extraction.content.contains("13.9B"));
        // The only structure is the page marker: one heading per page and
        // no warning about any of the above.
        assert_eq!(extraction.content.matches("## Page ").count(), REPORT_PAGES);
        assert!(extraction.warning.is_none());
    }

    #[test]
    fn intake_baseline_essay_keeps_glyph_spacing_damage_unmarked() {
        let extraction =
            extract_bytes(&essay_excerpt_pdf(), "essay.pdf").expect("extract essay fixture");

        assert_eq!(extraction.page_count, ESSAY_PAGES);
        // The damaged running header repeats on every page, verbatim.
        assert_eq!(
            extraction.content.matches("B UILDING C ARDANO").count(),
            ESSAY_PAGES
        );
        // Damaged section headings read as broken words with no diagnostic.
        assert!(extraction.content.contains("Science a nd E ngineering"));
        assert!(extraction.warning.is_none());
    }
}
