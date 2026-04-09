/// Windows Service integration for ReefVPN daemon.
///
/// Registers and runs the daemon as a Windows Service named "ReefVPN".
/// The service wraps the IPC pipe server and handles SCM lifecycle events
/// (start / stop / shutdown).  When stopped it disconnects VPN and cleans up
/// sing-box before signalling SERVICE_STOPPED to SCM.
///
/// A `--standalone` flag bypasses service mode so the binary can be run
/// directly in a terminal during development.
use crate::ipc::{start_pipe_server, DaemonState};
use log::{error, info};
use std::sync::Arc;

#[cfg(windows)]
use {
    std::ffi::OsString,
    windows_service::{
        define_windows_service,
        service::{
            ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
            ServiceType,
        },
        service_control_handler::ServiceControlHandlerResult,
        service_dispatcher,
        service_manager::{ServiceManager, ServiceManagerAccess},
        service::{ServiceAccess, ServiceInfo, ServiceStartType, ServiceErrorControl},
    },
};

pub const SERVICE_NAME: &str = "ReefVPN";
pub const SERVICE_DISPLAY_NAME: &str = "ReefVPN Daemon";
pub const SERVICE_DESCRIPTION: &str =
    "Manages VPN tunnels for the ReefVPN application via sing-box";

// ── Windows-service entry point ──────────────────────────────────────────────

#[cfg(windows)]
define_windows_service!(ffi_service_main, service_main);

/// Called by the SCM thread when the service starts.
#[cfg(windows)]
fn service_main(_arguments: Vec<OsString>) {
    if let Err(e) = run_service() {
        error!("Service failed: {:?}", e);
    }
}

#[cfg(windows)]
fn run_service() -> windows_service::Result<()> {
    use std::time::Duration;
    use windows_service::service_control_handler;

    // Shared daemon state
    let state = Arc::new(DaemonState::new());
    let state_for_stop = Arc::clone(&state);

    // Channel used by the stop handler to wake the service thread
    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();

    // Register the service control handler with the SCM
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,

            ServiceControl::Stop | ServiceControl::Shutdown => {
                info!("SCM requested stop – disconnecting VPN…");
                // Best-effort disconnect; ignore errors (process will exit anyway)
                state_for_stop.disconnect().ok();
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }

            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    // Notify SCM: we are starting
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StartPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: std::time::Duration::from_secs(10),
        process_id: None,
    })?;

    // Spawn the IPC pipe server on a background thread so this thread can
    // block on the shutdown channel.
    let state_for_pipe = Arc::clone(&state);
    std::thread::spawn(move || {
        start_pipe_server(state_for_pipe);
    });

    // Notify SCM: running
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(0),
        process_id: None,
    })?;

    info!("ReefVPN service running");

    // Block until SCM sends Stop/Shutdown
    let _ = shutdown_rx.recv();

    // Notify SCM: stopping
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StopPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(5),
        process_id: None,
    })?;

    info!("ReefVPN service stopped");

    // Notify SCM: stopped
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(0),
        process_id: None,
    })?;

    Ok(())
}

// ── Public helpers called from main() ────────────────────────────────────────

/// Run as a regular process (no SCM involved).  Blocks until Ctrl-C.
pub fn run_standalone() {
    info!("Running ReefVPN daemon in standalone mode (not as a Windows Service)");
    let state = Arc::new(DaemonState::new());

    // Spawn auto-reconnect monitor
    crate::ipc::start_reconnect_monitor(Arc::clone(&state));

    // Run pipe server on the current thread (blocking)
    start_pipe_server(state);
}

/// Dispatch to SCM (production mode).
#[cfg(windows)]
pub fn run_as_service() {
    info!("Dispatching to Windows Service Control Manager…");
    if let Err(e) = service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
        error!("Failed to start service dispatcher: {:?}", e);
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
pub fn run_as_service() {
    // On non-Windows platforms just fall back to standalone
    run_standalone();
}

/// Install the Windows Service (requires Administrator privileges).
#[cfg(windows)]
pub fn install_service() -> Result<(), String> {
    let manager =
        ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CREATE_SERVICE)
            .map_err(|e| format!("Failed to open SCM: {:?}", e))?;

    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Cannot determine exe path: {}", e))?;

    let info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe_path,
        launch_arguments: vec![],          // runs as service by default
        dependencies: vec![],
        account_name: None,                // LocalSystem
        account_password: None,
    };

    let service = manager
        .create_service(&info, ServiceAccess::CHANGE_CONFIG)
        .map_err(|e| format!("Failed to create service: {:?}", e))?;

    service
        .set_description(SERVICE_DESCRIPTION)
        .map_err(|e| format!("Failed to set description: {:?}", e))?;

    println!("Service '{}' installed successfully.", SERVICE_NAME);
    Ok(())
}

#[cfg(not(windows))]
pub fn install_service() -> Result<(), String> {
    Err("Windows Service installation is only supported on Windows".into())
}

/// Uninstall the Windows Service (requires Administrator privileges).
#[cfg(windows)]
pub fn uninstall_service() -> Result<(), String> {
    use std::time::Duration;

    let manager =
        ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
            .map_err(|e| format!("Failed to open SCM: {:?}", e))?;

    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::STOP | ServiceAccess::DELETE | ServiceAccess::QUERY_STATUS)
        .map_err(|e| format!("Failed to open service '{}': {:?}", SERVICE_NAME, e))?;

    // Stop the service if it is running
    let status = service
        .query_status()
        .map_err(|e| format!("Failed to query service status: {:?}", e))?;

    if status.current_state != ServiceState::Stopped {
        service
            .stop()
            .map_err(|e| format!("Failed to stop service: {:?}", e))?;

        // Wait up to 10 s for it to stop
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let s = service.query_status().map_err(|e| e.to_string())?;
            if s.current_state == ServiceState::Stopped {
                break;
            }
            if std::time::Instant::now() > deadline {
                return Err("Timed out waiting for service to stop".into());
            }
        }
    }

    service
        .delete()
        .map_err(|e| format!("Failed to delete service: {:?}", e))?;

    println!("Service '{}' uninstalled successfully.", SERVICE_NAME);
    Ok(())
}

#[cfg(not(windows))]
pub fn uninstall_service() -> Result<(), String> {
    Err("Windows Service uninstallation is only supported on Windows".into())
}
