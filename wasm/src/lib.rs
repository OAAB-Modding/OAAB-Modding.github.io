mod nif;
mod plugin;

use wasm_bindgen::prelude::*;

pub use nif::{RenderPacket, parse_nif_packet, parse_nif_packet_with_animation};
pub use plugin::{PluginPacket, parse_plugin_packet};

const PARSER_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "+tes3-bf6aa1a");

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn parser_version() -> String {
    PARSER_VERSION.to_owned()
}

/// Parse a NetImmerse 4.0.0.2 file into the compact render packet consumed by
/// the Library worker. JSON crosses the WASM boundary once; the worker converts
/// numeric arrays into transferable TypedArrays before messaging the UI.
#[wasm_bindgen]
pub fn parse_nif(bytes: &[u8]) -> Result<String, JsValue> {
    let packet = parse_nif_packet(bytes).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&packet).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Parse a model and its optional external keyframe stream, apply a canonical
/// idle/start pose, then let TES3 bake all skin deformation before serialization.
#[wasm_bindgen]
pub fn parse_nif_with_animation(bytes: &[u8], animation_bytes: &[u8]) -> Result<String, JsValue> {
    let packet = parse_nif_packet_with_animation(
        bytes,
        (!animation_bytes.is_empty()).then_some(animation_bytes),
    )
    .map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&packet).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Parse a TES3 ESP/ESM into the source-neutral object records consumed by the
/// Library. The worker owns the input buffer so plugin bytes never leave
/// the browser or cross the main thread more than once.
#[wasm_bindgen]
pub fn parse_plugin(bytes: &[u8]) -> Result<String, JsValue> {
    let packet = parse_plugin_packet(bytes).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&packet).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_nif_returns_a_diagnostic_error() {
        let error = parse_nif_packet(b"not a nif").unwrap_err();
        assert!(error.contains("NIF parse failed"));
    }
}
