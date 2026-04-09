// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // If not running as admin, relaunch with UAC elevation
    #[cfg(windows)]
    {
        if !is_elevated() {
            relaunch_elevated();
            return;
        }
    }

    desktop_lib::run()
}

#[cfg(windows)]
fn is_elevated() -> bool {
    use std::process::Command;
    // Simple check: try to write to a protected location
    let output = Command::new("net")
        .args(["session"])
        .output();
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn relaunch_elevated() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    let exe = std::env::current_exe().unwrap_or_default();
    let exe_wide: Vec<u16> = OsStr::new(exe.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let verb: Vec<u16> = OsStr::new("runas")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            exe_wide.as_ptr(),
            ptr::null(),
            ptr::null(),
            windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL as i32,
        );
    }
}
