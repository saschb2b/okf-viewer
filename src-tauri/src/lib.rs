//! Tauri layer: thin command/event wrappers over `okf-core`. The frontend never
//! touches the filesystem; it calls these commands and listens for events.

// The agent backend is grouped into domain folders under `src/agent/`. The
// module names keep their `agent_` prefix (avoiding collisions with std and
// crate modules like `process`, `url`, `csv`, and `json`); `#[path]` maps each
// to its file. See docs/architecture/agent-system.md for the domains.
//
// host — the running ACP and MCP process host.
#[path = "agent/host/agent_artifact.rs"]
mod agent_artifact;
#[path = "agent/host/agent_critic.rs"]
mod agent_critic;
#[path = "agent/host/agent_events.rs"]
mod agent_events;
// orchestration — delegated runs over deterministic slices.
#[path = "agent/orchestration/agent_assembly.rs"]
mod agent_assembly;
#[path = "agent/orchestration/agent_budget.rs"]
mod agent_budget;
#[path = "agent/host/agent_mcp.rs"]
mod agent_mcp;
#[path = "agent/host/agent_mcp_grant.rs"]
mod agent_mcp_grant;
#[path = "agent/host/agent_process.rs"]
mod agent_process;
#[path = "agent/host/agent_protocol.rs"]
mod agent_protocol;
#[path = "agent/host/agent_receipt.rs"]
mod agent_receipt;
#[path = "agent/orchestration/agent_run.rs"]
mod agent_run;
#[path = "agent/host/agent_sandbox.rs"]
mod agent_sandbox;
#[path = "agent/host/agent_transcript.rs"]
mod agent_transcript;
#[cfg(target_os = "windows")]
#[path = "agent/host/agent_windows_sandbox.rs"]
mod agent_windows_sandbox;
// registry — agent discovery, installation, and the managed runtime.
#[path = "agent/registry/agent_catalog.rs"]
mod agent_catalog;
#[path = "agent/registry/agent_custom.rs"]
mod agent_custom;
#[path = "agent/registry/agent_install.rs"]
mod agent_install;
#[path = "agent/registry/agent_runtime.rs"]
mod agent_runtime;
// provider — the native Studio Agent and its tools.
#[path = "agent/provider/agent_capabilities.rs"]
mod agent_capabilities;
#[path = "agent/provider/agent_credentials.rs"]
mod agent_credentials;
#[path = "agent/provider/agent_local.rs"]
mod agent_local;
#[path = "agent/provider/agent_native_sources.rs"]
mod agent_native_sources;
#[path = "agent/provider/agent_native_stage.rs"]
mod agent_native_stage;
#[path = "agent/provider/agent_routines.rs"]
mod agent_routines;
#[path = "agent/provider/agent_studio.rs"]
mod agent_studio;
// sources — attached-source intake and extraction.
#[path = "agent/sources/agent_csv.rs"]
mod agent_csv;
#[path = "agent/sources/agent_intake_plan.rs"]
mod agent_intake_plan;
#[path = "agent/sources/agent_json.rs"]
mod agent_json;
#[path = "agent/sources/agent_pdf.rs"]
mod agent_pdf;
#[path = "agent/sources/agent_pdf_structure.rs"]
mod agent_pdf_structure;
#[path = "agent/sources/agent_source_adapter.rs"]
mod agent_source_adapter;
#[path = "agent/sources/agent_sources.rs"]
mod agent_sources;
#[path = "agent/sources/agent_url.rs"]
mod agent_url;
// stage — the reviewed-write engine shared by the host and native provider.
#[path = "agent/agent_stage.rs"]
mod agent_stage;
mod bundle_create;
mod bundle_grant;
mod bundle_interop;
mod bundle_library;
mod bundle_projection;
mod compatibility_stage;
mod external_entry;
#[path = "git/repository.rs"]
mod git_repository;
#[path = "git/watch.rs"]
mod git_watch;
mod remote;
mod retrieval;
mod watch;

use okf_core::{Bundle, BundleRoot};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use watch::WatchState;

fn authorized_git_scope(
    grants: &bundle_grant::BundleGrantState,
    bundle_root: &str,
) -> Result<git_repository::RepositoryScope, String> {
    let (bundle, folders) = grants.authorize_bundle_with_folders(Path::new(bundle_root))?;
    git_repository::discover(&bundle, &folders)?
        .ok_or_else(|| "The active bundle is not inside a Git repository.".to_string())
}

#[tauri::command]
async fn git_repository_snapshot(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let (bundle, folders) = grants.authorize_bundle_with_folders(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || git_repository::snapshot(&bundle, &folders))
        .await
        .map_err(|_| "The Git status task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_repository_history(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    skip: usize,
    limit: usize,
) -> Result<git_repository::GitHistoryPage, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || scope.history(skip, limit))
        .await
        .map_err(|_| "The Git history task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_repository_diff(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    path: Option<String>,
    staged: bool,
    commit: Option<String>,
) -> Result<git_repository::GitDiff, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.diff(path.as_deref(), staged, commit.as_deref())
    })
    .await
    .map_err(|_| "The Git diff task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_stage_paths(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    paths: Vec<String>,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.stage(&paths)?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git stage task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_unstage_paths(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    paths: Vec<String>,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.unstage(&paths)?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git unstage task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_stage_all(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.stage_all()?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git stage task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_unstage_all(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.unstage_all()?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git unstage task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_commit(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    message: String,
    include_tracked: bool,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.commit(&message, include_tracked)?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git commit task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_undo_commit(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    expected_head: String,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.undo_commit(&expected_head)?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git recovery task stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn git_remote_operation(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    operation: git_repository::GitRemoteOperation,
) -> Result<git_repository::GitRepositorySnapshot, String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        scope.remote(operation)?;
        scope.snapshot()
    })
    .await
    .map_err(|_| "The Git remote task stopped unexpectedly.".to_string())?
}

#[tauri::command]
fn git_start_watch(
    app: AppHandle,
    watch: State<'_, git_watch::GitWatchState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<(), String> {
    let scope = authorized_git_scope(&grants, &bundle_root)?;
    let (repository_root, metadata_roots) = scope.watch_roots();
    git_watch::start(
        app,
        watch.inner(),
        bundle_root,
        repository_root,
        metadata_roots,
    )
}

#[tauri::command]
fn git_stop_watch(watch: State<'_, git_watch::GitWatchState>) {
    git_watch::stop(watch.inner());
}

#[tauri::command]
fn okf_capability_catalog() -> agent_capabilities::CapabilityCatalogInfo {
    agent_capabilities::catalog_info()
}

#[tauri::command]
async fn okf_projection_plan(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    input: okf_core::projection::ProjectionInput,
) -> Result<okf_core::projection::ProjectionPlan, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        okf_core::projection::plan(&root, &bundle, &input)
    })
    .await
    .map_err(|_| "The recipient projection plan stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn okf_interop_report(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<okf_core::interop::InteropReport, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        Ok(okf_core::interop::analyze(&root, &bundle))
    })
    .await
    .map_err(|_| "The interoperability analysis stopped unexpectedly.".to_string())?
}

#[tauri::command]
async fn export_semantic_web(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<Option<String>, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    bundle_interop::export_semantic_web(&app, root).await
}

#[tauri::command]
async fn import_semantic_web(
    app: AppHandle,
) -> Result<Option<okf_core::interop::SemanticImportPreview>, String> {
    bundle_interop::import_semantic_web(&app).await
}

#[tauri::command]
async fn export_okf_sidecar(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    concept_id: String,
    path: String,
) -> Result<Option<String>, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    bundle_interop::export_sidecar(&app, root, concept_id, path).await
}

#[tauri::command]
async fn export_okf_projection(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    input: bundle_projection::ProjectionExportInput,
) -> Result<Option<bundle_projection::ProjectionExportResult>, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Choose where to create the recipient projection")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let parent = selected.into_path().map_err(|_| {
        "The selected projection destination is not available on this platform.".to_string()
    })?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        bundle_projection::export(&root, &parent, &input)
    })
    .await
    .map_err(|_| "The recipient projection export stopped unexpectedly.".to_string())??;
    if matches!(
        result.status,
        bundle_projection::ProjectionExportStatus::Exported
    ) {
        grants.grant(
            Path::new(&result.destination),
            bundle_grant::BundleGrantKind::LocalFolder,
        )?;
    }
    Ok(Some(result))
}

#[tauri::command]
fn set_okf_capability_pack_active(
    app: AppHandle,
    active: bool,
) -> Result<agent_capabilities::CapabilityCatalogInfo, String> {
    let catalog = agent_capabilities::set_pack_active(&app, active)?;
    app.emit("okf-capability-pack-changed", &catalog)
        .map_err(|_| "Studio could not publish the capability pack change.".to_string())?;
    Ok(catalog)
}

#[tauri::command]
fn okf_routine_workspace(
    grants: State<'_, bundle_grant::BundleGrantState>,
    routines: State<'_, agent_routines::RoutineState>,
    bundle_root: String,
) -> Result<agent_routines::RoutineWorkspace, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    Ok(routines.workspace(&root.to_string_lossy()))
}

#[tauri::command]
fn save_okf_routine(
    grants: State<'_, bundle_grant::BundleGrantState>,
    routines: State<'_, agent_routines::RoutineState>,
    input: agent_routines::SaveRoutineInput,
) -> Result<agent_routines::RoutineDefinition, String> {
    routines.save(&grants, input)
}

#[tauri::command]
fn remove_okf_routine(
    routines: State<'_, agent_routines::RoutineState>,
    routine_id: String,
) -> Result<bool, String> {
    routines.remove(&routine_id)
}

#[tauri::command]
fn run_okf_routine(
    grants: State<'_, bundle_grant::BundleGrantState>,
    routines: State<'_, agent_routines::RoutineState>,
    routine_id: String,
) -> Result<agent_routines::RoutineRun, String> {
    routines.run(&grants, &routine_id, None)
}

#[tauri::command]
fn run_due_okf_routines(
    grants: State<'_, bundle_grant::BundleGrantState>,
    routines: State<'_, agent_routines::RoutineState>,
) -> Result<Vec<agent_routines::RoutineRun>, String> {
    routines.run_due(&grants, agent_routines::current_time_ms())
}

pub fn run_agent_mcp_grant(grant_file: std::path::PathBuf, token: String) -> Result<(), String> {
    let bundle_root = agent_mcp_grant::consume(&grant_file, &token)?;
    agent_mcp::run(bundle_root)
}

#[tauri::command]
fn create_okf_mcp_grant(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<agent_mcp_grant::McpLaunchGrant, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    agent_mcp_grant::create(&root)
}

#[tauri::command]
fn pending_external_entries(
    state: State<'_, external_entry::ExternalEntryState>,
) -> Result<Vec<external_entry::ExternalEntryPreview>, String> {
    external_entry::pending(&state)
}

#[tauri::command]
async fn accept_external_entry(
    app: AppHandle,
    state: State<'_, external_entry::ExternalEntryState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    request_id: String,
) -> Result<Option<external_entry::ExternalEntryPreview>, String> {
    external_entry::accept(app, &state, &grants, &request_id).await
}

#[tauri::command]
fn dismiss_external_entry(
    state: State<'_, external_entry::ExternalEntryState>,
    request_id: String,
) -> Result<bool, String> {
    external_entry::dismiss(&state, &request_id)
}

pub fn run_pdf_extractor() -> Result<(), String> {
    agent_pdf::run_helper()
}

#[cfg(target_os = "windows")]
pub fn run_windows_agent_sandbox(
    executable: std::path::PathBuf,
    arguments: Vec<String>,
) -> Result<u32, String> {
    agent_windows_sandbox::run(&executable, &arguments)
}

#[tauri::command]
async fn pick_bundle_folder(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
) -> Result<Option<String>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Open a folder of OKF bundles")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = selected
        .into_path()
        .map_err(|_| "The selected bundle folder is not available on this platform.".to_string())?;
    grants
        .grant(&folder, bundle_grant::BundleGrantKind::LocalFolder)
        .map(Some)
}

#[tauri::command]
async fn pick_git_repository_folder(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<Option<String>, String> {
    let bundle = grants.authorize_bundle(Path::new(&bundle_root))?;
    let repository_root =
        tauri::async_runtime::spawn_blocking(move || git_repository::enclosing_root(&bundle))
            .await
            .map_err(|_| "Git repository discovery stopped unexpectedly.".to_string())??
            .ok_or_else(|| "The active bundle is not inside a Git repository.".to_string())?;

    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Allow Git for this repository")
        .set_directory(&repository_root)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "The selected repository folder is not available.".to_string())?;
    let selected = dunce::canonicalize(selected)
        .map_err(|_| "The selected repository folder is no longer available.".to_string())?;
    if selected != repository_root {
        return Err("Choose the enclosing Git repository folder shown by Studio.".to_string());
    }
    grants
        .grant(&repository_root, bundle_grant::BundleGrantKind::LocalFolder)
        .map(Some)
}

/// Static, agent-free bundle creation: the user picks a parent folder in the
/// OS dialog, the generator writes a small conformant bundle there (see
/// bundle_create.rs), and the result is granted like any picked folder so the
/// frontend can open it. Returns None when the picker is cancelled.
#[tauri::command]
async fn create_bundle(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    input: bundle_create::CreateBundleInput,
) -> Result<Option<String>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Choose where to create the new bundle")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let parent = selected.into_path().map_err(|_| {
        "The selected destination folder is not available on this platform.".to_string()
    })?;
    let created = bundle_create::create_bundle(&parent, &input)?;
    grants
        .grant(&created, bundle_grant::BundleGrantKind::LocalFolder)
        .map(Some)
}

#[tauri::command]
fn revoke_bundle_grant(
    grants: State<'_, bundle_grant::BundleGrantState>,
    folder: String,
) -> Result<bool, String> {
    grants.revoke(&folder)
}

#[tauri::command]
fn scan_bundles(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    folder: String,
    max_depth: usize,
) -> Result<Vec<BundleRoot>, String> {
    let folder = grants.authorize_folder(Path::new(&folder))?;
    let kind = grants
        .grant_kind(&folder)
        .ok_or_else(|| "The bundle folder grant is no longer available.".to_string())?;
    let roots = okf_core::scan_bundles_with_depth(&folder, max_depth);
    grants.register_bundle_roots(
        &folder,
        roots.iter().map(|root| Path::new(&root.root).to_path_buf()),
    )?;
    library.register_detected(&folder, kind, &roots)?;
    Ok(roots)
}

#[tauri::command]
fn read_bundle(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    root: String,
) -> Result<Bundle, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    let bundle = okf_core::read_bundle(&root);
    library.update_snapshot(&root, &bundle)?;
    Ok(bundle)
}

#[tauri::command]
fn okf_ignore_report(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<okf_core::ignore::IgnoreReport, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    Ok(okf_core::ignore::analyze(&root))
}

#[tauri::command]
async fn okf_compatibility_report(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<okf_core::compatibility::CompatibilityReport, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || {
        okf_core::compatibility::analyze(&okf_core::read_bundle(&root))
    })
    .await
    .map_err(|_| "Studio could not build the compatibility report.".to_string())
}

#[tauri::command]
async fn okf_profile_report(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
) -> Result<okf_core::profile::ProfileReport, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        okf_core::profile::analyze(&root, &bundle)
    })
    .await
    .map_err(|_| "Studio could not resolve the bundle's advisory profiles.".to_string())
}

#[tauri::command]
async fn stage_compatibility_normalization(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    file: String,
    rule_id: String,
    authored: String,
) -> Result<compatibility_stage::CompatibilityReview, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        stages.stage_normalization(&root, &file, &rule_id, &authored)
    })
    .await
    .map_err(|_| "Studio could not stage the compatibility normalization.".to_string())?
}

#[tauri::command]
async fn select_compatibility_hunk(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    path: String,
    revision: String,
    hunk_index: usize,
    selected: bool,
) -> Result<agent_stage::AgentStagedFileDiff, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        stages.select_hunk(&root, &path, &revision, hunk_index, selected)
    })
    .await
    .map_err(|_| "Studio could not update the compatibility review.".to_string())?
}

#[tauri::command]
async fn validate_compatibility_normalization(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentStagedValidationInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.validate(&root))
        .await
        .map_err(|_| "Studio could not validate the compatibility normalization.".to_string())?
}

#[tauri::command]
async fn apply_compatibility_normalization(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    revision: String,
) -> Result<agent_stage::AgentStagedApplyInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.apply(&root, &revision))
        .await
        .map_err(|_| "Studio could not apply the compatibility normalization.".to_string())?
}

#[tauri::command]
async fn discard_compatibility_normalization(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.discard(&root))
        .await
        .map_err(|_| "Studio could not discard the compatibility normalization.".to_string())?
}

#[tauri::command]
async fn restore_compatibility_normalization(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentCheckpointRestoreInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.restore(&root))
        .await
        .map_err(|_| "Studio could not restore the compatibility normalization.".to_string())?
}

#[tauri::command]
async fn stage_concept_move(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    source_id: String,
    destination_path: String,
) -> Result<compatibility_stage::ConceptMoveReview, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        stages.stage_concept_move(&root, &source_id, &destination_path)
    })
    .await
    .map_err(|_| "Studio could not stage the concept move.".to_string())?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConceptRetirementRequest {
    source_id: String,
    action: String,
    replacement_id: Option<String>,
    reason: String,
    decision_date: String,
}

#[tauri::command]
async fn stage_concept_retirement(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    request: ConceptRetirementRequest,
) -> Result<compatibility_stage::ConceptRetirementReview, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        stages.stage_concept_retirement(
            &root,
            &request.source_id,
            &request.action,
            request.replacement_id.as_deref(),
            &request.reason,
            &request.decision_date,
        )
    })
    .await
    .map_err(|_| "Studio could not stage the retirement decision.".to_string())?
}

#[tauri::command]
async fn concept_move_diff(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    path: String,
) -> Result<agent_stage::AgentStagedFileDiff, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.diff(&root, &path))
        .await
        .map_err(|_| "Studio could not open the concept move diff.".to_string())?
}

#[tauri::command]
async fn select_concept_move_hunk(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    path: String,
    revision: String,
    hunk_index: usize,
    selected: bool,
) -> Result<agent_stage::AgentStagedFileDiff, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        stages.select_hunk(&root, &path, &revision, hunk_index, selected)
    })
    .await
    .map_err(|_| "Studio could not update the concept move review.".to_string())?
}

#[tauri::command]
async fn validate_concept_move(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentStagedValidationInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.validate_move(&root))
        .await
        .map_err(|_| "Studio could not validate the concept move.".to_string())?
}

#[tauri::command]
async fn apply_concept_move(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
    revision: String,
) -> Result<agent_stage::AgentStagedApplyInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.apply(&root, &revision))
        .await
        .map_err(|_| "Studio could not apply the concept move.".to_string())?
}

#[tauri::command]
async fn discard_concept_move(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.discard(&root))
        .await
        .map_err(|_| "Studio could not discard the concept move.".to_string())?
}

#[tauri::command]
async fn restore_concept_move(
    grants: State<'_, bundle_grant::BundleGrantState>,
    stages: State<'_, compatibility_stage::CompatibilityStageState>,
    bundle_root: String,
) -> Result<agent_stage::AgentCheckpointRestoreInfo, String> {
    let root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let stages = stages.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stages.restore(&root))
        .await
        .map_err(|_| "Studio could not restore the concept move.".to_string())?
}

#[tauri::command]
async fn retrieve_okf_context(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    request: okf_core::retrieval::RetrievalRequest,
) -> Result<okf_core::retrieval::RetrievalResult, String> {
    let authorized_root = grants.authorize_bundle(Path::new(&bundle_root))?;
    let request_for_task = request.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&authorized_root);
        let manifest = okf_core::retrieval::build_manifest(&bundle);
        let _cache_persisted = retrieval::persist_authorized_manifest(&app, &manifest).is_ok();
        Ok(okf_core::retrieval::retrieve_manifest(
            manifest,
            &request_for_task,
        ))
    })
    .await
    .map_err(|_| "Studio could not complete the retrieval task.".to_string())?
}

#[tauri::command]
fn diff_okf_retrieval_receipts(
    left: okf_core::retrieval::RetrievalReceipt,
    right: okf_core::retrieval::RetrievalReceipt,
) -> okf_core::retrieval::ReceiptDiff {
    retrieval::diff(&left, &right)
}

#[tauri::command]
fn bundle_library(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    active_root: Option<String>,
) -> Result<Vec<bundle_library::BundleLibraryEntry>, String> {
    let active_root = active_root
        .map(|root| grants.authorize_bundle(Path::new(&root)))
        .transpose()?;
    Ok(library.entries(&grants, active_root.as_deref()))
}

#[tauri::command]
fn preview_federated_bundles(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    bundle_ids: Vec<String>,
) -> Result<Vec<bundle_library::FederatedBundleStatus>, String> {
    library.preview(&grants, bundle_ids)
}

#[tauri::command]
fn federated_inventory(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    selections: Vec<bundle_library::FederatedBundleSelection>,
    prefix: Option<String>,
    concept_type: Option<String>,
    tag: Option<String>,
    limit: usize,
) -> Result<bundle_library::FederatedConceptPage, String> {
    library.inventory(&grants, selections, prefix, concept_type, tag, limit)
}

#[tauri::command]
fn federated_search(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    selections: Vec<bundle_library::FederatedBundleSelection>,
    query: String,
    limit: usize,
) -> Result<bundle_library::FederatedConceptPage, String> {
    library.search(&grants, selections, query, limit)
}

#[tauri::command]
fn federated_sources(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    selections: Vec<bundle_library::FederatedBundleSelection>,
    query: Option<String>,
    limit: usize,
) -> Result<bundle_library::FederatedSourcePage, String> {
    library.sources(&grants, selections, query, limit)
}

#[tauri::command]
fn federated_relationship_candidates(
    grants: State<'_, bundle_grant::BundleGrantState>,
    library: State<'_, bundle_library::BundleLibraryState>,
    selections: Vec<bundle_library::FederatedBundleSelection>,
    limit: usize,
) -> Result<bundle_library::FederatedRelationshipPage, String> {
    library.relationships(&grants, selections, limit)
}

/// Send one delegated run's prompt on an isolated session.
///
/// The session must carry no write grant, which Rust checks rather than trusts:
/// reading fans out, writing stays single-threaded, and a run is reading.
#[tauri::command]
async fn prompt_agent_run(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    text: String,
    concept_paths: Vec<String>,
) -> Result<agent_protocol::AgentTurnInfo, String> {
    agent_protocol::prompt_delegated_run(
        state.inner(),
        &connection_id,
        session_id,
        text,
        concept_paths,
    )
    .await
}

/// Fold each run's usage reports into a job spend, and say whether the budget
/// still allows work to continue.
///
/// `runs` is per-run so the two aggregations stay distinct: cost is spent per
/// session and adds across runs, while context is a window each session has to
/// itself, so the job carries the largest any one run reached. Summing context
/// would describe a context nobody ever used. One run is a single inner list.
///
/// Pure: it reads what providers reported and answers. The two answers that are
/// not the same are `within` and `unmeasured`. "We checked and it is fine" and
/// "we cannot check" mean different things to whoever is reading, and only one
/// of them should reassure anyone.
#[tauri::command]
fn evaluate_agent_budget(
    budget: agent_run::RunBudget,
    runs: Vec<Vec<agent_budget::UsageReport>>,
) -> agent_budget::BudgetEvaluation {
    let mut job = agent_budget::BudgetLedger::new();
    for reports in runs {
        let mut run = agent_budget::BudgetLedger::new();
        for report in reports {
            run.record(report);
        }
        job.absorb(&run);
    }
    agent_budget::BudgetEvaluation {
        spend: job.spend().clone(),
        state: job.state(&budget),
    }
}

/// Assemble what a fan-out returned into one reviewable result.
///
/// Reports rather than reconciles. A run computed against an older bundle, a
/// run that failed, a run that stopped at its ceiling, and a planned slice that
/// never reported are each named with the reason, and coverage is stated
/// against the plan rather than against whoever answered. A partial result that
/// says it is partial is useful; one that does not is worse than nothing.
#[tauri::command]
async fn assemble_agent_runs(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    outcomes: Vec<agent_assembly::RunOutcome>,
    planned_slice_keys: Vec<String>,
) -> Result<agent_assembly::Assembly, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        let fingerprint = okf_core::health::bundle_fingerprint(&bundle);
        agent_assembly::assemble(outcomes, &planned_slice_keys, &fingerprint)
    })
    .await
    .map_err(|_| "Studio could not assemble the delegated runs.".to_string())
}

/// Resolve one delegated run, or say why it will not start.
///
/// Every check happens here, before a model is contacted: a stale slice, an
/// empty one, an unmeasurable budget, a capability that writes, a capability
/// that does not produce the requested artifact, and a run trying to start
/// another run. All of them are cheap now and expensive afterwards. A run that
/// turns out to be unbudgeted once it has spent money cannot be refused any
/// more.
///
/// Resolution starts nothing. It answers whether a run is allowed to exist.
#[tauri::command]
async fn resolve_agent_run(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    request: agent_run::RunRequest,
    run_id: String,
) -> Result<Result<agent_run::PreparedRun, agent_run::RunRefusal>, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        let fingerprint = okf_core::health::bundle_fingerprint(&bundle);
        agent_run::resolve_run(
            &request,
            &agent_capabilities::catalog().capabilities,
            &fingerprint,
            &run_id,
        )
        .map(|run| agent_run::PreparedRun {
            prompt: agent_run::run_prompt(&run),
            run,
        })
    })
    .await
    .map_err(|_| "Studio could not resolve the delegated run.".to_string())
}

/// Plan how a bundle-sized job divides into bounded runs.
///
/// Read-only and side-effect free: it computes a plan and returns it. Nothing
/// starts here, because a preview the user has not seen is not a preview. The
/// plan carries the fingerprint it was computed against, so a bundle that
/// changes before the job starts makes it stale by the rule artifacts already
/// use rather than by a new one.
#[tauri::command]
async fn plan_agent_slices(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    request: okf_core::slice::SliceRequest,
) -> Result<okf_core::slice::SlicePlan, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        okf_core::slice::plan_slices(&bundle, &request)
    })
    .await
    .map_err(|_| "Studio could not plan the delegated runs.".to_string())
}

#[tauri::command]
async fn validate_agent_artifact(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    host: State<'_, agent_protocol::AgentHostState>,
    root: String,
    markdown: String,
) -> Result<agent_artifact::AgentArtifactValidation, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    let events = host.events(&app);
    let validation = tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        agent_artifact::validate(&markdown, &bundle)
    })
    .await
    .map_err(|_| "Studio could not validate the agent artifact.".to_string())?;
    // The milestone is that the pass finished, not that it passed: a caller
    // waiting for validation has to be released either way.
    events.milestone(agent_events::AgentMilestone::ArtifactValidated {
        accepted: matches!(
            validation,
            agent_artifact::AgentArtifactValidation::Ready { .. }
        ),
    });
    Ok(validation)
}

/// Check an `okf-receipt` fence in agent output against the bundle's contract.
///
/// The gate. The agent supplies only its receipt; what that receipt is checked
/// against is read from the bundle here, because an agent that could supply
/// both sides could always make them agree.
#[tauri::command]
async fn validate_agent_receipt(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    markdown: String,
    today: String,
) -> Result<agent_receipt::AgentReceiptValidation, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        agent_receipt::validate(&root, &markdown, &bundle, &today)
    })
    .await
    .map_err(|_| "Studio could not check the run receipt.".to_string())
}

#[tauri::command]
async fn prepare_agent_artifact_critic(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    artifact_markdown: String,
) -> Result<agent_critic::AgentCriticRequest, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        agent_critic::prepare(&artifact_markdown, &bundle)
    })
    .await
    .map_err(|_| "Studio could not prepare the artifact critic.".to_string())?
}

#[tauri::command]
async fn validate_agent_artifact_critic(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    artifact_markdown: String,
    critic_markdown: String,
) -> Result<agent_critic::AgentCriticValidation, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&root);
        agent_critic::validate(&artifact_markdown, &critic_markdown, &bundle)
    })
    .await
    .map_err(|_| "Studio could not validate the artifact critic.".to_string())
}

#[tauri::command]
fn agent_catalog() -> Result<agent_catalog::AgentCatalog, String> {
    agent_catalog::load()
}

#[tauri::command]
async fn agent_security_host_status() -> agent_sandbox::AgentSecurityHostStatus {
    agent_sandbox::status().await
}

#[tauri::command]
fn custom_agents(app: AppHandle) -> Result<Vec<agent_custom::CustomAgentProfile>, String> {
    agent_custom::list(&app)
}

#[tauri::command]
fn save_custom_agent(
    app: AppHandle,
    input: agent_custom::CustomAgentInput,
) -> Result<agent_custom::CustomAgentProfile, String> {
    agent_custom::save(&app, input)
}

#[tauri::command]
fn remove_custom_agent(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    profile_id: String,
) -> Result<bool, String> {
    agent_protocol::disconnect_profile(&app, state.inner(), &profile_id)?;
    agent_custom::remove(&app, &profile_id)
}

#[tauri::command]
fn local_model_profiles(app: AppHandle) -> Result<Vec<agent_local::LocalModelProfile>, String> {
    agent_local::list(&app)
}

#[tauri::command]
async fn save_local_model_profile(
    app: AppHandle,
    input: agent_local::LocalModelProfileInput,
) -> Result<agent_local::LocalModelProfile, String> {
    tauri::async_runtime::spawn_blocking(move || agent_local::save(&app, input))
        .await
        .map_err(|_| "Studio could not finish saving the model profile.".to_string())?
}

#[tauri::command]
async fn remove_local_model_profile(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    profile_id: String,
) -> Result<bool, String> {
    agent_protocol::disconnect_profile(&app, state.inner(), &profile_id)?;
    tauri::async_runtime::spawn_blocking(move || agent_local::remove(&app, &profile_id))
        .await
        .map_err(|_| "Studio could not finish removing the model profile.".to_string())?
}

#[tauri::command]
async fn test_local_model_endpoint(
    input: agent_local::LocalModelProfileInput,
) -> Result<agent_local::LocalModelProbe, String> {
    tauri::async_runtime::spawn_blocking(move || agent_local::probe(input))
        .await
        .map_err(|_| "Studio could not finish the local endpoint test.".to_string())?
}

#[tauri::command]
async fn connect_local_model(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    profile_id: String,
    model: String,
) -> Result<agent_protocol::AgentConnectionInfo, String> {
    agent_protocol::connect_local(&app, state.inner(), &profile_id, model).await
}

#[tauri::command]
async fn connect_custom_agent(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    profile_id: String,
    bundle_root: String,
    mode: agent_protocol::AgentConnectionMode,
) -> Result<agent_protocol::AgentConnectionInfo, String> {
    let bundle_root = grants.authorize_bundle(Path::new(&bundle_root))?;
    agent_protocol::connect_custom(&app, state.inner(), &profile_id, bundle_root, mode).await
}

#[tauri::command]
async fn connect_catalog_agent(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    agent_id: String,
    bundle_root: String,
) -> Result<agent_protocol::AgentConnectionInfo, String> {
    let bundle_root = grants.authorize_bundle(Path::new(&bundle_root))?;
    agent_protocol::connect_catalog(&app, state.inner(), &agent_id, bundle_root).await
}

#[tauri::command]
fn disconnect_agent(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
) -> Result<bool, String> {
    agent_protocol::disconnect(&app, state.inner(), &connection_id)
}

#[tauri::command]
async fn new_agent_session(
    state: State<'_, agent_protocol::AgentHostState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    connection_id: String,
    bundle_root: String,
) -> Result<agent_protocol::AgentSessionInfo, String> {
    let bundle_root = grants
        .authorize_bundle(Path::new(&bundle_root))?
        .to_string_lossy()
        .into_owned();
    agent_protocol::new_session(state.inner(), &connection_id, bundle_root).await
}

#[tauri::command]
async fn list_agent_sessions(
    state: State<'_, agent_protocol::AgentHostState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    connection_id: String,
    bundle_root: String,
) -> Result<agent_protocol::AgentSessionHistoryPage, String> {
    let bundle_root = grants
        .authorize_bundle(Path::new(&bundle_root))?
        .to_string_lossy()
        .into_owned();
    agent_protocol::list_sessions(state.inner(), &connection_id, bundle_root).await
}

#[tauri::command]
async fn load_agent_session(
    state: State<'_, agent_protocol::AgentHostState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    connection_id: String,
    bundle_root: String,
    session_id: String,
) -> Result<agent_protocol::AgentLoadedSessionInfo, String> {
    let bundle_root = grants
        .authorize_bundle(Path::new(&bundle_root))?
        .to_string_lossy()
        .into_owned();
    agent_protocol::load_session(state.inner(), &connection_id, bundle_root, session_id).await
}

#[tauri::command]
async fn set_agent_session_config_option(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    config_id: String,
    value: agent_protocol::AgentSessionConfigValueInput,
) -> Result<agent_protocol::AgentSessionConfigSnapshot, String> {
    agent_protocol::set_session_config_option(
        state.inner(),
        &connection_id,
        session_id,
        config_id,
        value,
    )
    .await
}

#[tauri::command]
async fn authenticate_agent(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    method_id: String,
) -> Result<bool, String> {
    agent_protocol::authenticate(state.inner(), &connection_id, method_id).await
}

#[tauri::command]
async fn prompt_agent(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    text: String,
    context_paths: Vec<String>,
    sources: Vec<agent_sources::AgentSourceInput>,
    task_context: Option<agent_protocol::OkfTaskContextInput>,
) -> Result<agent_protocol::AgentTurnInfo, String> {
    agent_protocol::prompt(
        state.inner(),
        &connection_id,
        session_id,
        text,
        context_paths,
        sources,
        task_context,
    )
    .await
}

#[tauri::command]
async fn prompt_agent_critic(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    text: String,
) -> Result<agent_protocol::AgentTurnInfo, String> {
    agent_protocol::prompt_isolated_critic(state.inner(), &connection_id, session_id, text).await
}

#[tauri::command]
async fn pick_agent_text_sources(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<agent_sources::AgentSourceInput>, String> {
    agent_sources::pick_text_sources(&app, limit)
}

/// Pick documents and compute the deterministic intake plan over them.
/// Read-only and side-effect free beyond the picker: the plan names what
/// would be proposed, excluded, and cited, and nothing starts from it. A
/// cancelled picker returns no plan rather than an empty one.
#[tauri::command]
async fn plan_document_intake(
    app: AppHandle,
) -> Result<Option<agent_intake_plan::PlannedIntake>, String> {
    let picked = agent_sources::pick_intake_sources(&app)?;
    if picked.is_empty() {
        return Ok(None);
    }
    let (inputs, planned): (Vec<_>, Vec<_>) = picked.into_iter().unzip();
    Ok(Some(agent_intake_plan::PlannedIntake {
        plan: agent_intake_plan::compute(planned),
        sources: inputs,
    }))
}

#[tauri::command]
fn save_intake_plan(
    grants: State<'_, bundle_grant::BundleGrantState>,
    plans: State<'_, agent_intake_plan::IntakePlanState>,
    root: String,
    plan: agent_intake_plan::IntakePlan,
) -> Result<agent_intake_plan::SavedIntakePlan, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    plans.save(&root.to_string_lossy(), plan)
}

#[tauri::command]
fn saved_intake_plans(
    grants: State<'_, bundle_grant::BundleGrantState>,
    plans: State<'_, agent_intake_plan::IntakePlanState>,
    root: String,
) -> Result<Vec<agent_intake_plan::SavedIntakePlan>, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    plans.list(&root.to_string_lossy())
}

#[tauri::command]
fn remove_intake_plan(
    grants: State<'_, bundle_grant::BundleGrantState>,
    plans: State<'_, agent_intake_plan::IntakePlanState>,
    root: String,
    plan_id: String,
) -> Result<bool, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    plans.remove(&root.to_string_lossy(), &plan_id)
}

#[tauri::command]
async fn pick_agent_source_folder(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<agent_sources::AgentSourceInput>, String> {
    agent_sources::pick_source_folder(&app, limit)
}

#[tauri::command]
async fn pick_agent_image_sources(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<agent_sources::AgentSourceInput>, String> {
    agent_sources::pick_image_sources(&app, limit)
}

#[tauri::command]
async fn fetch_agent_source_url(url: String) -> Result<agent_sources::AgentSourceInput, String> {
    tauri::async_runtime::spawn_blocking(move || agent_url::fetch(url))
        .await
        .map_err(|error| format!("The URL source task failed: {error}"))?
}

#[tauri::command]
async fn export_agent_transcript(
    app: AppHandle,
    suggested_name: String,
    markdown: String,
) -> Result<Option<String>, String> {
    agent_transcript::export(&app, suggested_name, markdown).await
}

#[tauri::command]
async fn export_retrieval_diagnostics(
    app: AppHandle,
    suggested_name: String,
    payload: String,
) -> Result<Option<String>, String> {
    retrieval::export_diagnostics(&app, suggested_name, payload).await
}

#[tauri::command]
async fn export_compatibility_diagnostic(
    app: AppHandle,
    suggested_name: String,
    payload: String,
) -> Result<Option<String>, String> {
    retrieval::export_diagnostics(&app, suggested_name, payload).await
}

#[tauri::command]
async fn cancel_agent_turn(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    turn_id: String,
) -> Result<bool, String> {
    agent_protocol::cancel_turn(state.inner(), &connection_id, session_id, turn_id).await
}

#[tauri::command]
fn respond_agent_permission(
    state: State<'_, agent_protocol::AgentHostState>,
    request_id: String,
    option_id: Option<String>,
    remember_for_thread: bool,
) -> Result<bool, String> {
    agent_protocol::respond_permission(state.inner(), &request_id, option_id, remember_for_thread)
}

#[tauri::command]
async fn test_saved_local_model_endpoint(
    app: AppHandle,
    profile_id: String,
) -> Result<agent_local::LocalModelProbe, String> {
    tauri::async_runtime::spawn_blocking(move || agent_local::probe_saved(&app, &profile_id))
        .await
        .map_err(|_| "Studio could not finish the saved endpoint test.".to_string())?
}

/// Grant or revoke writes for one live ACP session through a declared mode.
/// The current UI uses the interactive thread grant. Unattended external
/// writes fail closed until the process host has an enforcement sandbox.
#[tauri::command]
fn set_agent_write_grant(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    granted: bool,
    mode: agent_stage::AgentWriteGrantMode,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    agent_protocol::set_write_grant(
        &app,
        state.inner(),
        &connection_id,
        &session_id,
        granted,
        mode,
    )
}

/// Select whether the empty staged tree overlays the active bundle or models
/// a fresh bundle. A non-empty tree must be resolved before this can change.
#[tauri::command]
fn set_agent_stage_mode(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    mode: agent_stage::AgentStageMode,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    agent_protocol::set_stage_mode(&app, state.inner(), &connection_id, &session_id, mode)
}

/// Discard every staged file for one live ACP session; the grant is untouched.
#[tauri::command]
fn discard_agent_staged_changes(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    agent_protocol::discard_staged_changes(&app, state.inner(), &connection_id, &session_id)
}

/// Discard one staged file by its reported bundle-relative path.
#[tauri::command]
fn discard_agent_staged_file(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    path: String,
) -> Result<agent_stage::AgentStagedChangesInfo, String> {
    agent_protocol::discard_staged_file(&app, state.inner(), &connection_id, &session_id, &path)
}

/// A bounded unified diff between the bundle file and one staged file.
#[tauri::command]
async fn agent_staged_file_diff(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    path: String,
) -> Result<agent_stage::AgentStagedFileDiff, String> {
    agent_protocol::staged_file_diff(state.inner(), &connection_id, &session_id, &path).await
}

/// Select or reject one hunk from the exact staged revision under review.
#[tauri::command]
async fn set_agent_staged_hunk_selection(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    path: String,
    revision: String,
    hunk_index: usize,
    selected: bool,
) -> Result<agent_stage::AgentStagedFileDiff, String> {
    agent_protocol::set_staged_hunk_selection(
        state.inner(),
        &connection_id,
        &session_id,
        &path,
        &revision,
        hunk_index,
        selected,
    )
    .await
}

/// Validate the selected staged tree without changing the open bundle.
#[tauri::command]
async fn validate_agent_staged_changes(
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
) -> Result<agent_stage::AgentStagedValidationInfo, String> {
    agent_protocol::validate_staged_changes(state.inner(), &connection_id, &session_id).await
}

/// Apply the exact staged revision that passed validation.
#[tauri::command]
async fn apply_agent_staged_changes(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    revision: String,
) -> Result<agent_stage::AgentStagedApplyInfo, String> {
    agent_protocol::apply_staged_changes(
        &app,
        state.inner(),
        &connection_id,
        &session_id,
        &revision,
    )
    .await
}

/// Create the exact validated fresh draft below a user-selected parent folder.
#[tauri::command]
async fn create_agent_staged_bundle(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
    revision: String,
    folder_name: String,
) -> Result<Option<agent_stage::AgentStagedCreateInfo>, String> {
    agent_protocol::create_staged_bundle(
        &app,
        state.inner(),
        &connection_id,
        &session_id,
        &revision,
        &folder_name,
    )
    .await
}

#[tauri::command]
async fn restore_agent_staged_checkpoint(
    app: AppHandle,
    state: State<'_, agent_protocol::AgentHostState>,
    connection_id: String,
    session_id: String,
) -> Result<agent_stage::AgentCheckpointRestoreInfo, String> {
    agent_protocol::restore_staged_checkpoint(&app, state.inner(), &connection_id, &session_id)
        .await
}

#[tauri::command]
fn agent_install_preflight(
    app: AppHandle,
    agent_id: String,
) -> Result<agent_install::AgentInstallPreflight, String> {
    agent_install::preflight(&app, &agent_id)
}

#[tauri::command]
async fn install_agent(
    app: AppHandle,
    state: State<'_, agent_install::AgentInstallState>,
    agent_id: String,
    install_id: String,
) -> Result<agent_install::AgentInstallReceipt, String> {
    let cancelled = state.start(&install_id, &agent_id)?;
    let task_app = app.clone();
    let task_agent_id = agent_id.clone();
    let task_install_id = install_id.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        agent_install::install(&task_app, &task_agent_id, &task_install_id, cancelled)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("Install task failed: {error}")),
    };
    state.finish(&install_id);
    result
}

#[tauri::command]
fn cancel_agent_install(
    state: State<'_, agent_install::AgentInstallState>,
    install_id: String,
) -> Result<bool, String> {
    state.cancel(&install_id)
}

#[tauri::command]
fn uninstall_agent(
    app: AppHandle,
    install_state: State<'_, agent_install::AgentInstallState>,
    host_state: State<'_, agent_protocol::AgentHostState>,
    agent_id: String,
) -> Result<(), String> {
    if install_state.is_installing(&agent_id)? {
        return Err("Finish or cancel the running installation first.".to_string());
    }
    if host_state.has_profile_connection(&format!("catalog-{agent_id}")) {
        return Err("Disconnect this agent before removing it.".to_string());
    }
    agent_install::uninstall(&app, &agent_id)
}

/// Fetch a remote bundle (a GitHub repo tarball or a direct archive URL) into a
/// local cache directory and return that directory's path, which the frontend
/// then opens like any picked folder. It runs only on an explicit user action;
/// other network paths have separate provider, install, update, or source APIs.
/// Blocking I/O runs off the UI thread.
/// See `remote.rs` and docs/architecture/ipc-and-security.md.
#[tauri::command]
async fn fetch_remote_bundle(
    app: AppHandle,
    grants: State<'_, bundle_grant::BundleGrantState>,
    source: remote::RemoteSource,
) -> Result<String, String> {
    let folder = tauri::async_runtime::spawn_blocking(move || remote::fetch(&app, source))
        .await
        .map_err(|e| format!("Fetch task failed: {e}"))??;
    grants.grant(
        Path::new(&folder),
        bundle_grant::BundleGrantKind::RemoteCache,
    )
}

/// Read one companion asset's text (an ODSF `*.example.html` or a `styles/*.css`
/// it links) for the design-system renderer. `rel` is a bundle-relative path;
/// the core guards against escaping the bundle root and only serves text assets.
/// Returns `null` to the frontend when the asset is absent or not permitted.
#[tauri::command]
fn read_asset(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    rel: String,
) -> Result<Option<String>, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    Ok(okf_core::read_asset(&root, &rel))
}

/// Read the computation an Attested Computation concept declares, for display.
///
/// The webview passes a **concept id, never a path**. The path comes from that
/// concept's own `computation` field, read back out of the bundle here. That is
/// the authorization: a computation may be `.sql`, `.py`, anything its runtime
/// takes, so the extension allowlist that guards `read_asset` cannot express
/// what is permitted — and widening that door would have granted a great deal
/// more, since it takes a caller-supplied path.
///
/// `None` covers every miss: unknown concept, no declared computation, an
/// inline one, absent file, oversized, or a path escaping the bundle root.
///
/// Studio does not execute what it returns.
#[tauri::command]
async fn read_declared_computation(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    concept_id: String,
) -> Result<Option<String>, String> {
    let authorized_root = grants.authorize_bundle(Path::new(&bundle_root))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&authorized_root);
        let concept = bundle
            .concepts
            .iter()
            .find(|concept| concept.id == concept_id)?;
        okf_core::read_declared_computation(&authorized_root, concept)
    })
    .await
    .map_err(|_| "Studio could not read the declared computation.".to_string())
}

/// The largest receipt Studio will attest. A run's evidence is a handful of
/// fields; anything past this is not a receipt, and parsing it would be work
/// done on behalf of whatever sent it.
const MAX_RECEIPT_FIELDS: usize = 64;
const MAX_RECEIPT_VALUE_CHARS: usize = 256 * 1024;

/// Attest one run of an Attested Computation against the bundle's contract.
///
/// The webview supplies a concept id and a receipt, never a path or a
/// computation: what the run is checked *against* is read from the bundle here,
/// which is the only arrangement where the check means anything. A caller that
/// could supply both sides could always make them agree.
///
/// Studio does not execute the executor or the attester. It compares what a run
/// reports it did against what the bundle sanctioned, and reports fidelity as
/// unavailable because only the runtime can re-read a result by job id.
#[tauri::command]
async fn attest_computation_run(
    grants: State<'_, bundle_grant::BundleGrantState>,
    bundle_root: String,
    concept_id: String,
    receipt: std::collections::BTreeMap<String, String>,
    today: String,
) -> Result<okf_core::attest::AttestationReport, String> {
    let authorized_root = grants.authorize_bundle(Path::new(&bundle_root))?;
    if receipt.len() > MAX_RECEIPT_FIELDS {
        return Err("That receipt declares more fields than a run's evidence has.".to_string());
    }
    if receipt
        .values()
        .any(|value| value.len() > MAX_RECEIPT_VALUE_CHARS)
    {
        return Err("A receipt field is too large to attest.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = okf_core::read_bundle(&authorized_root);
        let concept = bundle
            .concepts
            .iter()
            .find(|concept| concept.id == concept_id)
            .ok_or_else(|| "That concept is not in this bundle.".to_string())?;
        Ok(okf_core::attest::attest_run(
            &authorized_root,
            concept,
            &receipt,
            &today,
        ))
    })
    .await
    .map_err(|_| "Studio could not complete the attestation.".to_string())?
}

/// Read a local bundle image as a `data:` URL so the reader can render it inline
/// without a network fetch (the offline stance). Returns `null` when the image
/// is absent, not an image type, or escapes the bundle root.
#[tauri::command]
fn read_asset_data_url(
    grants: State<'_, bundle_grant::BundleGrantState>,
    root: String,
    rel: String,
) -> Result<Option<String>, String> {
    let root = grants.authorize_bundle(Path::new(&root))?;
    Ok(okf_core::read_asset_data_url(&root, &rel))
}

/// Begin watching `folder` recursively for filesystem changes, emitting a
/// debounced `bundle-changed` event on each burst. Replaces any active watch.
#[tauri::command]
fn start_watch(
    app: AppHandle,
    state: State<'_, WatchState>,
    grants: State<'_, bundle_grant::BundleGrantState>,
    folder: String,
) -> Result<(), String> {
    let folder = grants
        .authorize_bundle(Path::new(&folder))?
        .to_string_lossy()
        .into_owned();
    watch::start(app, state.inner(), folder);
    Ok(())
}

/// Stop the active watch, if any.
#[tauri::command]
fn stop_watch(state: State<'_, WatchState>) {
    watch::stop(state.inner());
}

/// Diagnostic sink: print a frontend message to the host terminal. The webview
/// console is invisible in `tauri dev` output, so crash forensics (uncaught
/// errors, heap samples) route through here.
const MAX_FRONTEND_LOG_CHARS: usize = 16 * 1024;
const FRONTEND_LOG_TRUNCATION_MARKER: &str = " … [truncated]";

fn bounded_frontend_diagnostic(message: &str) -> String {
    let mut diagnostic = String::new();
    let mut separated = false;
    let mut characters = message.trim().chars();
    for character in characters.by_ref().take(MAX_FRONTEND_LOG_CHARS) {
        if character.is_whitespace() {
            if !separated && !diagnostic.is_empty() {
                diagnostic.push(' ');
                separated = true;
            }
            continue;
        }
        if character.is_control() {
            continue;
        }
        diagnostic.push(character);
        separated = false;
    }
    if characters.next().is_some() {
        let available =
            MAX_FRONTEND_LOG_CHARS.saturating_sub(FRONTEND_LOG_TRUNCATION_MARKER.chars().count());
        diagnostic = diagnostic.chars().take(available).collect();
        diagnostic.push_str(FRONTEND_LOG_TRUNCATION_MARKER);
    }
    if diagnostic.is_empty() {
        "(empty diagnostic)".to_string()
    } else {
        diagnostic
    }
}

#[tauri::command]
fn frontend_log(message: String) {
    eprintln!("[frontend] {}", bounded_frontend_diagnostic(&message));
}

/// Whether the running install can update itself in place. The Tauri updater
/// only replaces an AppImage on Linux, so a `.deb` (or any non-AppImage) install
/// must update by downloading the new package; Windows/macOS self-update fine.
/// The Settings "Check for updates" flow uses this to offer Install vs Download.
#[tauri::command]
fn can_self_update() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

// Native-feel reinforcement: browser page-zoom hotkeys are disabled per window.
// The `main` window is declared in tauri.conf.json, so we set
// `"zoomHotkeysEnabled": false` there (the config maps to the same webview
// attribute as the `WebviewWindowBuilder::zoom_hotkeys_enabled(false)` builder
// method — there is no runtime setter on a live window in Tauri 2). On Windows
// this disables WebView2's zoom control; on macOS/Linux it ensures Tauri's
// ctrl/cmd +/- zoom polyfill is never injected. The cross-platform floor — and
// the only guard on Linux/WebKitGTK — is the JS handler in src/native.ts, which
// also remaps the keys/gesture to the reader text-size setting.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single-instance must be the first plugin. On Windows/Linux the deep-link
    // plugin forwards registered URLs through it; ordinary CLI entry points
    // use the same parser and preview queue.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let args = argv
            .into_iter()
            .skip(1)
            .map(std::ffi::OsString::from)
            .collect();
        if let Err(error) = external_entry::queue_cli(app, args) {
            eprintln!("[external-entry] {error}");
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init());

    // Opt-in updater — the user triggers a check from Settings; the app never
    // checks on its own (see docs/ux/settings.md). `process` is needed to
    // relaunch after an update installs. Desktop only. window-state restores
    // the main window's size, position, and maximized/fullscreen state across
    // launches; reader pop-outs keep their per-open geometry instead.
    #[cfg(desktop)]
    let builder = builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                // Windows are created hidden (`visible: false` in
                // tauri.conf.json) and revealed by the frontend after its
                // first painted frame; restoring VISIBLE here would flash the
                // transparent, undecorated shell before the webview paints.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            app.manage(external_entry::ExternalEntryState::default());
            if let Err(error) = agent_capabilities::load_pack_state(app.handle()) {
                eprintln!("[capability-pack] {error}");
            }
            app.manage(
                bundle_grant::BundleGrantState::load(app.handle()).map_err(|error| {
                    std::io::Error::other(format!("could not load bundle grants: {error}"))
                })?,
            );
            app.manage(
                bundle_library::BundleLibraryState::load(app.handle()).map_err(|error| {
                    std::io::Error::other(format!("could not load bundle library: {error}"))
                })?,
            );
            app.manage(WatchState::default());
            app.manage(git_watch::GitWatchState::default());
            app.manage(agent_install::AgentInstallState::default());
            app.manage(agent_protocol::AgentHostState::default());
            app.manage(compatibility_stage::CompatibilityStageState::persistent(
                app.path()
                    .app_data_dir()?
                    .join("compatibility")
                    .join("apply-checkpoints"),
            ));
            app.manage(
                agent_routines::RoutineState::load(app.handle()).map_err(|error| {
                    std::io::Error::other(format!("could not load OKF routines: {error}"))
                })?,
            );
            app.manage(
                agent_intake_plan::IntakePlanState::load(app.handle()).map_err(|error| {
                    std::io::Error::other(format!("could not load intake plans: {error}"))
                })?,
            );

            // Deep links and CLI requests only enter the bounded preview queue.
            // Filesystem confirmation and activation are separate commands.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Some(urls) = app.deep_link().get_current()? {
                    for url in urls {
                        if let Err(error) =
                            external_entry::queue_deep_link(app.handle(), url.as_str())
                        {
                            eprintln!("[external-entry] {error}");
                        }
                    }
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if let Err(error) = external_entry::queue_deep_link(&handle, url.as_str()) {
                            eprintln!("[external-entry] {error}");
                        }
                    }
                });
                let cli_args = std::env::args_os().skip(1).collect();
                if let Err(error) = external_entry::queue_cli(app.handle(), cli_args) {
                    eprintln!("[external-entry] {error}");
                }
            }

            // Show-on-ready watchdog. The main window starts hidden and the
            // frontend reveals it after its first painted frame (src/App.tsx),
            // so the transparent, undecorated shell is never shown while the
            // webview boots. If the frontend dies before that (a script error,
            // a dev-server hiccup), show the window anyway so a broken launch
            // is a visible blank window instead of a ghost process.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    if let Some(window) = handle.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            let _ = window.show();
                        }
                    }
                });
            }

            // Linux/WebKitGTK: trackpad pinch is applied as a *native* webview
            // zoom that never reaches JS as a preventable event — unlike WebView2
            // (ctrl+wheel) and WKWebView (gesture events), which src/native.ts
            // already blocks. WebKitGTK drives it from a GtkGestureZoom it stashes
            // on the web view under the private qdata key "wk-view-zoom-gesture";
            // destroying that gesture's signal handlers disables pinch-zoom at the
            // source. (Desktop app — nothing relies on that touch gesture.) We also
            // pin the zoom level to 1.0 as a belt-and-suspenders for any other path.
            // Page-zoom of the whole app isn't a native desktop behavior; reader
            // text-size and graph zoom are the real affordances (docs/ux/settings.md).
            // No-op on Windows/macOS. Ref: tauri-apps/wry#544, tauri#3843.
            #[cfg(target_os = "linux")]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.with_webview(|webview| {
                    use gtk::glib::gobject_ffi;
                    use gtk::glib::prelude::ObjectExt;
                    use webkit2gtk::WebViewExt;
                    let wv = webview.inner();
                    // SAFETY: reading WebKitGTK's own qdata pointer for the zoom
                    // gesture and destroying its handlers on the GTK main thread.
                    unsafe {
                        if let Some(gesture) = wv.data::<gtk::GestureZoom>("wk-view-zoom-gesture") {
                            gobject_ffi::g_signal_handlers_destroy(gesture.as_ptr().cast());
                        }
                    }
                    wv.set_zoom_level(1.0);
                    wv.connect_zoom_level_notify(|wv| {
                        if (wv.zoom_level() - 1.0).abs() > f64::EPSILON {
                            wv.set_zoom_level(1.0);
                        }
                    });
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_bundle_folder,
            pick_git_repository_folder,
            create_bundle,
            revoke_bundle_grant,
            scan_bundles,
            read_bundle,
            okf_ignore_report,
            okf_compatibility_report,
            okf_profile_report,
            okf_interop_report,
            okf_projection_plan,
            export_okf_projection,
            export_semantic_web,
            import_semantic_web,
            export_okf_sidecar,
            stage_compatibility_normalization,
            select_compatibility_hunk,
            validate_compatibility_normalization,
            apply_compatibility_normalization,
            discard_compatibility_normalization,
            restore_compatibility_normalization,
            stage_concept_move,
            stage_concept_retirement,
            concept_move_diff,
            select_concept_move_hunk,
            validate_concept_move,
            apply_concept_move,
            discard_concept_move,
            restore_concept_move,
            git_repository_snapshot,
            git_repository_history,
            git_repository_diff,
            git_stage_paths,
            git_unstage_paths,
            git_stage_all,
            git_unstage_all,
            git_commit,
            git_undo_commit,
            git_remote_operation,
            git_start_watch,
            git_stop_watch,
            retrieve_okf_context,
            diff_okf_retrieval_receipts,
            bundle_library,
            preview_federated_bundles,
            federated_inventory,
            federated_search,
            federated_sources,
            federated_relationship_candidates,
            plan_agent_slices,
            plan_document_intake,
            save_intake_plan,
            saved_intake_plans,
            remove_intake_plan,
            assemble_agent_runs,
            evaluate_agent_budget,
            prompt_agent_run,
            resolve_agent_run,
            validate_agent_artifact,
            validate_agent_receipt,
            prepare_agent_artifact_critic,
            validate_agent_artifact_critic,
            agent_catalog,
            okf_capability_catalog,
            set_okf_capability_pack_active,
            okf_routine_workspace,
            save_okf_routine,
            remove_okf_routine,
            run_okf_routine,
            run_due_okf_routines,
            create_okf_mcp_grant,
            pending_external_entries,
            accept_external_entry,
            dismiss_external_entry,
            agent_security_host_status,
            custom_agents,
            save_custom_agent,
            remove_custom_agent,
            local_model_profiles,
            save_local_model_profile,
            remove_local_model_profile,
            test_local_model_endpoint,
            test_saved_local_model_endpoint,
            connect_local_model,
            connect_custom_agent,
            connect_catalog_agent,
            disconnect_agent,
            authenticate_agent,
            new_agent_session,
            list_agent_sessions,
            load_agent_session,
            set_agent_session_config_option,
            prompt_agent,
            prompt_agent_critic,
            pick_agent_text_sources,
            pick_agent_source_folder,
            pick_agent_image_sources,
            fetch_agent_source_url,
            export_agent_transcript,
            export_retrieval_diagnostics,
            export_compatibility_diagnostic,
            cancel_agent_turn,
            respond_agent_permission,
            set_agent_write_grant,
            set_agent_stage_mode,
            discard_agent_staged_changes,
            discard_agent_staged_file,
            agent_staged_file_diff,
            set_agent_staged_hunk_selection,
            validate_agent_staged_changes,
            apply_agent_staged_changes,
            create_agent_staged_bundle,
            restore_agent_staged_checkpoint,
            agent_install_preflight,
            install_agent,
            cancel_agent_install,
            uninstall_agent,
            fetch_remote_bundle,
            read_asset,
            read_asset_data_url,
            read_declared_computation,
            attest_computation_run,
            start_watch,
            stop_watch,
            can_self_update,
            frontend_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_frontend_diagnostic, FRONTEND_LOG_TRUNCATION_MARKER, MAX_FRONTEND_LOG_CHARS,
    };

    #[test]
    fn frontend_diagnostics_are_single_line_control_free_and_bounded() {
        assert_eq!(
            bounded_frontend_diagnostic(" first\u{1b}[31m\r\nsecond\tline\u{2028}three\0 "),
            "first[31m second line three"
        );
        assert_eq!(bounded_frontend_diagnostic("\r\n\t"), "(empty diagnostic)");

        let oversized = "é".repeat(MAX_FRONTEND_LOG_CHARS + 1);
        let bounded = bounded_frontend_diagnostic(&oversized);
        assert!(bounded.ends_with(FRONTEND_LOG_TRUNCATION_MARKER));
        assert_eq!(bounded.chars().count(), MAX_FRONTEND_LOG_CHARS);
        assert_eq!(
            bounded.matches('é').count(),
            MAX_FRONTEND_LOG_CHARS - FRONTEND_LOG_TRUNCATION_MARKER.chars().count()
        );
    }
}
