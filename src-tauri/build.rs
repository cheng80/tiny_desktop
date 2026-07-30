fn main() {
  #[cfg(target_os = "macos")]
  {
    cc::Build::new()
      .file("src/location.m")
      .file("src/loginitem.m")
      .flag("-fobjc-arc")
      .compile("tiny_farm_native");
    println!("cargo:rustc-link-lib=framework=CoreLocation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=ServiceManagement");
    println!("cargo:rerun-if-changed=src/location.m");
    println!("cargo:rerun-if-changed=src/loginitem.m");
  }

  tauri_build::build()
}
