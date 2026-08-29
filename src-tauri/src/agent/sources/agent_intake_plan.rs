//! The deterministic document-intake plan.
//!
//! A plan is the inspectable mapping from explicitly selected sources to
//! proposed concepts: split points from the structural classification,
//! exclusions with their reasons, the evidence inventory, and the named
//! gaps. It is computed in Rust with no model involved, is byte-identical
//! for the same sources regardless of selection order, and is never
//! authority: nothing runs, writes to a bundle, or fetches because a plan
//! exists. Saved plans keep source titles and fingerprints only, so no
//! absolute local path persists.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::agent_pdf_structure::{PdfFurnitureKind, PdfGapKind, PdfStructure};

pub(crate) const INTAKE_PLAN_SCHEMA_VERSION: u32 = 1;
const PLANS_FILE: &str = "intake-plans.json";
const MAX_SAVED_PLANS: usize = 32;
const MAX_PLAN_CONCEPTS: usize = 256;
const MAX_PLAN_EXCLUSIONS: usize = 256;
const MAX_PLAN_EVIDENCE: usize = 512;
const MAX_PLAN_GAPS: usize = 256;
const MAX_PLAN_OVERLAPS: usize = 128;
const MAX_PLAN_TEXT_CHARS: usize = 512;
const MAX_STORE_BYTES: u64 = 4 * 1024 * 1024;

/// What plan computation needs to know about one adapted source. Carries
/// identity and classification, never content or a filesystem path.
pub(crate) struct PlannedSource {
    pub title: String,
    pub media_type: String,
    pub page_count: usize,
    pub source_fingerprint: String,
    pub refresh_fingerprint: String,
    pub warning_codes: Vec<String>,
    pub structure: Option<PdfStructure>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlan {
    pub schema_version: u32,
    /// SHA-256 over the sorted refresh fingerprints: the same sources give
    /// the same id, so re-planning an unchanged selection is visible as such.
    pub plan_id: String,
    pub sources: Vec<IntakePlanSource>,
    pub concepts: Vec<IntakePlanConcept>,
    pub exclusions: Vec<IntakePlanExclusion>,
    pub evidence: Vec<IntakePlanEvidence>,
    pub gaps: Vec<IntakePlanGap>,
    /// Where sources overlap or disagree, surfaced rather than merged.
    #[serde(default)]
    pub overlaps: Vec<IntakePlanOverlap>,
    /// Items beyond the per-kind limits, named rather than silently dropped.
    pub omitted: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanSource {
    pub title: String,
    pub media_type: String,
    pub page_count: usize,
    pub source_fingerprint: String,
    pub refresh_fingerprint: String,
    pub warning_codes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanConcept {
    /// Stable within the plan: `c` plus the concept's position.
    pub id: String,
    pub title: String,
    pub source_title: String,
    /// Page and line locators. Zero pages mean the whole unpaged document.
    pub start_page: usize,
    pub start_line: usize,
    /// Exclusive upper bound: the next split point, or one past the end.
    pub until_page: usize,
    pub until_line: usize,
    /// The user's keep/drop adjustment. Computation proposes everything.
    pub included: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanExclusion {
    pub source_title: String,
    pub kind: String,
    pub text: String,
    pub occurrences: usize,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanEvidence {
    pub source_title: String,
    pub marker: u32,
    pub text: String,
    pub url: Option<String>,
    pub stated_date: Option<String>,
    pub page: usize,
}

/// Two or more sources touching the same thing. Detection is deterministic
/// and text-level: shared footnote URLs and same-titled split points. The
/// finding presents both sides with their stated dates; nothing is merged,
/// averaged, or preferred, matching the reliability vocabulary's stance.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanOverlap {
    /// "shared-evidence" for one URL cited by several sources,
    /// "same-topic" for one title proposed by several sources.
    pub kind: String,
    /// The URL or the normalized title the sources share.
    pub detail: String,
    pub source_titles: Vec<String>,
    /// Distinct stated observation dates for the shared detail. Two dates
    /// here are a freshness disagreement for review, not an error.
    pub stated_dates: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakePlanGap {
    pub source_title: String,
    pub kind: String,
    pub caption: String,
    pub page: usize,
}

/// Compute the plan. Sources are ordered by title and fingerprint before
/// anything else, so the same selection produces the same plan bytes no
/// matter which order the picker returned it in.
pub(crate) fn compute(sources: Vec<PlannedSource>) -> IntakePlan {
    let mut sources = sources;
    sources.sort_by(|left, right| {
        (left.title.as_str(), left.source_fingerprint.as_str())
            .cmp(&(right.title.as_str(), right.source_fingerprint.as_str()))
    });

    let mut fingerprints = sources
        .iter()
        .map(|source| source.refresh_fingerprint.clone())
        .collect::<Vec<_>>();
    fingerprints.sort();
    let plan_id = format!("{:x}", Sha256::digest(fingerprints.join("\n").as_bytes()));

    let mut concepts = Vec::new();
    let mut exclusions = Vec::new();
    let mut evidence = Vec::new();
    let mut gaps = Vec::new();

    for source in &sources {
        let Some(structure) = &source.structure else {
            // An unpaged source proposes itself as one concept.
            concepts.push(concept(
                concepts.len(),
                &source.title,
                &source.title,
                (0, 0),
                (0, 0),
            ));
            continue;
        };

        let split_level = structure.headings.iter().map(|heading| heading.level).min();
        let splits = structure
            .headings
            .iter()
            .filter(|heading| Some(heading.level) == split_level)
            .collect::<Vec<_>>();
        if splits.is_empty() {
            concepts.push(concept(
                concepts.len(),
                &source.title,
                &source.title,
                (1, 1),
                (source.page_count + 1, 1),
            ));
        } else {
            for (index, heading) in splits.iter().enumerate() {
                // The first span starts at the document start, so front
                // matter before the first heading is carried, not lost.
                let start = if index == 0 {
                    (1, 1)
                } else {
                    (heading.page, heading.line)
                };
                let until = splits
                    .get(index + 1)
                    .map(|next| (next.page, next.line))
                    .unwrap_or((source.page_count + 1, 1));
                concepts.push(concept(
                    concepts.len(),
                    &heading.text,
                    &source.title,
                    start,
                    until,
                ));
            }
        }

        for line in &structure.furniture {
            exclusions.push(IntakePlanExclusion {
                source_title: source.title.clone(),
                kind: match line.kind {
                    PdfFurnitureKind::RunningLine => "furniture-running-line".to_string(),
                    PdfFurnitureKind::MarginRail => "furniture-margin-rail".to_string(),
                },
                text: bounded(&line.text),
                occurrences: line.occurrences,
                reason: format!(
                    "Repeats {} times across pages in a stable position.",
                    line.occurrences
                ),
            });
        }
        for footnote in &structure.footnotes {
            evidence.push(IntakePlanEvidence {
                source_title: source.title.clone(),
                marker: footnote.marker,
                text: bounded(&footnote.text),
                url: footnote.url.clone(),
                stated_date: footnote.stated_date.clone(),
                page: footnote.page,
            });
        }
        for gap in &structure.gaps {
            gaps.push(IntakePlanGap {
                source_title: source.title.clone(),
                kind: match gap.kind {
                    PdfGapKind::Figure => "figure".to_string(),
                    PdfGapKind::Table => "table".to_string(),
                },
                caption: bounded(&gap.caption),
                page: gap.page,
            });
        }
    }

    let mut overlaps = detect_overlaps(&concepts, &evidence);
    let omitted = clamp(&mut concepts, MAX_PLAN_CONCEPTS)
        + clamp(&mut exclusions, MAX_PLAN_EXCLUSIONS)
        + clamp(&mut evidence, MAX_PLAN_EVIDENCE)
        + clamp(&mut gaps, MAX_PLAN_GAPS)
        + clamp(&mut overlaps, MAX_PLAN_OVERLAPS);

    IntakePlan {
        schema_version: INTAKE_PLAN_SCHEMA_VERSION,
        plan_id,
        sources: sources
            .into_iter()
            .map(|source| IntakePlanSource {
                title: source.title,
                media_type: source.media_type,
                page_count: source.page_count,
                source_fingerprint: source.source_fingerprint,
                refresh_fingerprint: source.refresh_fingerprint,
                warning_codes: source.warning_codes,
            })
            .collect(),
        concepts,
        exclusions,
        evidence,
        gaps,
        overlaps,
        omitted,
    }
}

fn detect_overlaps(
    concepts: &[IntakePlanConcept],
    evidence: &[IntakePlanEvidence],
) -> Vec<IntakePlanOverlap> {
    let mut overlaps = Vec::new();

    // One URL cited by several sources is shared evidence; its distinct
    // stated dates make a freshness disagreement visible.
    let mut by_url: Vec<(String, Vec<&IntakePlanEvidence>)> = Vec::new();
    for entry in evidence {
        let Some(url) = &entry.url else { continue };
        match by_url.iter_mut().find(|(key, _)| key == url) {
            Some((_, entries)) => entries.push(entry),
            None => by_url.push((url.clone(), vec![entry])),
        }
    }
    for (url, entries) in by_url {
        let mut source_titles = entries
            .iter()
            .map(|entry| entry.source_title.clone())
            .collect::<Vec<_>>();
        source_titles.sort();
        source_titles.dedup();
        if source_titles.len() < 2 {
            continue;
        }
        let mut stated_dates = entries
            .iter()
            .filter_map(|entry| entry.stated_date.clone())
            .collect::<Vec<_>>();
        stated_dates.sort();
        stated_dates.dedup();
        overlaps.push(IntakePlanOverlap {
            kind: "shared-evidence".to_string(),
            detail: url,
            source_titles,
            stated_dates,
        });
    }

    // One title proposed from several sources is the same topic twice.
    // Leading list numbering is stripped so "1. Introduction" and
    // "Introduction" meet.
    let mut by_title: Vec<(String, Vec<&IntakePlanConcept>)> = Vec::new();
    for concept in concepts {
        let key = topic_key(&concept.title);
        if key.is_empty() {
            continue;
        }
        match by_title.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, entries)) => entries.push(concept),
            None => by_title.push((key, vec![concept])),
        }
    }
    for (key, entries) in by_title {
        let mut source_titles = entries
            .iter()
            .map(|concept| concept.source_title.clone())
            .collect::<Vec<_>>();
        source_titles.sort();
        source_titles.dedup();
        if source_titles.len() < 2 {
            continue;
        }
        overlaps.push(IntakePlanOverlap {
            kind: "same-topic".to_string(),
            detail: key,
            source_titles,
            stated_dates: Vec::new(),
        });
    }

    overlaps
}

/// Case-folded title with leading section numbering removed.
fn topic_key(title: &str) -> String {
    let trimmed = title.trim();
    let without_number = trimmed
        .find(|value: char| !(value.is_ascii_digit() || value == '.'))
        .map(|cut| trimmed[cut..].trim_start())
        .unwrap_or("");
    without_number.to_lowercase()
}

/// One source position in a rerun, named per source title.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeSourceChange {
    pub title: String,
    /// "unchanged", "changed", "new", or "missing".
    pub state: String,
}

/// A rerun of a saved plan against freshly picked documents: the new plan
/// with the saved keep/drop marks carried over where a concept survived,
/// each source named by what happened to it, and the concepts fed by a
/// changed or new source. Nothing is staged from this; it is an impact
/// report the user acts on.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunIntakeReport {
    pub saved_plan_id: String,
    pub plan: IntakePlan,
    pub sources: Vec<crate::agent_sources::AgentSourceInput>,
    pub changes: Vec<IntakeSourceChange>,
    pub affected_concepts: Vec<String>,
    pub unchanged: bool,
}

/// Diff a fresh plan against the saved one. Pure, so a rerun is exactly as
/// deterministic as the plans it compares.
pub(crate) fn diff_rerun(
    saved: &IntakePlan,
    mut fresh: IntakePlan,
) -> (IntakePlan, Vec<IntakeSourceChange>, Vec<String>) {
    let mut changes = Vec::new();
    for source in &saved.sources {
        let state = match fresh
            .sources
            .iter()
            .find(|candidate| candidate.title == source.title)
        {
            Some(candidate) if candidate.refresh_fingerprint == source.refresh_fingerprint => {
                "unchanged"
            }
            Some(_) => "changed",
            None => "missing",
        };
        changes.push(IntakeSourceChange {
            title: source.title.clone(),
            state: state.to_string(),
        });
    }
    for source in &fresh.sources {
        if !saved
            .sources
            .iter()
            .any(|candidate| candidate.title == source.title)
        {
            changes.push(IntakeSourceChange {
                title: source.title.clone(),
                state: "new".to_string(),
            });
        }
    }
    changes.sort_by(|left, right| left.title.cmp(&right.title));

    // Keep/drop marks survive where the concept does.
    for concept in &mut fresh.concepts {
        if let Some(previous) = saved.concepts.iter().find(|candidate| {
            candidate.source_title == concept.source_title && candidate.title == concept.title
        }) {
            concept.included = previous.included;
        }
    }

    let unstable = changes
        .iter()
        .filter(|change| change.state != "unchanged")
        .map(|change| change.title.clone())
        .collect::<Vec<_>>();
    let mut affected = fresh
        .concepts
        .iter()
        .filter(|concept| unstable.contains(&concept.source_title))
        .map(|concept| concept.title.clone())
        .collect::<Vec<_>>();
    for concept in &saved.concepts {
        if changes
            .iter()
            .any(|change| change.state == "missing" && change.title == concept.source_title)
        {
            affected.push(concept.title.clone());
        }
    }
    affected.sort();
    affected.dedup();

    (fresh, changes, affected)
}

fn concept(
    index: usize,
    title: &str,
    source_title: &str,
    start: (usize, usize),
    until: (usize, usize),
) -> IntakePlanConcept {
    IntakePlanConcept {
        id: format!("c{index}"),
        title: bounded(title),
        source_title: source_title.to_string(),
        start_page: start.0,
        start_line: start.1,
        until_page: until.0,
        until_line: until.1,
        included: true,
    }
}

fn bounded(text: &str) -> String {
    text.chars().take(MAX_PLAN_TEXT_CHARS).collect()
}

fn clamp<T>(items: &mut Vec<T>, limit: usize) -> usize {
    let over = items.len().saturating_sub(limit);
    items.truncate(limit);
    over
}

/// A computed plan beside the attachment evidence it was computed from. The
/// sources half lives only in the running session: saving keeps the plan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedIntake {
    pub plan: IntakePlan,
    pub sources: Vec<crate::agent_sources::AgentSourceInput>,
}

/// A saved plan: the plan plus when and for which granted bundle. The
/// bundle root scopes listing; the plan itself carries no path.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedIntakePlan {
    pub bundle_root: String,
    pub saved_at: String,
    pub plan: IntakePlan,
}

pub struct IntakePlanState {
    file: PathBuf,
    plans: Mutex<Vec<SavedIntakePlan>>,
}

impl IntakePlanState {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Studio could not locate intake-plan storage: {error}"))?;
        Ok(Self::load_from(data.join(PLANS_FILE)))
    }

    pub fn load_from(file: PathBuf) -> Self {
        let plans = fs::metadata(&file)
            .ok()
            .filter(|metadata| metadata.len() <= MAX_STORE_BYTES)
            .and_then(|_| fs::read(&file).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<SavedIntakePlan>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|saved| validate_plan(&saved.plan).is_ok())
            .take(MAX_SAVED_PLANS)
            .collect();
        Self {
            file,
            plans: Mutex::new(plans),
        }
    }

    pub fn save(&self, bundle_root: &str, plan: IntakePlan) -> Result<SavedIntakePlan, String> {
        validate_plan(&plan)?;
        let saved = SavedIntakePlan {
            bundle_root: bundle_root.to_string(),
            saved_at: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
            plan,
        };
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| "Intake-plan storage is unavailable.".to_string())?;
        plans.retain(|entry| {
            entry.bundle_root != saved.bundle_root || entry.plan.plan_id != saved.plan.plan_id
        });
        plans.insert(0, saved.clone());
        plans.truncate(MAX_SAVED_PLANS);
        self.persist(&plans)?;
        Ok(saved)
    }

    pub fn list(&self, bundle_root: &str) -> Result<Vec<SavedIntakePlan>, String> {
        let plans = self
            .plans
            .lock()
            .map_err(|_| "Intake-plan storage is unavailable.".to_string())?;
        Ok(plans
            .iter()
            .filter(|entry| entry.bundle_root == bundle_root)
            .cloned()
            .collect())
    }

    pub fn remove(&self, bundle_root: &str, plan_id: &str) -> Result<bool, String> {
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| "Intake-plan storage is unavailable.".to_string())?;
        let before = plans.len();
        plans.retain(|entry| entry.bundle_root != bundle_root || entry.plan.plan_id != plan_id);
        let removed = plans.len() != before;
        if removed {
            self.persist(&plans)?;
        }
        Ok(removed)
    }

    fn persist(&self, plans: &[SavedIntakePlan]) -> Result<(), String> {
        let bytes = serde_json::to_vec(plans)
            .map_err(|error| format!("Could not serialize intake plans: {error}"))?;
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not prepare intake-plan storage: {error}"))?;
        }
        fs::write(&self.file, bytes)
            .map_err(|error| format!("Could not save intake plans: {error}"))
    }
}

/// A plan arriving over IPC is data from the webview: bounded and shaped, or
/// rejected. Nothing here grants anything, so validation is about storage
/// hygiene rather than authority.
fn validate_plan(plan: &IntakePlan) -> Result<(), String> {
    if plan.schema_version != INTAKE_PLAN_SCHEMA_VERSION {
        return Err("The intake plan uses an unknown schema version.".to_string());
    }
    if plan.plan_id.len() != 64 || !plan.plan_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("The intake plan id is not a fingerprint.".to_string());
    }
    if plan.sources.is_empty() || plan.sources.len() > crate::agent_sources::MAX_SOURCE_ATTACHMENTS
    {
        return Err("The intake plan names an unusable number of sources.".to_string());
    }
    if plan.concepts.len() > MAX_PLAN_CONCEPTS
        || plan.exclusions.len() > MAX_PLAN_EXCLUSIONS
        || plan.evidence.len() > MAX_PLAN_EVIDENCE
        || plan.gaps.len() > MAX_PLAN_GAPS
        || plan.overlaps.len() > MAX_PLAN_OVERLAPS
    {
        return Err("The intake plan exceeds its structural limits.".to_string());
    }
    let mut texts = plan
        .sources
        .iter()
        .flat_map(|source| [&source.title, &source.media_type])
        .chain(
            plan.concepts
                .iter()
                .flat_map(|c| [&c.title, &c.source_title]),
        )
        .chain(
            plan.exclusions
                .iter()
                .flat_map(|e| [&e.text, &e.reason, &e.kind, &e.source_title]),
        )
        .chain(plan.evidence.iter().map(|e| &e.text))
        .chain(plan.gaps.iter().map(|g| &g.caption));
    if texts.any(|text| {
        text.chars().count() > MAX_PLAN_TEXT_CHARS || text.chars().any(char::is_control)
    }) {
        return Err("The intake plan contains oversized or control text.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_pdf_structure::analyze;

    fn pdf_source(title: &str, fingerprint: &str, pages: &[&str]) -> PlannedSource {
        let pages = pages
            .iter()
            .map(|page| page.to_string())
            .collect::<Vec<_>>();
        PlannedSource {
            title: title.to_string(),
            media_type: "application/pdf".to_string(),
            page_count: pages.len(),
            source_fingerprint: format!("sha256-{fingerprint}"),
            refresh_fingerprint: format!("sha256-refresh-{fingerprint}"),
            warning_codes: Vec::new(),
            structure: Some(analyze(&pages)),
        }
    }

    fn text_source(title: &str, fingerprint: &str) -> PlannedSource {
        PlannedSource {
            title: title.to_string(),
            media_type: "text/markdown".to_string(),
            page_count: 0,
            source_fingerprint: format!("sha256-{fingerprint}"),
            refresh_fingerprint: format!("sha256-refresh-{fingerprint}"),
            warning_codes: Vec::new(),
            structure: None,
        }
    }

    const FOOTER: &str = "REVIEW THE IMPORTANT DISCLOSURES AT THE END OF THIS DOCUMENT.";

    fn report_pages() -> Vec<String> {
        vec![
            format!("An Introduction to the Example Network\n{FOOTER}"),
            format!("Background\nThe example network coordinates computers.\n{FOOTER}"),
            format!("Brief History\nFIGURE 2: TOTAL TOKEN DISTRIBUTION\n3. Datasource https://example.com/asset (Date: 9/7/2021)\n{FOOTER}"),
        ]
    }

    fn report_source(order_title: &str) -> PlannedSource {
        let pages = report_pages();
        PlannedSource {
            title: order_title.to_string(),
            media_type: "application/pdf".to_string(),
            page_count: pages.len(),
            source_fingerprint: "sha256-aaa".to_string(),
            refresh_fingerprint: "sha256-refresh-aaa".to_string(),
            warning_codes: vec!["pdf-repeated-furniture".to_string()],
            structure: Some(analyze(&pages)),
        }
    }

    #[test]
    fn splits_at_top_level_headings_and_carries_front_matter() {
        let plan = compute(vec![report_source("report.pdf")]);

        let titles = plan
            .concepts
            .iter()
            .map(|concept| concept.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            titles,
            vec![
                "An Introduction to the Example Network",
                "Background",
                "Brief History"
            ]
        );
        // The first span starts at the document start; the last runs to the
        // exclusive end; every concept starts included.
        assert_eq!(
            (plan.concepts[0].start_page, plan.concepts[0].start_line),
            (1, 1)
        );
        assert_eq!(
            (plan.concepts[1].start_page, plan.concepts[1].start_line),
            (2, 1)
        );
        assert_eq!(
            (plan.concepts[2].until_page, plan.concepts[2].until_line),
            (4, 1)
        );
        assert!(plan.concepts.iter().all(|concept| concept.included));

        // Furniture is the exclusion list, with its reason.
        assert!(plan
            .exclusions
            .iter()
            .any(|exclusion| exclusion.kind == "furniture-running-line"
                && exclusion.text == FOOTER
                && exclusion.occurrences == 3));
        // The footnote is the evidence inventory; the figure is a named gap.
        assert_eq!(plan.evidence.len(), 1);
        assert_eq!(
            plan.evidence[0].url.as_deref(),
            Some("https://example.com/asset")
        );
        assert_eq!(plan.gaps.len(), 1);
        assert_eq!(plan.omitted, 0);
    }

    #[test]
    fn identical_sources_in_any_order_produce_identical_plans() {
        let first = compute(vec![
            report_source("report.pdf"),
            text_source("notes.md", "bbb"),
        ]);
        let second = compute(vec![
            text_source("notes.md", "bbb"),
            report_source("report.pdf"),
        ]);

        assert_eq!(first, second);
        assert_eq!(first.plan_id.len(), 64);
    }

    #[test]
    fn different_sources_produce_a_different_plan_id() {
        let one = compute(vec![text_source("notes.md", "bbb")]);
        let other = compute(vec![text_source("notes.md", "ccc")]);
        assert_ne!(one.plan_id, other.plan_id);
    }

    #[test]
    fn an_unpaged_or_headingless_source_proposes_one_concept() {
        let headingless = pdf_source(
            "scan.pdf",
            "ddd",
            &[
                "prose only, lowercase, nothing heads it.",
                "second page of the same.",
            ],
        );
        let plan = compute(vec![headingless, text_source("notes.md", "bbb")]);

        assert_eq!(plan.concepts.len(), 2);
        assert!(plan
            .concepts
            .iter()
            .any(|concept| concept.title == "notes.md" && concept.start_page == 0));
        assert!(plan
            .concepts
            .iter()
            .any(|concept| concept.title == "scan.pdf" && concept.until_page == 3));
    }

    #[test]
    fn shared_urls_and_same_titles_across_sources_become_overlaps() {
        let one = pdf_source(
            "report-2021.pdf",
            "aaa",
            &["Background\nProse one.\n3. Datasource https://example.com/shared (Date: 9/7/2021)"],
        );
        let two = pdf_source(
            "essay-2017.pdf",
            "bbb",
            &["1. Background\nProse two.\n5. Datasource https://example.com/shared (Date: 6/28/2017)"],
        );
        let plan = compute(vec![one, two]);

        let shared = plan
            .overlaps
            .iter()
            .find(|overlap| overlap.kind == "shared-evidence")
            .expect("surface the shared URL");
        assert_eq!(shared.detail, "https://example.com/shared");
        assert_eq!(shared.source_titles.len(), 2);
        // Two stated dates for one URL is a freshness disagreement, shown
        // as both positions rather than a winner.
        assert_eq!(
            shared.stated_dates,
            vec!["6/28/2017".to_string(), "9/7/2021".to_string()]
        );

        let topic = plan
            .overlaps
            .iter()
            .find(|overlap| overlap.kind == "same-topic")
            .expect("surface the shared topic");
        assert_eq!(topic.detail, "background");

        // A single-source plan has no overlaps to invent.
        let alone = compute(vec![report_source("report.pdf")]);
        assert!(alone.overlaps.is_empty());
    }

    #[test]
    fn rerunning_an_unchanged_selection_reports_nothing_affected() {
        let saved = compute(vec![report_source("report.pdf")]);
        let fresh = compute(vec![report_source("report.pdf")]);

        let (plan, changes, affected) = diff_rerun(&saved, fresh);

        assert_eq!(plan.plan_id, saved.plan_id);
        assert!(changes.iter().all(|change| change.state == "unchanged"));
        assert!(affected.is_empty());
    }

    #[test]
    fn a_changed_source_names_exactly_its_concepts_and_keeps_survive() {
        let mut saved = compute(vec![
            report_source("report.pdf"),
            text_source("notes.md", "bbb"),
        ]);
        // The user had dropped one concept in the saved plan.
        let dropped = saved
            .concepts
            .iter()
            .position(|concept| concept.title == "Background")
            .expect("saved plan proposes Background");
        saved.concepts[dropped].included = false;

        // The report changed on disk; the notes did not.
        let mut changed_report = report_source("report.pdf");
        changed_report.refresh_fingerprint = "sha256-refresh-zzz".to_string();
        let fresh = compute(vec![changed_report, text_source("notes.md", "bbb")]);

        let (plan, changes, affected) = diff_rerun(&saved, fresh);

        assert_eq!(
            changes
                .iter()
                .map(|change| (change.title.as_str(), change.state.as_str()))
                .collect::<Vec<_>>(),
            vec![("notes.md", "unchanged"), ("report.pdf", "changed")]
        );
        // The impact names the changed source's concepts and nothing else.
        assert!(affected.contains(&"Background".to_string()));
        assert!(!affected.contains(&"notes.md".to_string()));
        // The keep/drop mark survived the rerun.
        let background = plan
            .concepts
            .iter()
            .find(|concept| concept.title == "Background")
            .expect("fresh plan proposes Background");
        assert!(!background.included);
    }

    #[test]
    fn a_missing_source_reports_its_saved_concepts_as_affected() {
        let saved = compute(vec![
            report_source("report.pdf"),
            text_source("notes.md", "bbb"),
        ]);
        let fresh = compute(vec![text_source("notes.md", "bbb")]);

        let (_, changes, affected) = diff_rerun(&saved, fresh);

        assert!(changes
            .iter()
            .any(|change| change.title == "report.pdf" && change.state == "missing"));
        assert!(affected.contains(&"Background".to_string()));
    }

    #[test]
    fn saving_listing_and_removing_plans_is_bundle_scoped() {
        let dir = std::env::temp_dir().join(format!("okf-intake-plans-{}", uuid::Uuid::new_v4()));
        let state = IntakePlanState::load_from(dir.join(PLANS_FILE));
        let plan = compute(vec![report_source("report.pdf")]);

        let saved = state
            .save("C:/bundles/alpha", plan.clone())
            .expect("save plan");
        assert_eq!(saved.plan.plan_id, plan.plan_id);
        // Re-saving the same plan replaces it rather than duplicating it.
        state
            .save("C:/bundles/alpha", plan.clone())
            .expect("save again");
        assert_eq!(state.list("C:/bundles/alpha").expect("list").len(), 1);
        assert_eq!(state.list("C:/bundles/beta").expect("list").len(), 0);

        // A fresh load from disk sees the same plans.
        let reloaded = IntakePlanState::load_from(dir.join(PLANS_FILE));
        assert_eq!(reloaded.list("C:/bundles/alpha").expect("list").len(), 1);

        assert!(state
            .remove("C:/bundles/alpha", &plan.plan_id)
            .expect("remove"));
        assert!(!state
            .remove("C:/bundles/alpha", &plan.plan_id)
            .expect("remove again"));
        assert_eq!(state.list("C:/bundles/alpha").expect("list").len(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_forged_plan_is_rejected_on_save() {
        let dir = std::env::temp_dir().join(format!("okf-intake-plans-{}", uuid::Uuid::new_v4()));
        let state = IntakePlanState::load_from(dir.join(PLANS_FILE));

        let mut forged = compute(vec![report_source("report.pdf")]);
        forged.plan_id = "not-a-fingerprint".to_string();
        assert!(state.save("C:/bundles/alpha", forged).is_err());

        let mut hostile = compute(vec![report_source("report.pdf")]);
        hostile.concepts[0].title = "control\u{0007}character".to_string();
        assert!(state.save("C:/bundles/alpha", hostile).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
