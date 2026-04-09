/// WFP (Windows Filtering Platform) kill switch.
///
/// When enabled, blocks ALL outbound traffic except:
/// 1. Traffic from TUN interface (172.19.0.0/30)
/// 2. Localhost (127.0.0.0/8)
///
/// Uses FWPM_SESSION_FLAG_DYNAMIC — filters auto-cleanup when process exits.
use log::info;
use std::sync::Mutex;

#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;
#[cfg(windows)]
use windows_sys::Win32::Foundation::*;

static ENGINE_HANDLE: Mutex<Option<u64>> = Mutex::new(None);

#[cfg(windows)]
const REEFVPN_SUBLAYER: windows_sys::core::GUID = windows_sys::core::GUID {
    data1: 0xBEEF0001, data2: 0x0001, data3: 0x0001,
    data4: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
};

#[cfg(windows)]
const FILTER_BLOCK: windows_sys::core::GUID = windows_sys::core::GUID {
    data1: 0xBEEF0002, data2: 0x0001, data3: 0x0001,
    data4: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
};

#[cfg(windows)]
const FILTER_PERMIT_LO: windows_sys::core::GUID = windows_sys::core::GUID {
    data1: 0xBEEF0003, data2: 0x0001, data3: 0x0001,
    data4: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
};

#[cfg(windows)]
const FILTER_PERMIT_TUN: windows_sys::core::GUID = windows_sys::core::GUID {
    data1: 0xBEEF0004, data2: 0x0001, data3: 0x0001,
    data4: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
};

#[cfg(windows)]
fn w(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

#[cfg(windows)]
pub fn enable_killswitch() -> Result<(), String> {
    disable_killswitch().ok();

    unsafe {
        let mut handle: HANDLE = std::ptr::null_mut();

        let mut name_buf = w("ReefVPN Kill Switch");
        let session = FWPM_SESSION0 {
            sessionKey: std::mem::zeroed(),
            displayData: FWPM_DISPLAY_DATA0 { name: name_buf.as_mut_ptr(), description: std::ptr::null_mut() },
            flags: FWPM_SESSION_FLAG_DYNAMIC,
            txnWaitTimeoutInMSec: 0,
            processId: std::process::id(),
            sid: std::ptr::null_mut(),
            username: std::ptr::null_mut(),
            kernelMode: 0,
        };

        let err = FwpmEngineOpen0(std::ptr::null(), 0, std::ptr::null(), &session, &mut handle);
        if err != 0 { return Err(format!("FwpmEngineOpen0: 0x{:08X}", err)); }

        *ENGINE_HANDLE.lock().unwrap() = Some(handle as u64);

        if FwpmTransactionBegin0(handle, 0) != 0 {
            FwpmEngineClose0(handle);
            *ENGINE_HANDLE.lock().unwrap() = None;
            return Err("FwpmTransactionBegin0 failed".into());
        }

        // Sublayer
        let mut sl_name = w("ReefVPN");
        let sublayer = FWPM_SUBLAYER0 {
            subLayerKey: REEFVPN_SUBLAYER,
            displayData: FWPM_DISPLAY_DATA0 { name: sl_name.as_mut_ptr(), description: std::ptr::null_mut() },
            flags: 0,
            providerKey: std::ptr::null_mut(),
            providerData: FWP_BYTE_BLOB { size: 0, data: std::ptr::null_mut() },
            weight: 0xFFFF,
        };
        let err = FwpmSubLayerAdd0(handle, &sublayer, std::ptr::null_mut());
        if err != 0 && err != 0x80320009 { // FWP_E_ALREADY_EXISTS
            FwpmTransactionAbort0(handle);
            FwpmEngineClose0(handle);
            *ENGINE_HANDLE.lock().unwrap() = None;
            return Err(format!("FwpmSubLayerAdd0: 0x{:08X}", err));
        }

        // Permit localhost
        add_filter(handle, FILTER_PERMIT_LO, "Permit Localhost",
            FWPM_CONDITION_IP_REMOTE_ADDRESS, [127, 0, 0, 0], [255, 0, 0, 0],
            FWP_ACTION_PERMIT, 10)?;

        // Permit TUN
        add_filter(handle, FILTER_PERMIT_TUN, "Permit TUN",
            FWPM_CONDITION_IP_LOCAL_ADDRESS, [172, 19, 0, 0], [255, 255, 255, 252],
            FWP_ACTION_PERMIT, 10)?;

        // Block everything else
        let mut blk_name = w("ReefVPN Block All");
        let block_filter = FWPM_FILTER0 {
            filterKey: FILTER_BLOCK,
            displayData: FWPM_DISPLAY_DATA0 { name: blk_name.as_mut_ptr(), description: std::ptr::null_mut() },
            flags: 0,
            providerKey: std::ptr::null_mut(),
            providerData: FWP_BYTE_BLOB { size: 0, data: std::ptr::null_mut() },
            layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            subLayerKey: REEFVPN_SUBLAYER,
            weight: FWP_VALUE0 { r#type: FWP_UINT8, Anonymous: FWP_VALUE0_0 { uint8: 1 } },
            numFilterConditions: 0,
            filterCondition: std::ptr::null_mut(),
            action: FWPM_ACTION0 { r#type: FWP_ACTION_BLOCK, Anonymous: FWPM_ACTION0_0 { filterType: std::mem::zeroed() } },
            Anonymous: std::mem::zeroed(),
            reserved: std::ptr::null_mut(),
            filterId: 0,
            effectiveWeight: std::mem::zeroed(),
        };
        let mut id: u64 = 0;
        let err = FwpmFilterAdd0(handle, &block_filter, std::ptr::null_mut(), &mut id);
        if err != 0 { FwpmTransactionAbort0(handle); return Err(format!("Block filter: 0x{:08X}", err)); }

        if FwpmTransactionCommit0(handle) != 0 {
            FwpmTransactionAbort0(handle);
            return Err("Commit failed".into());
        }

        info!("WFP kill switch enabled");
        Ok(())
    }
}

#[cfg(windows)]
pub fn disable_killswitch() -> Result<(), String> {
    if let Some(h) = ENGINE_HANDLE.lock().unwrap().take() {
        let handle = h as HANDLE;
        unsafe {
            FwpmFilterDeleteByKey0(handle, &FILTER_BLOCK);
            FwpmFilterDeleteByKey0(handle, &FILTER_PERMIT_LO);
            FwpmFilterDeleteByKey0(handle, &FILTER_PERMIT_TUN);
            FwpmSubLayerDeleteByKey0(handle, &REEFVPN_SUBLAYER);
            FwpmEngineClose0(handle);
        }
        info!("WFP kill switch disabled");
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn add_filter(
    handle: HANDLE,
    key: windows_sys::core::GUID,
    name: &str,
    field_key: windows_sys::core::GUID,
    addr: [u8; 4],
    mask: [u8; 4],
    action_type: u32,
    weight: u8,
) -> Result<(), String> {
    let mut addr_mask = FWP_V4_ADDR_AND_MASK {
        addr: u32::from_be_bytes(addr),
        mask: u32::from_be_bytes(mask),
    };

    let mut condition = FWPM_FILTER_CONDITION0 {
        fieldKey: field_key,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: FWP_V4_ADDR_MASK,
            Anonymous: FWP_CONDITION_VALUE0_0 { v4AddrMask: &mut addr_mask },
        },
    };

    let mut filter_name = w(name);
    let filter = FWPM_FILTER0 {
        filterKey: key,
        displayData: FWPM_DISPLAY_DATA0 { name: filter_name.as_mut_ptr(), description: std::ptr::null_mut() },
        flags: 0,
        providerKey: std::ptr::null_mut(),
        providerData: FWP_BYTE_BLOB { size: 0, data: std::ptr::null_mut() },
        layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        subLayerKey: REEFVPN_SUBLAYER,
        weight: FWP_VALUE0 { r#type: FWP_UINT8, Anonymous: FWP_VALUE0_0 { uint8: weight } },
        numFilterConditions: 1,
        filterCondition: &mut condition,
        action: FWPM_ACTION0 { r#type: action_type, Anonymous: FWPM_ACTION0_0 { filterType: std::mem::zeroed() } },
        Anonymous: std::mem::zeroed(),
        reserved: std::ptr::null_mut(),
        filterId: 0,
        effectiveWeight: std::mem::zeroed(),
    };

    let mut id: u64 = 0;
    let err = FwpmFilterAdd0(handle, &filter, std::ptr::null_mut(), &mut id);
    if err != 0 { return Err(format!("{} filter: 0x{:08X}", name, err)); }
    Ok(())
}

#[cfg(not(windows))]
pub fn enable_killswitch() -> Result<(), String> { Ok(()) }

#[cfg(not(windows))]
pub fn disable_killswitch() -> Result<(), String> { Ok(()) }
