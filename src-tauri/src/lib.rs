//! Tiny Farm 데스크테리어 위젯의 네이티브 쪽.
//!
//! 하는 일
//! - 농장 상태와 설정을 앱 데이터 디렉터리의 JSON 파일로 읽고 쓴다. 웹뷰 저장소가 아니라
//!   실제 파일로 두는 이유는 사용자가 백업하고 옮길 수 있어야 하기 때문이다.
//! - 본창과 미니 위젯, 두 창의 표시 상태를 관리한다.
//! - 본창의 닫기를 가로채 종료 대신 숨김으로 바꾼다. 트레이에 남아야 시간이 계속 흐른다.
//! - 트레이 아이콘과 메뉴를 올린다.
//!
//! 쓰기 권한은 본창만 갖는다. 두 창이 같은 파일을 쓰면 마지막에 쓴 쪽이 이기고 농장
//! 시계가 어긋난다. Tauri 의 capability 는 직접 만든 명령을 막지 못하므로 명령 안에서
//! 호출한 창의 라벨을 확인해 거른다. 규약이 아니라 구조로 막는 게 목적이다.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Runtime, WebviewWindow, WindowEvent};

const MAIN_LABEL: &str = "main";
const MINI_LABEL: &str = "mini";

const STATE_FILE: &str = "state.json";
const SETTINGS_FILE: &str = "settings.json";
const AUTOSTART_LABEL: &str = "app.tinyfarm.widget";
const AUTOSTART_FILE: &str = "app.tinyfarm.widget.plist";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AutostartStatus {
    enabled: bool,
    file_exists: bool,
    path_matches: bool,
    loaded: bool,
    /// 사용자가 시스템 설정 > 일반 > 로그인 항목에서 끈 경우.
    user_disabled: bool,
    /// serviceManagement | launchAgent. 어떤 방식으로 등록했는지 알려 준다.
    mechanism: String,
    plist_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationPermission {
    /// 시스템 전체 위치 서비스 스위치
    services_enabled: bool,
    /// notDetermined | restricted | denied | authorized | unsupported
    status: String,
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum NativeLocationOutcome {
    Ready { latitude: f64, longitude: f64 },
    Denied { message: String },
    /// 프롬프트가 떠 있고 사용자가 아직 답하지 않은 상태. 자동 재요청을 멈추기 위한 구분이다.
    Pending { message: String },
    Error { message: String },
}

#[cfg(target_os = "macos")]
mod native_location {
    use super::NativeLocationOutcome;
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::mpsc::SyncSender;

    unsafe extern "C" {
        fn tiny_farm_request_location(
            callback: extern "C" fn(f64, f64, i32, *const c_char, *mut c_void),
            context: *mut c_void,
        );
    }

    extern "C" fn receive_location(
        latitude: f64,
        longitude: f64,
        status: i32,
        message: *const c_char,
        context: *mut c_void,
    ) {
        if context.is_null() {
            return;
        }
        // Objective-C guarantees exactly one callback. Reclaim the sender only at that callback.
        let sender = unsafe { Box::from_raw(context.cast::<SyncSender<NativeLocationOutcome>>()) };
        let message = if message.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(message) }.to_string_lossy().into_owned()
        };
        let outcome = match status {
            0 if latitude.is_finite() && longitude.is_finite() => {
                NativeLocationOutcome::Ready { latitude, longitude }
            }
            1 => NativeLocationOutcome::Denied { message },
            3 => NativeLocationOutcome::Pending { message },
            _ => NativeLocationOutcome::Error { message },
        };
        let _ = sender.send(outcome);
    }

    pub fn request(sender: SyncSender<NativeLocationOutcome>) {
        let context = Box::into_raw(Box::new(sender)).cast::<c_void>();
        unsafe { tiny_farm_request_location(receive_location, context) };
    }

    unsafe extern "C" {
        fn tiny_farm_start_authorization_watch(callback: extern "C" fn(i32));
        fn tiny_farm_location_authorization() -> i32;
        fn tiny_farm_location_services_enabled() -> i32;
    }

    /// 권한이 나중에 허용돼도 앱이 그대로 실패 상태로 남지 않도록 변경을 감시한다.
    pub fn watch_authorization(callback: extern "C" fn(i32)) {
        unsafe { tiny_farm_start_authorization_watch(callback) };
    }

    /// 설정 패널에 그대로 보여줄 현재 권한 상태.
    pub fn permission() -> (bool, &'static str) {
        let services_enabled = unsafe { tiny_farm_location_services_enabled() } == 1;
        let status = match unsafe { tiny_farm_location_authorization() } {
            0 => "notDetermined",
            1 => "restricted",
            2 => "denied",
            3 | 4 => "authorized",
            _ => "unknown",
        };
        (services_enabled, status)
    }
}

/// macOS 13+ 의 정식 로그인 항목 등록.
///
/// 자체 LaunchAgent 는 실행 프로그램이 `/usr/bin/open` 이라 시스템 설정의 로그인 항목
/// 목록에 나타나지 않았다. SMAppService 로 앱 자신을 등록하면 목록에 표시되고 사용자가
/// 그 화면에서 끌 수 있다.
#[cfg(target_os = "macos")]
mod login_item {
    use std::ffi::{c_char, CStr};

    unsafe extern "C" {
        fn tiny_farm_login_item_status() -> i32;
        fn tiny_farm_login_item_register(buffer: *mut c_char, capacity: i32) -> i32;
        fn tiny_farm_login_item_unregister(buffer: *mut c_char, capacity: i32) -> i32;
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum Status {
        NotRegistered,
        Enabled,
        RequiresApproval,
        NotFound,
        Unsupported,
    }

    pub fn status() -> Status {
        match unsafe { tiny_farm_login_item_status() } {
            0 => Status::NotRegistered,
            1 => Status::Enabled,
            2 => Status::RequiresApproval,
            3 => Status::NotFound,
            _ => Status::Unsupported,
        }
    }

    fn call(register: bool) -> Result<(), Option<String>> {
        let mut buffer = [0_i8; 512];
        let result = unsafe {
            if register {
                tiny_farm_login_item_register(buffer.as_mut_ptr(), buffer.len() as i32)
            } else {
                tiny_farm_login_item_unregister(buffer.as_mut_ptr(), buffer.len() as i32)
            }
        };
        match result {
            0 => Ok(()),
            -1 => Err(None),
            _ => {
                let message = unsafe { CStr::from_ptr(buffer.as_ptr()) }
                    .to_string_lossy()
                    .into_owned();
                Err(Some(message))
            }
        }
    }

    /// Ok(()) 성공, Err(None) 이 OS 에서 지원하지 않음, Err(Some) 실제 실패.
    pub fn register() -> Result<(), Option<String>> {
        call(true)
    }

    pub fn unregister() -> Result<(), Option<String>> {
        call(false)
    }
}

#[cfg(target_os = "macos")]
static APP_FOR_LOCATION_EVENTS: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// CoreLocation 권한 변화를 본창에 알린다. 프런트는 허용 시 즉시 날씨를 다시 요청한다.
#[cfg(target_os = "macos")]
extern "C" fn on_location_authorization_change(authorized: i32) {
    if let Some(app) = APP_FOR_LOCATION_EVENTS.get() {
        if let Some(main) = app.get_webview_window(MAIN_LABEL) {
            let _ = main.emit("tiny-farm://location-authorization", authorized == 1);
        }
    }
}

/// 농장 상태를 고칠 수 있는 창인지 확인한다.
fn ensure_writer<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() == MAIN_LABEL {
        Ok(())
    } else {
        Err(format!(
            "'{}' 창은 농장 상태를 쓸 수 없다. 쓰기는 본창만 한다",
            window.label()
        ))
    }
}

#[tauri::command]
async fn request_current_location<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<NativeLocationOutcome, String> {
    ensure_writer(&window)?;

    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        use std::time::Duration;

        let (sender, receiver) = mpsc::sync_channel(1);
        native_location::request(sender);
        let result = tauri::async_runtime::spawn_blocking(move || {
            // Objective-C가 25초에 timeout을 내므로 그보다 넉넉하게 기다린다.
            receiver.recv_timeout(Duration::from_secs(28))
        })
        .await
        .map_err(|error| format!("위치 요청 작업 실패: {error}"))?
        .map_err(|error| format!("위치 요청 응답 없음: {error}"))?;
        Ok(result)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(NativeLocationOutcome::Error {
            message: "현재 위치는 macOS 앱에서만 지원됩니다.".to_string(),
        })
    }
}

/// 설정 패널이 보여줄 현재 위치 권한 상태. 좌표는 다루지 않는다.
#[tauri::command]
fn get_location_permission<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<LocationPermission, String> {
    ensure_writer(&window)?;

    #[cfg(target_os = "macos")]
    {
        let (services_enabled, status) = native_location::permission();
        Ok(LocationPermission {
            services_enabled,
            status: status.to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(LocationPermission {
            services_enabled: false,
            status: "unsupported".to_string(),
        })
    }
}

#[cfg(target_os = "macos")]
fn open_settings_pane(target: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(target)
        .status()
        .map_err(|error| format!("시스템 설정을 열지 못했다: {error}"))?;
    if !status.success() {
        return Err("시스템 설정을 열지 못했다".to_string());
    }
    Ok(())
}

/// 시스템 설정의 위치 서비스 창을 연다. 앱 안에서 권한을 켤 수 없는 경우의 안내 경로다.
#[tauri::command]
fn open_location_settings<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    ensure_writer(&window)?;

    #[cfg(target_os = "macos")]
    {
        open_settings_pane(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("이 기능은 macOS에서만 지원된다".to_string())
    }
}

/// 시스템 설정의 로그인 항목 창을 연다. 로그인 실행은 TCC 권한이 아니라 여기서 관리된다.
#[tauri::command]
fn open_login_items_settings<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    ensure_writer(&window)?;

    #[cfg(target_os = "macos")]
    {
        open_settings_pane("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("이 기능은 macOS에서만 지원된다".to_string())
    }
}

fn data_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 경로를 찾을 수 없다: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("앱 데이터 디렉터리를 만들 수 없다: {error}"))?;
    Ok(dir)
}

fn file_path<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(name))
}

fn read_optional(path: &PathBuf) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("파일을 읽을 수 없다: {error}"))
}

/// 임시 파일에 쓰고 이름을 바꿔치기한다. 쓰는 중에 앱이 죽어도 기존 파일이 반쪽짜리로
/// 덮이지 않는다.
fn write_atomic(path: &PathBuf, payload: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, payload).map_err(|error| format!("임시 파일 쓰기 실패: {error}"))?;
    fs::rename(&temp, path).map_err(|error| format!("파일 교체 실패: {error}"))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn autostart_plist_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .home_dir()
        .map_err(|error| format!("홈 디렉터리를 찾을 수 없다: {error}"))?
        .join("Library")
        .join("LaunchAgents");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("LaunchAgents 디렉터리를 만들 수 없다: {error}"))?;
    Ok(directory.join(AUTOSTART_FILE))
}

fn current_app_bundle() -> Result<String, String> {
    let executable = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|error| format!("현재 앱 실행 경로를 찾을 수 없다: {error}"))?;
    let bundle = executable
        .ancestors()
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("app"))
        .ok_or_else(|| "로그인 실행은 macOS .app 번들에서만 설정할 수 있습니다.".to_string())?;
    bundle
        .canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("현재 앱 번들 경로를 확인할 수 없다: {error}"))
}

fn launch_agent_payload(bundle_path: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n\
<dict>\n\
  <key>Label</key>\n\
  <string>{}</string>\n\
  <key>ProgramArguments</key>\n\
  <array>\n\
    <string>/usr/bin/open</string>\n\
    <string>-g</string>\n\
    <string>{}</string>\n\
  </array>\n\
  <key>RunAtLoad</key>\n\
  <true/>\n\
  <key>ProcessType</key>\n\
  <string>Interactive</string>\n\
</dict>\n\
</plist>\n",
        xml_escape(AUTOSTART_LABEL),
        xml_escape(bundle_path),
    )
}

#[cfg(target_os = "macos")]
fn launch_domain() -> Result<String, String> {
    let output = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|error| format!("사용자 ID 확인 실패: {error}"))?;
    if !output.status.success() {
        return Err("사용자 ID를 확인하지 못했다".to_string());
    }
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if uid.is_empty() || !uid.chars().all(|character| character.is_ascii_digit()) {
        return Err("사용자 ID 응답이 올바르지 않다".to_string());
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(target_os = "macos")]
fn launch_agent_loaded() -> Result<bool, String> {
    let domain = launch_domain()?;
    let output = Command::new("/bin/launchctl")
        .args(["print", &format!("{domain}/{AUTOSTART_LABEL}")])
        .output()
        .map_err(|error| format!("LaunchAgent 상태 확인 실행 실패: {error}"))?;
    if output.status.success() {
        return Ok(true);
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.contains("Could not find service") || message.contains("service not found") {
        return Ok(false);
    }
    Err(format!("LaunchAgent 상태 확인 실패: {message}"))
}

#[cfg(not(target_os = "macos"))]
fn launch_agent_loaded() -> Result<bool, String> {
    Ok(false)
}

fn plist_raw_value(path: &PathBuf, key_path: &str) -> Option<String> {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", key_path, "raw"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn launch_agent_matches(path: &PathBuf, bundle_path: &str) -> bool {
    plist_raw_value(path, "Label").as_deref() == Some(AUTOSTART_LABEL)
        && plist_raw_value(path, "ProgramArguments.0").as_deref() == Some("/usr/bin/open")
        && plist_raw_value(path, "ProgramArguments.1").as_deref() == Some("-g")
        && plist_raw_value(path, "ProgramArguments.2").as_deref() == Some(bundle_path)
}

fn install_launch_agent(path: &PathBuf, payload: &str) -> Result<(), String> {
    let temp = path.with_extension("plist.tmp");
    fs::write(&temp, payload).map_err(|error| format!("LaunchAgent 임시 파일 쓰기 실패: {error}"))?;

    let lint = Command::new("/usr/bin/plutil")
        .arg("-lint")
        .arg(&temp)
        .output()
        .map_err(|error| format!("LaunchAgent plist 검사 실패: {error}"))?;
    if !lint.status.success() {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "LaunchAgent plist가 올바르지 않다: {}",
            String::from_utf8_lossy(&lint.stderr).trim()
        ));
    }

    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("LaunchAgent plist 교체 실패: {error}"));
    }
    Ok(())
}

/// 사용자가 로그인 항목에서 껐는지 확인한다. TCC 권한이 아니라 launchd 의 disabled 플래그다.
#[cfg(target_os = "macos")]
fn launch_agent_user_disabled() -> Result<bool, String> {
    let domain = launch_domain()?;
    let output = Command::new("/bin/launchctl")
        .args(["print-disabled", &domain])
        .output()
        .map_err(|error| format!("로그인 항목 상태 확인 실패: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "로그인 항목 상태 확인 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    // 형식: "app.tinyfarm.widget" => disabled
    let needle = format!("\"{AUTOSTART_LABEL}\" =>");
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix(&needle)
                .map(|value| value.trim() == "disabled")
        })
        .unwrap_or(false))
}

#[cfg(not(target_os = "macos"))]
fn launch_agent_user_disabled() -> Result<bool, String> {
    Ok(false)
}

/// 로그인 항목에서 꺼진 상태를 되살린다. 이 플래그가 남아 있으면 bootstrap 해도 실행되지 않는다.
#[cfg(target_os = "macos")]
fn enable_launch_agent_flag() -> Result<(), String> {
    let domain = launch_domain()?;
    let output = Command::new("/bin/launchctl")
        .args(["enable", &format!("{domain}/{AUTOSTART_LABEL}")])
        .output()
        .map_err(|error| format!("로그인 항목 활성화 실행 실패: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "로그인 항목 활성화 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn enable_launch_agent_flag() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn load_launch_agent(path: &PathBuf) -> Result<(), String> {
    let domain = launch_domain()?;
    let output = Command::new("/bin/launchctl")
        .arg("bootstrap")
        .arg(&domain)
        .arg(path)
        .output()
        .map_err(|error| format!("LaunchAgent 등록 실행 실패: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "LaunchAgent 등록 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn load_launch_agent(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn unload_launch_agent() -> Result<(), String> {
    if !launch_agent_loaded()? {
        return Ok(());
    }
    let domain = launch_domain()?;
    let service = format!("{domain}/{AUTOSTART_LABEL}");
    let output = Command::new("/bin/launchctl")
        .args(["bootout", &service])
        .output()
        .map_err(|error| format!("LaunchAgent 해제 실행 실패: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "LaunchAgent 해제 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn unload_launch_agent() -> Result<(), String> {
    Ok(())
}

fn restore_launch_agent(
    path: &PathBuf,
    previous_payload: Option<&str>,
    previous_loaded: bool,
) -> Result<(), String> {
    if launch_agent_loaded()? {
        unload_launch_agent()?;
    }
    match previous_payload {
        Some(payload) => write_atomic(path, payload)?,
        None if path.exists() => {
            fs::remove_file(path).map_err(|error| format!("LaunchAgent 롤백 삭제 실패: {error}"))?;
        }
        None => {}
    }
    if previous_loaded {
        load_launch_agent(path)?;
    }
    Ok(())
}

fn autostart_status<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<AutostartStatus, String> {
    let plist_path = autostart_plist_path(app)?;
    let bundle_path = current_app_bundle()?;
    let file_exists = plist_path.exists();
    let path_matches = file_exists && launch_agent_matches(&plist_path, &bundle_path);
    let user_disabled = launch_agent_user_disabled()?;

    // macOS 13+ 는 SMAppService 상태가 진짜 상태다. 이 경로에서는 LaunchAgent 를 쓰지 않는다.
    #[cfg(target_os = "macos")]
    {
        use login_item::Status;
        let status = login_item::status();
        if status != Status::Unsupported {
            return Ok(AutostartStatus {
                enabled: status == Status::Enabled,
                file_exists,
                path_matches,
                loaded: status == Status::Enabled,
                // 사용자가 시스템 설정에서 끄면 requiresApproval 이 된다.
                user_disabled: status == Status::RequiresApproval,
                mechanism: "serviceManagement".to_string(),
                plist_path: plist_path.to_string_lossy().into_owned(),
            });
        }
    }

    Ok(AutostartStatus {
        // 사용자가 로그인 항목에서 껐으면 파일이 있어도 실제로 실행되지 않으므로 켜진 게 아니다.
        enabled: file_exists && path_matches && !user_disabled,
        file_exists,
        path_matches,
        loaded: launch_agent_loaded()?,
        user_disabled,
        mechanism: "launchAgent".to_string(),
        plist_path: plist_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn get_autostart_status<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<AutostartStatus, String> {
    ensure_writer(&window)?;
    autostart_status(&app)
}

/// 로그인 실행 시도 결과를 앱 데이터 폴더에 남긴다.
///
/// 릴리스 빌드에는 콘솔이 없어서 토글이 실패했을 때 원인을 알 방법이 없다. 사용자가
/// 알림창 문구를 옮겨 적지 않아도 진단할 수 있도록 파일로 남긴다.
fn log_autostart<R: Runtime>(app: &tauri::AppHandle<R>, line: &str) {
    let Ok(path) = file_path(app, "autostart.log") else {
        return;
    };
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    // 파일이 무한히 자라지 않게 뒤쪽만 남긴다.
    if existing.len() > 8_000 {
        existing = existing.split_off(existing.len() - 4_000);
    }
    existing.push_str(&format!("{stamp} {line}\n"));
    let _ = fs::write(&path, existing);
}

/// 프런트가 남기는 진단 한 줄. 릴리스 빌드에는 콘솔이 없어 파일로 받는다.
#[tauri::command]
fn log_ui<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    line: String,
) -> Result<(), String> {
    ensure_writer(&window)?;
    log_autostart(&app, &format!("ui {line}"));
    Ok(())
}

#[tauri::command]
fn set_autostart<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    enabled: bool,
) -> Result<AutostartStatus, String> {
    ensure_writer(&window)?;
    apply_autostart(&app, enabled)
}

/// 로그인 실행 등록/해제의 실제 구현. 자체 점검에서도 같은 경로를 쓴다.
fn apply_autostart<R: Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<AutostartStatus, String> {
    let app = app.clone();
    let plist_path = autostart_plist_path(&app)?;
    log_autostart(&app, &format!("request enabled={enabled}"));

    // macOS 13+ 는 정식 API 로 등록한다. 그래야 시스템 설정 로그인 항목 목록에 나타난다.
    #[cfg(target_os = "macos")]
    {
        let outcome = if enabled {
            login_item::register()
        } else {
            login_item::unregister()
        };
        match outcome {
            Ok(()) => {
                // 정식 API 로 옮겼으니 과거에 만들어 둔 LaunchAgent 는 정리한다.
                let _ = unload_launch_agent();
                if plist_path.exists() {
                    let _ = fs::remove_file(&plist_path);
                }
                let status = autostart_status(&app)?;
                log_autostart(
                    &app,
                    &format!(
                        "serviceManagement {} enabled={} approval_needed={}",
                        if enabled { "register" } else { "unregister" },
                        status.enabled,
                        status.user_disabled
                    ),
                );
                if enabled && !status.enabled {
                    return Err(if status.user_disabled {
                        "로그인 항목에 추가했지만 사용자 승인이 필요합니다. 시스템 설정 > 일반 > 로그인 항목에서 Tiny Farm을 켜 주세요.".to_string()
                    } else {
                        "로그인 항목 등록 상태를 확인하지 못했습니다.".to_string()
                    });
                }
                return Ok(status);
            }
            Err(Some(message)) => {
                log_autostart(&app, &format!("serviceManagement failed: {message}"));
                return Err(format!("로그인 항목 등록 실패: {message}"));
            }
            // 이 macOS 는 정식 API 가 없다. 아래 LaunchAgent 방식으로 진행한다.
            Err(None) => log_autostart(&app, "serviceManagement unsupported, fallback"),
        }
    }

    if enabled {
        let bundle_path = current_app_bundle()?;
        let previous_payload = if plist_path.exists() {
            Some(
                fs::read_to_string(&plist_path)
                    .map_err(|error| format!("기존 LaunchAgent 읽기 실패: {error}"))?,
            )
        } else {
            None
        };
        let previous_loaded = launch_agent_loaded()?;

        let result = (|| -> Result<AutostartStatus, String> {
            install_launch_agent(&plist_path, &launch_agent_payload(&bundle_path))?;
            if !launch_agent_matches(&plist_path, &bundle_path) {
                return Err("설치한 LaunchAgent의 label 또는 앱 경로가 일치하지 않습니다.".to_string());
            }
            if previous_loaded {
                unload_launch_agent()?;
            }
            // 사용자가 로그인 항목에서 껐던 경우 플래그를 먼저 되살린다.
            if launch_agent_user_disabled()? {
                enable_launch_agent_flag()?;
            }
            load_launch_agent(&plist_path)?;
            let status = autostart_status(&app)?;
            if !status.enabled || !status.loaded {
                return Err(format!(
                    "LaunchAgent 등록 검증 실패 (등록: {}, 로드: {})",
                    status.enabled, status.loaded
                ));
            }
            Ok(status)
        })();

        return match result {
            Ok(status) => {
                log_autostart(
                    &app,
                    &format!(
                        "enable ok enabled={} loaded={} path={}",
                        status.enabled, status.loaded, status.plist_path
                    ),
                );
                Ok(status)
            }
            Err(error) => {
                log_autostart(&app, &format!("enable failed: {error}"));
                match restore_launch_agent(
                    &plist_path,
                    previous_payload.as_deref(),
                    previous_loaded,
                ) {
                    Ok(()) => Err(format!("{error} 기존 LaunchAgent 상태로 복구했습니다.")),
                    Err(rollback_error) => {
                        log_autostart(&app, &format!("enable rollback failed: {rollback_error}"));
                        Err(format!("{error} 롤백 실패: {rollback_error}"))
                    }
                }
            }
        };
    }

    let previous_payload = if plist_path.exists() {
        Some(
            fs::read_to_string(&plist_path)
                .map_err(|error| format!("기존 LaunchAgent 읽기 실패: {error}"))?,
        )
    } else {
        None
    };
    let previous_loaded = launch_agent_loaded()?;
    let result = (|| -> Result<AutostartStatus, String> {
        unload_launch_agent()?;
        if plist_path.exists() {
            fs::remove_file(&plist_path)
                .map_err(|error| format!("LaunchAgent 삭제 실패: {error}"))?;
        }

        let status = autostart_status(&app)?;
        if status.enabled || status.loaded {
            return Err(format!(
                "LaunchAgent 해제 검증 실패 (등록: {}, 로드: {})",
                status.enabled, status.loaded
            ));
        }
        Ok(status)
    })();

    match result {
        Ok(status) => {
            log_autostart(&app, "disable ok");
            Ok(status)
        }
        Err(error) => {
            log_autostart(&app, &format!("disable failed: {error}"));
            match restore_launch_agent(&plist_path, previous_payload.as_deref(), previous_loaded) {
                Ok(()) => Err(format!("{error} 기존 LaunchAgent 상태로 복구했습니다.")),
                Err(rollback_error) => {
                    log_autostart(&app, &format!("disable rollback failed: {rollback_error}"));
                    Err(format!("{error} 롤백 실패: {rollback_error}"))
                }
            }
        }
    }
}

#[tauri::command]
fn load_state<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    read_optional(&file_path(&app, STATE_FILE)?)
}

#[tauri::command]
fn save_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    payload: String,
) -> Result<(), String> {
    ensure_writer(&window)?;
    write_atomic(&file_path(&app, STATE_FILE)?, &payload)
}

/// 파일명에 넣어도 안전한 문자만 남긴다.
///
/// suffix 는 프런트엔드가 주는 값이라 그대로 경로에 붙이면 `../` 로 앱 데이터 밖의
/// 파일을 건드릴 수 있다. 영숫자와 하이픈만 통과시키고 길이도 자른다.
fn sanitize_suffix(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "backup".to_string()
    } else {
        cleaned
    }
}

/// 기존 저장본을 백업으로 옮긴다. 옮길 파일이 없으면 None.
///
/// 방치형은 쌓인 시간이 전부라, 스키마가 안 맞는다고 그냥 버리면 되돌릴 방법이 없다.
/// 그래서 버리는 모든 경로가 이 명령을 먼저 지나가게 한다.
#[tauri::command]
fn archive_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    suffix: String,
) -> Result<Option<String>, String> {
    ensure_writer(&window)?;
    let path = file_path(&app, STATE_FILE)?;
    if !path.exists() {
        return Ok(None);
    }
    let backup = path.with_file_name(format!("state.{}.bak", sanitize_suffix(&suffix)));
    fs::rename(&path, &backup).map_err(|error| format!("백업 이동 실패: {error}"))?;
    Ok(Some(backup.to_string_lossy().to_string()))
}

/// 기존 농장을 백업하고 새 농장을 원자적으로 저장한다.
/// 새 상태 쓰기가 실패하면 백업을 즉시 활성 state.json으로 되돌린다.
#[tauri::command]
fn reset_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    suffix: String,
    payload: String,
) -> Result<Option<String>, String> {
    ensure_writer(&window)?;
    let path = file_path(&app, STATE_FILE)?;
    let backup = if path.exists() {
        let backup = path.with_file_name(format!("state.{}.bak", sanitize_suffix(&suffix)));
        fs::rename(&path, &backup).map_err(|error| format!("백업 이동 실패: {error}"))?;
        Some(backup)
    } else {
        None
    };

    if let Err(write_error) = write_atomic(&path, &payload) {
        let _ = fs::remove_file(path.with_extension("tmp"));
        if let Some(backup_path) = &backup {
            fs::rename(backup_path, &path).map_err(|restore_error| {
                format!(
                    "새 농장 저장 실패: {write_error}; 기존 농장 복구도 실패: {restore_error}"
                )
            })?;
        }
        return Err(format!(
            "새 농장 저장 실패: {write_error}; 기존 농장을 복구했습니다."
        ));
    }

    Ok(backup.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    read_optional(&file_path(&app, SETTINGS_FILE)?)
}

#[tauri::command]
fn save_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    payload: String,
) -> Result<(), String> {
    ensure_writer(&window)?;
    write_atomic(&file_path(&app, SETTINGS_FILE)?, &payload)
}

/// 농장 데이터가 들어 있는 폴더 경로. 설정 패널에서 안내하거나 사용자가 백업할 때 쓴다.
#[tauri::command]
fn data_directory<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

fn window_of<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("'{label}' 창을 찾을 수 없다"))
}

/// 메인과 미니 중 하나를 표시하고 반대 창은 반드시 숨긴다.
///
/// 반대 창을 먼저 숨겨 두 창이 동시에 보이는 프레임을 만들지 않는다. 대상 표시가
/// 실패하면 원래 보이던 창을 복원해 둘 다 사라지는 상황도 막는다.
fn show_exclusive<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> Result<(), String> {
    let target = window_of(app, label)?;
    let other_label = match label {
        MAIN_LABEL => Some(MINI_LABEL),
        MINI_LABEL => Some(MAIN_LABEL),
        _ => None,
    };

    let mut hidden_other: Option<WebviewWindow<R>> = None;
    if let Some(other_label) = other_label {
        if let Some(other) = app.get_webview_window(other_label) {
            let was_visible = other.is_visible().map_err(|error| error.to_string())?;
            if was_visible {
                other.hide().map_err(|error| error.to_string())?;
                hidden_other = Some(other);
            }
        }
    }

    if let Err(error) = target.show() {
        if let Some(other) = hidden_other {
            let _ = other.show();
        }
        return Err(error.to_string());
    }

    if label == MAIN_LABEL {
        target.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_window<R: Runtime>(app: tauri::AppHandle<R>, label: String) -> Result<(), String> {
    show_exclusive(&app, &label)
}

#[tauri::command]
fn hide_window<R: Runtime>(app: tauri::AppHandle<R>, label: String) -> Result<(), String> {
    window_of(&app, &label)?
        .hide()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn is_window_visible<R: Runtime>(app: tauri::AppHandle<R>, label: String) -> Result<bool, String> {
    window_of(&app, &label)?
        .is_visible()
        .map_err(|error| error.to_string())
}

/// 배율이 바뀌면 창 크기를 논리 해상도 x 배율로 다시 맞춘다.
#[tauri::command]
fn set_window_size<R: Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window_of(&app, &label)?
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_always_on_top<R: Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
    value: bool,
) -> Result<(), String> {
    window_of(&app, &label)?
        .set_always_on_top(value)
        .map_err(|error| error.to_string())
}

fn setup_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, "open-main", "농장 열기", true, None::<&str>)?;
    let open_mini = MenuItem::with_id(app, "open-mini", "미니 위젯 보이기", true, None::<&str>)?;
    let hide_all = MenuItem::with_id(app, "hide-all", "모두 숨기기", true, None::<&str>)?;
    // 초기화는 트레이에만 둔다. 본 화면에 두면 실수로 누를 수 있다.
    let reset = MenuItem::with_id(app, "reset", "농장 초기화 (백업 후)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_main, &open_mini, &hide_all, &reset, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Tiny Farm")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-main" => {
                let _ = show_exclusive(app, MAIN_LABEL);
            }
            "open-mini" => {
                let _ = show_exclusive(app, MINI_LABEL);
            }
            "hide-all" => {
                for label in [MAIN_LABEL, MINI_LABEL] {
                    if let Some(window) = app.get_webview_window(label) {
                        let _ = window.hide();
                    }
                }
            }
            "reset" => {
                // 실제 초기화는 본창이 한다. 먼저 배타적으로 본창으로 전환해 결과를 보인다.
                let _ = show_exclusive(app, MAIN_LABEL);
                let _ = app.emit("tiny-farm://reset", ());
            }
            "quit" => app.exit(0),
            _ => {}
        });

    // 전용 트레이 아이콘이 준비되기 전까지는 앱 아이콘을 그대로 쓴다.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// 본창 닫기를 종료가 아니라 숨김으로 바꾼다.
///
/// 미니로 넘길지는 여기서 정하지 않는다. 그 판단에 필요한 설정을 아는 쪽이 프런트엔드라
/// 이벤트만 보내고, 본창 웹뷰가 살아 있는 상태로 결정한다.
fn hook_close_to_hide<R: Runtime>(window: &WebviewWindow<R>) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
            let _ = handle.emit("tiny-farm://main-hidden", ());
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 중복 실행 차단. 두 벌이 돌면 농장 시계가 두 번 흐르고 같은 state.json 을 서로
        // 덮어쓴다. 두 번째 실행은 즉시 끝나고, 이미 떠 있는 쪽의 본창을 앞으로 가져온다.
        // 플러그인 문서대로 가장 먼저 등록한다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = show_exclusive(app, MAIN_LABEL);
        }))
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            archive_state,
            reset_state,
            load_settings,
            save_settings,
            get_autostart_status,
            set_autostart,
            request_current_location,
            log_ui,
            get_location_permission,
            open_location_settings,
            open_login_items_settings,
            data_directory,
            show_window,
            hide_window,
            is_window_visible,
            set_window_size,
            set_always_on_top
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Dock 에서 감춘다. 데스크테리어 위젯이 Dock 을 차지할 이유가 없고 트레이로
            // 접근한다.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(main) = app.get_webview_window(MAIN_LABEL) {
                hook_close_to_hide(&main);
            }

            // 사용자가 프롬프트나 시스템 설정에서 나중에 허용하는 경우를 위해 감시를 건다.
            #[cfg(target_os = "macos")]
            {
                let _ = APP_FOR_LOCATION_EVENTS.set(app.handle().clone());
                native_location::watch_authorization(on_location_authorization_change);
            }

            // UI 클릭 없이 로그인 실행 경로를 검증하기 위한 점검 통로.
            // 평소에는 실행되지 않고, 환경 변수를 준 실행에서만 동작한다.
            let selftest = std::env::var("TINY_FARM_SELFTEST").unwrap_or_default();
            if selftest.starts_with("autostart") {
                let handle = app.handle().clone();
                // autostart: 켜고 끄기까지, autostart-on: 켜기만, autostart-off: 끄기만.
                let mode = selftest.clone();
                std::thread::spawn(move || {
                    log_autostart(&handle, &format!("selftest start mode={mode}"));
                    let do_enable = mode != "autostart-off";
                    let do_disable = mode == "autostart" || mode == "autostart-off";

                    if do_enable {
                        match apply_autostart(&handle, true) {
                            Ok(status) => log_autostart(
                                &handle,
                                &format!(
                                    "selftest enable ok enabled={} loaded={} disabled={} mechanism={}",
                                    status.enabled,
                                    status.loaded,
                                    status.user_disabled,
                                    status.mechanism
                                ),
                            ),
                            Err(error) => {
                                log_autostart(&handle, &format!("selftest enable error: {error}"))
                            }
                        }
                    }

                    if do_disable {
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        match apply_autostart(&handle, false) {
                            Ok(status) => log_autostart(
                                &handle,
                                &format!(
                                    "selftest disable ok enabled={} loaded={}",
                                    status.enabled, status.loaded
                                ),
                            ),
                            Err(error) => {
                                log_autostart(&handle, &format!("selftest disable error: {error}"))
                            }
                        }
                    }
                    log_autostart(&handle, "selftest done");
                });
            }

            setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
