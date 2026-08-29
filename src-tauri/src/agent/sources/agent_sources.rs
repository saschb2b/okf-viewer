use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::agent_source_adapter::{self, SourceAdapterReceipt, SourceDiscovery};

pub(crate) const MAX_SOURCE_ATTACHMENTS: usize = 8;
pub(crate) const MAX_SOURCE_CONTENT_CHARS: usize = 256 * 1024;
pub(crate) const MAX_SOURCE_TOTAL_CHARS: usize = 512 * 1024;
pub(crate) const MAX_SOURCE_TITLE_CHARS: usize = 256;
pub(crate) const MAX_SOURCE_ORIGIN_CHARS: usize = 2_048;
pub(crate) const MAX_IMAGE_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
pub(crate) const MAX_IMAGE_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES: u64 = MAX_SOURCE_CONTENT_CHARS as u64;
const MAX_SELECTED_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FOLDER_DEPTH: usize = 8;
const MAX_FOLDER_ENTRIES: usize = 4_096;

struct SourcePath {
    path: PathBuf,
    title: String,
    discovery: SourceDiscovery,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSourceInput {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) origin: Option<String>,
    pub(crate) media_type: Option<String>,
    pub(crate) source_digest: Option<String>,
    pub(crate) warning: Option<String>,
    pub(crate) image_data: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) adapter_receipt: Option<SourceAdapterReceipt>,
}

pub(crate) fn pick_text_sources(
    app: &AppHandle,
    requested_limit: usize,
) -> Result<Vec<AgentSourceInput>, String> {
    if requested_limit == 0 {
        return Err("The source tray is full.".to_string());
    }
    let limit = requested_limit.min(MAX_SOURCE_ATTACHMENTS);
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "PDF, text, Markdown, HTML, CSV, JSON, and OpenAPI YAML",
            &[
                "pdf", "txt", "md", "markdown", "html", "htm", "csv", "json", "yaml", "yml",
            ],
        )
        .blocking_pick_files()
        .unwrap_or_default();
    if selected.len() > limit {
        return Err(format!("Select at most {limit} more source files."));
    }
    let paths = selected
        .into_iter()
        .map(|path| {
            path.into_path().map_err(|_| {
                "A selected source path is not available on this platform.".to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    read_text_sources(&paths, limit)
}

pub(crate) fn pick_source_folder(
    app: &AppHandle,
    requested_limit: usize,
) -> Result<Vec<AgentSourceInput>, String> {
    if requested_limit == 0 {
        return Err("The source tray is full.".to_string());
    }
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(Vec::new());
    };
    let root = selected
        .into_path()
        .map_err(|_| "The selected source folder is not available on this platform.".to_string())?;
    read_folder_sources(&root, requested_limit.min(MAX_SOURCE_ATTACHMENTS))
}

pub(crate) fn pick_image_sources(
    app: &AppHandle,
    requested_limit: usize,
) -> Result<Vec<AgentSourceInput>, String> {
    if requested_limit == 0 {
        return Err("The source tray is full.".to_string());
    }
    let limit = requested_limit.min(MAX_SOURCE_ATTACHMENTS);
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "PNG, JPEG, and WebP images",
            &["png", "jpg", "jpeg", "webp"],
        )
        .blocking_pick_files()
        .unwrap_or_default();
    if selected.len() > limit {
        return Err(format!("Select at most {limit} more images."));
    }
    let paths = selected
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| "A selected image path is not available on this platform.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    read_image_sources(&paths, limit)
}

fn read_text_sources(paths: &[PathBuf], limit: usize) -> Result<Vec<AgentSourceInput>, String> {
    let paths = paths
        .iter()
        .map(|path| {
            let title = path
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .ok_or_else(|| "A selected source has no usable filename.".to_string())?;
            Ok(SourcePath {
                path: path.clone(),
                title: title.to_string(),
                discovery: SourceDiscovery::File,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    read_sources(&paths, limit)
}

fn read_image_sources(paths: &[PathBuf], limit: usize) -> Result<Vec<AgentSourceInput>, String> {
    if paths.len() > limit || paths.len() > MAX_SOURCE_ATTACHMENTS {
        return Err(format!("Select at most {limit} more images."));
    }
    let mut total_bytes = 0_u64;
    paths
        .iter()
        .map(|path| {
            let title = path
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .ok_or_else(|| "A selected image has no usable filename.".to_string())?;
            if title.chars().count() > MAX_SOURCE_TITLE_CHARS || title.chars().any(char::is_control)
            {
                return Err(
                    "A selected image filename is too long or contains controls.".to_string(),
                );
            }
            let metadata = path
                .metadata()
                .map_err(|error| format!("Could not inspect {title}: {error}"))?;
            if !metadata.is_file() {
                return Err(format!("{title} is not a file."));
            }
            if metadata.len() > MAX_IMAGE_SOURCE_BYTES {
                return Err(format!("{title} exceeds the 8 MiB image limit."));
            }
            total_bytes = total_bytes.saturating_add(metadata.len());
            if total_bytes > MAX_IMAGE_TOTAL_BYTES {
                return Err("Selected images exceed the 16 MiB combined limit.".to_string());
            }
            let mut bytes = Vec::with_capacity(metadata.len() as usize);
            File::open(path)
                .and_then(|file| {
                    file.take(MAX_IMAGE_SOURCE_BYTES + 1)
                        .read_to_end(&mut bytes)
                })
                .map_err(|error| format!("Could not read {title}: {error}"))?;
            if bytes.len() as u64 > MAX_IMAGE_SOURCE_BYTES {
                return Err(format!("{title} exceeds the 8 MiB image limit."));
            }
            let media_type = image_media_type(path, &bytes)?;
            let source_digest = format!("{:x}", sha2::Sha256::digest(&bytes));
            Ok(AgentSourceInput {
                title: title.to_string(),
                content: String::new(),
                origin: Some(title.to_string()),
                media_type: Some(media_type.to_string()),
                source_digest: Some(source_digest.clone()),
                warning: None,
                image_data: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
                adapter_receipt: Some(agent_source_adapter::binary_receipt(
                    "image",
                    SourceDiscovery::Image,
                    title,
                    media_type,
                    &source_digest,
                    &source_digest,
                    Vec::new(),
                )),
            })
        })
        .collect()
}

fn read_folder_sources(root: &Path, limit: usize) -> Result<Vec<AgentSourceInput>, String> {
    let metadata = fs::symlink_metadata(root)
        .map_err(|error| format!("Could not inspect the selected source folder: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("The selected source folder cannot be a symbolic link.".to_string());
    }
    if !metadata.is_dir() {
        return Err("The selected source folder is not a directory.".to_string());
    }
    let ignore = okf_core::ignore::IgnoreMatcher::load(root);

    let mut inspected_entries = 0_usize;
    let mut directories = vec![(root.to_path_buf(), 0_usize)];
    let mut paths = Vec::new();
    while let Some((directory, depth)) = directories.pop() {
        let entries = fs::read_dir(&directory)
            .map_err(|error| format!("Could not read the selected source folder: {error}"))?;
        for entry in entries {
            let entry = entry
                .map_err(|error| format!("Could not read the selected source folder: {error}"))?;
            inspected_entries += 1;
            if inspected_entries > MAX_FOLDER_ENTRIES {
                return Err(format!(
                    "The selected folder exceeds the {MAX_FOLDER_ENTRIES} entry traversal limit."
                ));
            }
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Could not inspect a source folder entry: {error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if depth >= MAX_FOLDER_DEPTH {
                    return Err(format!(
                        "The selected folder exceeds the {MAX_FOLDER_DEPTH} level traversal limit."
                    ));
                }
                directories.push((path, depth + 1));
                continue;
            }
            if !file_type.is_file() || supported_media_type(&path).is_none() {
                continue;
            }
            if ignore.is_ignored(&path, false) {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "A source folder entry escaped the selected folder.".to_string())?;
            let title = relative_path_label(relative)?;
            paths.push(SourcePath {
                path,
                title,
                discovery: SourceDiscovery::Folder,
            });
        }
    }
    paths.sort_by(|left, right| left.title.cmp(&right.title));
    if paths.is_empty() {
        return Err(
            "The selected folder contains no supported PDF, text, Markdown, HTML, CSV, JSON, or OpenAPI YAML files."
                .to_string(),
        );
    }
    if paths.len() > limit {
        return Err(format!(
            "The selected folder contains {} supported files. The source tray has room for {limit}.",
            paths.len()
        ));
    }
    read_sources(&paths, limit)
}

fn read_sources(paths: &[SourcePath], limit: usize) -> Result<Vec<AgentSourceInput>, String> {
    if limit == 0 {
        return Err("Select at most 0 more source files.".to_string());
    }
    if paths.len() > limit || paths.len() > MAX_SOURCE_ATTACHMENTS {
        return Err(format!("Select at most {limit} more source files."));
    }
    let mut total_file_bytes = 0_u64;
    let mut total_content_chars = 0_usize;
    let mut sources = Vec::with_capacity(paths.len());
    for source_path in paths {
        let path = &source_path.path;
        let media_type = media_type_for_path(path)?;
        let title = &source_path.title;
        if title.chars().count() > MAX_SOURCE_TITLE_CHARS || title.chars().any(char::is_control) {
            return Err("A selected source filename is too long or contains controls.".to_string());
        }
        let metadata = path
            .metadata()
            .map_err(|error| format!("Could not inspect {title}: {error}"))?;
        if !metadata.is_file() {
            return Err(format!("{title} is not a file."));
        }
        let file_limit = if media_type == "application/pdf" {
            crate::agent_pdf::MAX_PDF_BYTES
        } else {
            MAX_SOURCE_FILE_BYTES
        };
        if metadata.len() > file_limit {
            return Err(if media_type == "application/pdf" {
                format!("{title} exceeds the 16 MiB PDF limit.")
            } else {
                format!("{title} exceeds the 256 KiB source limit.")
            });
        }
        total_file_bytes = total_file_bytes.saturating_add(metadata.len());
        if total_file_bytes > MAX_SELECTED_FILE_BYTES {
            return Err("Selected source files exceed the 32 MiB combined limit.".to_string());
        }

        let source =
            if media_type == "application/pdf" {
                let extraction = crate::agent_pdf::extract_in_helper(path)?;
                let evidence_digest =
                    format!("{:x}", sha2::Sha256::digest(extraction.content.as_bytes()));
                let mut diagnostics = extraction
                    .warning
                    .as_deref()
                    .map(|warning| {
                        vec![agent_source_adapter::warning(
                            "pdf-partial-extraction",
                            warning,
                        )]
                    })
                    .unwrap_or_default();
                diagnostics.extend(extraction.structure.promoted().map(|entry| {
                    agent_source_adapter::warning(&entry.code, entry.message.clone())
                }));
                AgentSourceInput {
                    title: title.clone(),
                    content: extraction.content,
                    origin: Some(title.clone()),
                    media_type: Some(media_type.to_string()),
                    source_digest: Some(extraction.source_digest.clone()),
                    warning: extraction.warning,
                    image_data: None,
                    adapter_receipt: Some(agent_source_adapter::binary_receipt(
                        "pdf",
                        source_path.discovery,
                        title,
                        media_type,
                        &extraction.source_digest,
                        &evidence_digest,
                        diagnostics,
                    )),
                }
            } else {
                let mut bytes = Vec::with_capacity(metadata.len() as usize);
                File::open(path)
                    .and_then(|file| file.take(file_limit + 1).read_to_end(&mut bytes))
                    .map_err(|error| format!("Could not read {title}: {error}"))?;
                if bytes.len() as u64 > file_limit {
                    return Err(format!("{title} exceeds the 256 KiB source limit."));
                }
                source_from_bytes(
                    title.clone(),
                    title.clone(),
                    media_type,
                    bytes,
                    source_path.discovery,
                )?
            };
        if source.content.trim().is_empty() {
            return Err(format!("{title} is empty."));
        }
        total_content_chars = total_content_chars.saturating_add(source.content.chars().count());
        if total_content_chars > MAX_SOURCE_TOTAL_CHARS {
            return Err(
                "Extracted source text exceeds the 524,288 character combined limit.".to_string(),
            );
        }
        sources.push(source);
    }
    Ok(sources)
}

pub(crate) fn source_from_bytes(
    title: String,
    origin: String,
    media_type: &str,
    bytes: Vec<u8>,
    discovery: SourceDiscovery,
) -> Result<AgentSourceInput, String> {
    let adapted = agent_source_adapter::adapt_text(
        &title,
        &origin,
        media_type,
        &bytes,
        discovery,
        MAX_SOURCE_CONTENT_CHARS,
    )?;
    let content = adapted.content;
    if content.trim().is_empty() {
        return Err(format!("{title} is empty."));
    }
    if content.chars().count() > MAX_SOURCE_CONTENT_CHARS {
        return Err(format!(
            "{title} exceeds the {MAX_SOURCE_CONTENT_CHARS} character source limit."
        ));
    }
    Ok(AgentSourceInput {
        title,
        content,
        origin: Some(origin),
        media_type: Some(media_type.to_string()),
        source_digest: Some(adapted.source_digest),
        warning: None,
        image_data: None,
        adapter_receipt: Some(adapted.receipt),
    })
}

fn image_media_type(path: &Path, bytes: &[u8]) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    let media_type = match extension.as_deref() {
        Some("png") if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
        Some("jpg" | "jpeg") if bytes.starts_with(&[0xff, 0xd8, 0xff]) => "image/jpeg",
        Some("webp") if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            "image/webp"
        }
        _ => return Err("Images must be valid PNG, JPEG, or WebP files.".to_string()),
    };
    Ok(media_type)
}

fn relative_path_label(path: &Path) -> Result<String, String> {
    let parts = path
        .components()
        .map(|component| match component {
            std::path::Component::Normal(value) => value
                .to_str()
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| "A source folder entry has no usable UTF-8 name.".to_string()),
            _ => Err("A source folder entry has an invalid relative path.".to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if parts.is_empty() {
        return Err("A source folder entry has no usable relative path.".to_string());
    }
    Ok(parts.join("/"))
}

fn media_type_for_path(path: &Path) -> Result<&'static str, String> {
    supported_media_type(path).ok_or_else(|| {
        "Sources must be PDF, text, Markdown, HTML, CSV, JSON, or OpenAPI YAML files.".to_string()
    })
}

fn supported_media_type(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("txt") => Some("text/plain"),
        Some("md" | "markdown") => Some("text/markdown"),
        Some("html" | "htm") => Some("text/html"),
        Some("csv") => Some("text/csv"),
        Some("json") => Some("application/json"),
        Some("yaml" | "yml") => Some("application/yaml"),
        Some("pdf") => Some("application/pdf"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("okf-agent-sources-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp directory");
        path
    }

    #[test]
    fn reads_supported_text_without_disclosing_its_path() {
        let root = temp_dir();
        let path = root.join("Research.md");
        fs::write(&path, "# Notes\n\nVerified.").expect("write source");

        let sources = read_text_sources(&[path], 1).expect("read source");

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "Research.md");
        assert_eq!(sources[0].origin.as_deref(), Some("Research.md"));
        assert_eq!(sources[0].media_type.as_deref(), Some("text/markdown"));
        assert_eq!(sources[0].content, "# Notes\n\nVerified.");
        let receipt = sources[0]
            .adapter_receipt
            .as_ref()
            .expect("adapter receipt");
        assert_eq!(receipt.adapter_id, "markdown");
        assert_eq!(receipt.discovery, SourceDiscovery::File);
        assert_eq!(receipt.trust, "untrusted");
        let serialized = serde_json::to_string(&sources).expect("serialize sources");
        assert!(!serialized.contains(root.to_string_lossy().as_ref()));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn labels_structured_text_with_its_media_type() {
        let root = temp_dir();
        let cases = [
            ("page.html", "<h1>Report</h1>", "text/html"),
            ("rows.csv", "name,value\nalpha,1", "text/csv"),
            ("record.json", r#"{"name":"alpha"}"#, "application/json"),
        ];
        for (name, content, expected_media_type) in cases {
            let path = root.join(name);
            fs::write(&path, content).expect("write structured source");
            let sources = read_text_sources(&[path], 1).expect("read structured source");
            assert_eq!(sources[0].media_type.as_deref(), Some(expected_media_type));
            if name == "rows.csv" {
                assert!(sources[0].content.contains("## Rows 1-1"));
                assert!(sources[0].content.contains("| 1 | alpha | 1 |"));
                assert_eq!(sources[0].source_digest.as_deref().map(str::len), Some(64));
            } else if name == "record.json" {
                assert!(sources[0].content.contains("## Nodes 1-2"));
                assert!(sources[0]
                    .content
                    .contains("| 2 | /name | string | \"alpha\" |"));
                assert_eq!(sources[0].source_digest.as_deref().map(str::len), Some(64));
            }
        }
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn reads_bounded_images_with_provenance_without_disclosing_paths() {
        let root = temp_dir();
        let path = root.join("diagram.png");
        let bytes = b"\x89PNG\r\n\x1a\nimage bytes";
        fs::write(&path, bytes).expect("write image");

        let sources = read_image_sources(&[path], 1).expect("read image");

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "diagram.png");
        assert_eq!(sources[0].origin.as_deref(), Some("diagram.png"));
        assert_eq!(sources[0].media_type.as_deref(), Some("image/png"));
        assert_eq!(
            sources[0]
                .adapter_receipt
                .as_ref()
                .map(|receipt| receipt.adapter_id.as_str()),
            Some("image")
        );
        assert!(sources[0].content.is_empty());
        assert_eq!(
            sources[0].image_data.as_deref(),
            Some(
                base64::engine::general_purpose::STANDARD
                    .encode(bytes)
                    .as_str()
            )
        );
        assert_eq!(sources[0].source_digest.as_deref().map(str::len), Some(64));
        let serialized = serde_json::to_string(&sources).expect("serialize images");
        assert!(!serialized.contains(root.to_string_lossy().as_ref()));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn rejects_mislabeled_and_oversized_images() {
        let root = temp_dir();
        let mislabeled = root.join("diagram.png");
        fs::write(&mislabeled, b"not a png").expect("write mislabeled image");
        assert!(read_image_sources(&[mislabeled], 1)
            .expect_err("reject mislabeled image")
            .contains("valid PNG"));

        let oversized = root.join("large.jpg");
        fs::write(&oversized, vec![0_u8; MAX_IMAGE_SOURCE_BYTES as usize + 1])
            .expect("write oversized image");
        assert!(read_image_sources(&[oversized], 1)
            .expect_err("reject oversized image")
            .contains("8 MiB"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn rejects_unsupported_binary_and_oversized_sources() {
        let root = temp_dir();
        let unsupported = root.join("notes.xml");
        fs::write(&unsupported, "<notes />").expect("write unsupported source");
        assert!(read_text_sources(&[unsupported], 1)
            .expect_err("reject unsupported extension")
            .contains("text"));

        let binary = root.join("binary.txt");
        fs::write(&binary, [0xff, 0xfe]).expect("write binary source");
        assert!(read_text_sources(&[binary], 1)
            .expect_err("reject binary source")
            .contains("UTF-8"));

        let oversized = root.join("large.md");
        fs::write(&oversized, vec![b'a'; MAX_SOURCE_FILE_BYTES as usize + 1])
            .expect("write oversized source");
        assert!(read_text_sources(&[oversized], 1)
            .expect_err("reject oversized source")
            .contains("256 KiB"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn enforces_the_requested_selection_limit() {
        let root = temp_dir();
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        fs::write(&first, "first").expect("write first source");
        fs::write(&second, "second").expect("write second source");

        assert!(read_text_sources(&[first, second], 1)
            .expect_err("reject excess selection")
            .contains("at most 1"));
        assert!(read_text_sources(&[], 0)
            .expect_err("reject a full tray")
            .contains("at most 0"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn rejects_a_selection_above_the_combined_byte_limit() {
        let root = temp_dir();
        let paths = ["first.txt", "second.md", "third.markdown"].map(|name| root.join(name));
        for path in &paths {
            fs::write(path, vec![b'a'; 180 * 1024]).expect("write source");
        }

        assert!(read_text_sources(&paths, 3)
            .expect_err("reject combined source size")
            .contains("524,288 character"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn reads_folder_sources_in_relative_path_order_and_ignores_unsupported_files() {
        let root = temp_dir();
        fs::create_dir_all(root.join("reports")).expect("create nested folder");
        fs::write(root.join("z-last.txt"), "last").expect("write root source");
        fs::write(root.join("reports").join("a-first.md"), "first").expect("write nested source");
        fs::write(root.join("reports").join("ignored.xml"), "<ignored />")
            .expect("write unsupported file");
        fs::write(root.join("reports").join("private.md"), "private")
            .expect("write ignored source");
        fs::write(root.join(".okfignore"), "reports/private.md\n")
            .expect("write source ignore rules");

        let sources = read_folder_sources(&root, 2).expect("read source folder");

        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].title, "reports/a-first.md");
        assert_eq!(sources[0].origin.as_deref(), Some("reports/a-first.md"));
        assert_eq!(
            sources[0]
                .adapter_receipt
                .as_ref()
                .map(|receipt| receipt.discovery),
            Some(SourceDiscovery::Folder)
        );
        assert_eq!(sources[1].title, "z-last.txt");
        let serialized = serde_json::to_string(&sources).expect("serialize sources");
        assert!(!serialized.contains(root.to_string_lossy().as_ref()));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn rejects_folder_sources_that_cannot_fit_in_the_tray() {
        let root = temp_dir();
        fs::write(root.join("first.txt"), "first").expect("write first source");
        fs::write(root.join("second.txt"), "second").expect("write second source");

        let error = read_folder_sources(&root, 1).expect_err("reject excess folder sources");

        assert!(error.contains("2 supported files"));
        assert!(error.contains("room for 1"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn rejects_a_folder_beyond_the_traversal_depth_limit() {
        let root = temp_dir();
        let mut directory = root.clone();
        for depth in 0..=MAX_FOLDER_DEPTH {
            directory = directory.join(format!("level-{depth}"));
            fs::create_dir(&directory).expect("create nested directory");
        }

        let error = read_folder_sources(&root, 1).expect_err("reject deep source folder");

        assert!(error.contains("8 level traversal limit"));
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_folder_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_dir();
        let outside = temp_dir();
        fs::write(root.join("inside.txt"), "inside").expect("write inside source");
        fs::write(outside.join("outside.txt"), "outside").expect("write outside source");
        symlink(&outside, root.join("linked-folder")).expect("link outside folder");

        let sources = read_folder_sources(&root, 2).expect("read source folder");

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "inside.txt");
        fs::remove_dir_all(root).expect("remove source folder");
        fs::remove_dir_all(outside).expect("remove outside folder");
    }
}
