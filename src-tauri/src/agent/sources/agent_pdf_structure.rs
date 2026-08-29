//! Structural analysis over extracted PDF page text.
//!
//! The analysis is deterministic, offline, and purely textual: it reads the
//! sanitized per-page text the extraction helper already produces and
//! classifies what a page dump flattens. Furniture is classified, never
//! removed, so the evidence text stays byte-identical and review can
//! reinstate anything the classification got wrong.

use serde::{Deserialize, Serialize};

pub(crate) const STRUCTURE_SCHEMA_VERSION: u32 = 1;

const MAX_FURNITURE_LINES: usize = 256;
const MAX_HEADINGS: usize = 512;
const MAX_FOOTNOTES: usize = 512;
const MAX_GAPS: usize = 256;

/// A repeated line needs at least this many characters to count as a running
/// header or footer; shorter repeats are too ambiguous to classify.
const MIN_RUNNING_LINE_CHARS: usize = 8;
/// An unnumbered heading candidate keeps at most this many words.
const MAX_HEADING_WORDS: usize = 8;
const MAX_HEADING_CHARS: usize = 80;
/// Below this many intra-word splits the damage diagnostic stays advisory
/// rather than a receipt warning.
const GLYPH_SPACING_WARNING_COUNT: u64 = 3;
/// Furniture claiming at least this share of extracted characters becomes a
/// receipt warning, because the agent would mostly read repeated chrome.
const FURNITURE_SHARE_WARNING_PERCENT: u64 = 25;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfStructure {
    pub schema_version: u32,
    pub furniture: Vec<PdfFurnitureLine>,
    pub headings: Vec<PdfHeading>,
    pub footnotes: Vec<PdfFootnote>,
    pub gaps: Vec<PdfGap>,
    pub diagnostics: Vec<PdfStructureDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PdfFurnitureKind {
    /// A line repeating across pages: a running header, footer, or watermark.
    RunningLine,
    /// A short digit-only line repeating across pages: a page-margin rail.
    MarginRail,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfFurnitureLine {
    pub text: String,
    pub kind: PdfFurnitureKind,
    /// How many times the line occurs across the whole document.
    pub occurrences: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfHeading {
    pub text: String,
    pub level: u8,
    pub page: usize,
    pub line: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfFootnote {
    pub marker: u32,
    pub text: String,
    pub page: usize,
    pub line: usize,
    pub url: Option<String>,
    /// The observation date the footnote itself states, kept verbatim.
    pub stated_date: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PdfGapKind {
    Figure,
    Table,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfGap {
    pub kind: PdfGapKind,
    pub caption: String,
    pub page: usize,
    pub line: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfStructureDiagnostic {
    pub code: String,
    pub message: String,
    pub measure: u64,
    /// Whether the diagnostic is severe enough for the adapter receipt.
    pub warning: bool,
}

impl PdfStructure {
    /// Diagnostics severe enough to surface as adapter-receipt warnings.
    pub(crate) fn promoted(&self) -> impl Iterator<Item = &PdfStructureDiagnostic> {
        self.diagnostics.iter().filter(|entry| entry.warning)
    }
}

/// Analyze sanitized per-page text into a structural classification.
pub(crate) fn analyze(pages: &[String]) -> PdfStructure {
    let page_lines = pages
        .iter()
        .map(|page| {
            page.lines()
                .enumerate()
                .map(|(index, line)| (index + 1, line.trim()))
                .filter(|(_, line)| !line.is_empty())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut furniture = classify_furniture(&page_lines);
    let furniture_texts = furniture
        .iter()
        .map(|line| line.text.clone())
        .collect::<Vec<_>>();

    let mut headings = Vec::new();
    let mut footnotes = Vec::new();
    let mut gaps = Vec::new();
    for (page_index, lines) in page_lines.iter().enumerate() {
        let page = page_index + 1;
        for (line_number, line) in lines {
            let normalized = normalize(line);
            if furniture_texts.contains(&normalized) {
                continue;
            }
            if let Some(gap) = classify_gap(line, page, *line_number) {
                gaps.push(gap);
                continue;
            }
            if let Some(footnote) = classify_footnote(line, page, *line_number) {
                footnotes.push(footnote);
                continue;
            }
            if let Some(heading) = classify_heading(line, page, *line_number) {
                headings.push(heading);
            }
        }
    }

    let mut diagnostics = Vec::new();
    let truncated = truncate(&mut headings, MAX_HEADINGS)
        + truncate(&mut footnotes, MAX_FOOTNOTES)
        + truncate(&mut gaps, MAX_GAPS)
        + truncate(&mut furniture, MAX_FURNITURE_LINES);

    let total_chars: usize = page_lines
        .iter()
        .flatten()
        .map(|(_, line)| line.chars().count())
        .sum();
    let furniture_chars: usize = furniture
        .iter()
        .map(|line| line.text.chars().count() * line.occurrences)
        .sum();
    if !furniture.is_empty() {
        let share = if total_chars == 0 {
            0
        } else {
            (furniture_chars as u64 * 100) / total_chars as u64
        };
        diagnostics.push(PdfStructureDiagnostic {
            code: "pdf-repeated-furniture".to_string(),
            message: format!(
                "{} repeated line(s) classified as page furniture, {share} percent of the extracted characters. The classification is recorded, not removed.",
                furniture.len()
            ),
            measure: share,
            warning: share >= FURNITURE_SHARE_WARNING_PERCENT,
        });
    }

    let splits = count_glyph_spacing_splits(&page_lines);
    if splits > 0 {
        diagnostics.push(PdfStructureDiagnostic {
            code: "pdf-glyph-spacing".to_string(),
            message: format!(
                "Extracted text shows {splits} intra-word split(s). The PDF's text layer may be damaged, and derived text should be checked against the rendered document."
            ),
            measure: splits,
            warning: splits >= GLYPH_SPACING_WARNING_COUNT,
        });
    }

    if truncated > 0 {
        diagnostics.push(PdfStructureDiagnostic {
            code: "pdf-structure-truncated".to_string(),
            message: format!(
                "{truncated} structural item(s) beyond the per-kind limits were dropped from this classification."
            ),
            measure: truncated as u64,
            warning: false,
        });
    }

    PdfStructure {
        schema_version: STRUCTURE_SCHEMA_VERSION,
        furniture,
        headings,
        footnotes,
        gaps,
        diagnostics,
    }
}

fn truncate<T>(items: &mut Vec<T>, limit: usize) -> usize {
    let over = items.len().saturating_sub(limit);
    items.truncate(limit);
    over
}

fn normalize(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn classify_furniture(page_lines: &[Vec<(usize, &str)>]) -> Vec<PdfFurnitureLine> {
    let threshold = 3.max(page_lines.len().div_ceil(2));
    let mut order = Vec::new();
    let mut counts: std::collections::HashMap<String, (usize, Vec<usize>)> =
        std::collections::HashMap::new();
    for (page_index, lines) in page_lines.iter().enumerate() {
        for (_, line) in lines {
            let normalized = normalize(line);
            let entry = counts.entry(normalized.clone()).or_insert_with(|| {
                order.push(normalized);
                (0, Vec::new())
            });
            entry.0 += 1;
            if entry.1.last() != Some(&page_index) {
                entry.1.push(page_index);
            }
        }
    }
    order
        .into_iter()
        .filter_map(|text| {
            let (occurrences, pages) = counts.remove(&text)?;
            if pages.len() < threshold {
                return None;
            }
            let is_rail = text.len() <= 2 && text.chars().all(|value| value.is_ascii_digit());
            let kind = if is_rail {
                PdfFurnitureKind::MarginRail
            } else if text.chars().count() >= MIN_RUNNING_LINE_CHARS {
                PdfFurnitureKind::RunningLine
            } else {
                return None;
            };
            Some(PdfFurnitureLine {
                text,
                kind,
                occurrences,
            })
        })
        .collect()
}

fn classify_gap(line: &str, page: usize, line_number: usize) -> Option<PdfGap> {
    let kind = ["FIGURE", "TABLE", "EXHIBIT", "CHART"]
        .into_iter()
        .find(|prefix| {
            line.strip_prefix(prefix)
                .and_then(|rest| rest.strip_prefix(' '))
                .is_some_and(|rest| rest.trim_start().starts_with(|c: char| c.is_ascii_digit()))
        })?;
    Some(PdfGap {
        kind: if kind == "TABLE" {
            PdfGapKind::Table
        } else {
            PdfGapKind::Figure
        },
        caption: line.to_string(),
        page,
        line: line_number,
    })
}

/// A numbered line is a footnote only when it names a source: it carries a
/// URL or a stated date. Without either, flat text cannot tell a footnote
/// from a numbered heading, so the line stays a heading candidate. Position
/// deliberately plays no part, because margin artifacts push a real
/// footnote out of any bottom-of-page zone.
fn classify_footnote(line: &str, page: usize, line_number: usize) -> Option<PdfFootnote> {
    let digits = line
        .chars()
        .take_while(|value| value.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() || digits.len() > 3 {
        return None;
    }
    let rest = line[digits.len()..].strip_prefix(". ")?;
    if rest.trim().is_empty() {
        return None;
    }
    let url = find_url(rest);
    let stated_date = find_stated_date(rest);
    if url.is_none() && stated_date.is_none() {
        return None;
    }
    Some(PdfFootnote {
        marker: digits.parse().ok()?,
        text: rest.trim().to_string(),
        page,
        line: line_number,
        stated_date,
        url,
    })
}

fn find_url(text: &str) -> Option<String> {
    let start = text.find("https://").or_else(|| text.find("http://"))?;
    let candidate = &text[start..];
    let end = candidate
        .find(char::is_whitespace)
        .unwrap_or(candidate.len());
    Some(
        candidate[..end]
            .trim_end_matches([')', '.', ','])
            .to_string(),
    )
}

fn find_stated_date(text: &str) -> Option<String> {
    if let Some(start) = text.find("(Date:") {
        let candidate = &text[start + "(Date:".len()..];
        let end = candidate.find(')')?;
        return Some(candidate[..end].trim().to_string());
    }
    text.split_whitespace()
        .map(|token| token.trim_end_matches([')', '.', ',']))
        .find(|token| {
            token.len() >= 6
                && token.matches('/').count() == 2
                && token
                    .chars()
                    .all(|value| value.is_ascii_digit() || value == '/')
        })
        .map(str::to_string)
}

fn classify_heading(line: &str, page: usize, line_number: usize) -> Option<PdfHeading> {
    let text = normalize(line);
    let chars = text.chars().count();
    if !(3..=MAX_HEADING_CHARS).contains(&chars)
        || text.ends_with(['.', ',', ';', ':'])
        || text.contains("http://")
        || text.contains("https://")
    {
        return None;
    }
    if let Some(level) = numbered_heading_level(&text) {
        return Some(PdfHeading {
            text,
            level,
            page,
            line: line_number,
        });
    }
    let words = text.split_whitespace().collect::<Vec<_>>();
    if words.is_empty() || words.len() > MAX_HEADING_WORDS {
        return None;
    }
    const CONNECTORS: [&str; 11] = [
        "and", "of", "the", "a", "an", "to", "in", "for", "on", "with", "at",
    ];
    let title_cased = words.iter().all(|word| {
        word.chars().next().is_some_and(char::is_uppercase) || CONNECTORS.contains(word)
    });
    let alphabetic = words.iter().all(|word| {
        word.chars()
            .all(|value| value.is_alphabetic() || value == '-')
    });
    (title_cased && alphabetic).then_some(PdfHeading {
        text,
        level: 1,
        page,
        line: line_number,
    })
}

fn numbered_heading_level(text: &str) -> Option<u8> {
    let mut level = 1u8;
    let mut rest = text;
    loop {
        let digits = rest
            .chars()
            .take_while(|value| value.is_ascii_digit())
            .count();
        if digits == 0 || digits > 3 {
            return None;
        }
        rest = &rest[digits..];
        match rest.chars().next() {
            Some('.') => {
                rest = &rest[1..];
                if rest.starts_with(|value: char| value.is_ascii_digit()) {
                    level = level.saturating_add(1).min(6);
                    continue;
                }
            }
            Some(' ') => {}
            _ => return None,
        }
        let after = rest.trim_start();
        return after
            .starts_with(char::is_uppercase)
            .then_some(level.min(6));
    }
}

/// Count intra-word splits such as "B UILDING" or "E ngineering": a stray
/// single-letter token continued by the next token. The single-letter words
/// of ordinary English ("a", "A", "I") are excluded, so clean prose counts
/// zero and damage still counts every page it repeats on.
fn count_glyph_spacing_splits(page_lines: &[Vec<(usize, &str)>]) -> u64 {
    let mut count = 0u64;
    for lines in page_lines {
        for (_, line) in lines {
            let tokens = line.split_whitespace().collect::<Vec<_>>();
            for pair in tokens.windows(2) {
                let [first, second] = pair else { continue };
                let single = first.chars().count() == 1
                    && first.chars().all(char::is_alphabetic)
                    && !matches!(*first, "a" | "A" | "I" | "i");
                let continued = second.chars().count() >= 2
                    && second.chars().next().is_some_and(char::is_alphabetic);
                if single && continued {
                    count += 1;
                }
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|text| text.to_string()).collect()
    }

    #[test]
    fn classifies_running_lines_and_margin_rails_without_removing_them() {
        let footer = "REVIEW THE IMPORTANT DISCLOSURES AT THE END OF THIS DOCUMENT.";
        let structure = analyze(&pages(&[
            &format!("Background\n1\n2\nBody prose one.\n{footer}"),
            &format!("Brief History\n1\n2\nBody prose two.\n{footer}"),
            &format!("Summary\n1\n2\nBody prose three.\n{footer}"),
        ]));

        let running = structure
            .furniture
            .iter()
            .find(|line| line.kind == PdfFurnitureKind::RunningLine)
            .expect("classify the footer");
        assert_eq!(running.text, footer);
        assert_eq!(running.occurrences, 3);
        let rails = structure
            .furniture
            .iter()
            .filter(|line| line.kind == PdfFurnitureKind::MarginRail)
            .count();
        assert_eq!(rails, 2);
        assert_eq!(
            structure.diagnostics[0].code, "pdf-repeated-furniture",
            "classification is a recorded diagnostic"
        );
    }

    #[test]
    fn short_repeats_are_not_running_lines() {
        let structure = analyze(&pages(&["Prose.\nOK", "Prose.\nOK", "Prose.\nOK"]));
        assert!(structure.furniture.iter().all(|line| line.text != "OK"));
    }

    #[test]
    fn recognizes_numbered_and_title_case_headings_and_skips_prose() {
        let structure = analyze(&pages(&[
            "1. Introduction\nMotivation\n2.1 Deeper Detail\nThe prose of this page runs long and ends with a period.\nBackground 4",
        ]));

        let texts = structure
            .headings
            .iter()
            .map(|heading| (heading.text.as_str(), heading.level))
            .collect::<Vec<_>>();
        assert_eq!(
            texts,
            vec![
                ("1. Introduction", 1),
                ("Motivation", 1),
                ("2.1 Deeper Detail", 2),
            ],
            "the trailing-number TOC line and terminal-period prose stay out"
        );
    }

    #[test]
    fn binds_source_naming_footnotes_and_keeps_bare_numbered_lines_as_headings() {
        let structure = analyze(&pages(&[
            "1. Introduction\nProse line.\n3. Datasource https://example.com/asset/profile (Date: 9/7/2021)\nTrailing prose after the footnote.",
        ]));

        assert_eq!(structure.footnotes.len(), 1);
        let footnote = &structure.footnotes[0];
        assert_eq!(footnote.marker, 3);
        assert_eq!(
            footnote.url.as_deref(),
            Some("https://example.com/asset/profile")
        );
        assert_eq!(footnote.stated_date.as_deref(), Some("9/7/2021"));
        assert_eq!(footnote.page, 1);
        // The numbered line at the top of the page stays a heading.
        assert_eq!(structure.headings[0].text, "1. Introduction");
    }

    #[test]
    fn figure_and_table_captions_become_named_gaps() {
        let structure = analyze(&pages(&[
            "FIGURE 2: TOTAL TOKEN DISTRIBUTION\nTABLE 1: SUMMARY\nFIGURE X: NOT NUMBERED",
        ]));

        assert_eq!(structure.gaps.len(), 2);
        assert_eq!(structure.gaps[0].kind, PdfGapKind::Figure);
        assert_eq!(structure.gaps[1].kind, PdfGapKind::Table);
    }

    #[test]
    fn glyph_spacing_damage_fires_a_warning_and_clean_prose_stays_silent() {
        let damaged = analyze(&pages(&[
            "WHY WE A RE B UILDING C ARDANO\n2. Science a nd E ngineering",
        ]));
        let diagnostic = damaged
            .diagnostics
            .iter()
            .find(|entry| entry.code == "pdf-glyph-spacing")
            .expect("detect damage");
        assert!(diagnostic.warning);
        assert!(diagnostic.measure >= GLYPH_SPACING_WARNING_COUNT);

        let clean = analyze(&pages(&[
            "An Introduction to the Example Network\nThe network is a shared platform and I like it.",
        ]));
        assert!(clean
            .diagnostics
            .iter()
            .all(|entry| entry.code != "pdf-glyph-spacing"));
    }

    #[test]
    fn heavy_furniture_share_promotes_to_a_receipt_warning() {
        let footer = "REVIEW THE IMPORTANT DISCLOSURES AT THE END OF THIS DOCUMENT.";
        let heavy = analyze(&pages(&[
            &format!("Tiny.\n{footer}"),
            &format!("Tiny.\n{footer}"),
            &format!("Tiny.\n{footer}"),
        ]));
        assert!(heavy
            .promoted()
            .any(|entry| entry.code == "pdf-repeated-furniture"));

        // Body lines stay unique per page so only the footer repeats.
        let light_body = |page: usize| {
            format!(
                "Page {page} carries a long paragraph of ordinary body prose that keeps the repeated footer well under the warning share threshold for classified furniture characters here. It continues with a second sentence so the share stays low."
            )
        };
        let light = analyze(&pages(&[
            &format!("{}\n{footer}", light_body(1)),
            &format!("{}\n{footer}", light_body(2)),
            &format!("{}\n{footer}", light_body(3)),
        ]));
        let diagnostic = light
            .diagnostics
            .iter()
            .find(|entry| entry.code == "pdf-repeated-furniture")
            .expect("still recorded");
        assert!(!diagnostic.warning);
    }

    #[test]
    fn overflowing_structural_items_truncate_with_a_diagnostic() {
        let many_headings = (0..600)
            .map(|index| format!("{}. Heading", index + 1))
            .collect::<Vec<_>>()
            .join("\n");
        let structure = analyze(&pages(&[&many_headings]));

        assert_eq!(structure.headings.len(), MAX_HEADINGS);
        let diagnostic = structure
            .diagnostics
            .iter()
            .find(|entry| entry.code == "pdf-structure-truncated")
            .expect("report the drop");
        assert!(!diagnostic.warning);
    }
}
