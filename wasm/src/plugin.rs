use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value, json};
use tes3::esp::{
    Activator, Alchemy, Apparatus, Book, Container, Door, Ingredient, Light, Lockpick, MiscItem,
    ObjectFlags, Plugin, Probe, RepairItem, Static, TES3Object, TypeInfo, Weapon,
};

const LIBRARY_TAGS: [[u8; 4]; 15] = [
    *b"TES3", *b"STAT", *b"ACTI", *b"DOOR", *b"CONT", *b"LIGH", *b"MISC", *b"WEAP", *b"APPA",
    *b"LOCK", *b"PROB", *b"INGR", *b"BOOK", *b"ALCH", *b"REPA",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPacket {
    pub parser_version: String,
    pub masters: Vec<PluginMaster>,
    pub records: Vec<PluginRecord>,
    pub stats: PluginStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMaster {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub mesh: Option<String>,
    pub icon: Option<String>,
    pub deleted: bool,
    pub raw: Value,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStats {
    pub total_records: usize,
    pub library_records: usize,
    pub mesh_records: usize,
    pub unique_meshes: usize,
    pub record_counts: BTreeMap<String, usize>,
}

pub fn parse_plugin_packet(bytes: &[u8]) -> Result<PluginPacket, String> {
    let mut plugin = Plugin::new();
    plugin
        .load_bytes_filtered(bytes, |tag| LIBRARY_TAGS.contains(&tag))
        .map_err(|error| format!("TES3 plugin parse failed: {error}"))?;
    if plugin.header().is_none() {
        return Err("TES3 plugin parse failed: missing TES3 header".to_owned());
    }

    let masters = plugin
        .header()
        .map(|header| {
            header
                .masters
                .iter()
                .map(|(name, size)| PluginMaster {
                    name: name.clone(),
                    size: *size,
                })
                .collect()
        })
        .unwrap_or_default();

    let mut record_counts = BTreeMap::new();
    let mut records = Vec::new();
    for object in &plugin.objects {
        *record_counts
            .entry(object.tag_str().to_owned())
            .or_insert(0) += 1;
        match object {
            TES3Object::Static(value) => records.push(static_record(value)),
            TES3Object::Activator(value) => records.push(activator_record(value)),
            TES3Object::Door(value) => records.push(door_record(value)),
            TES3Object::Container(value) => records.push(container_record(value)),
            TES3Object::Light(value) => records.push(light_record(value)),
            TES3Object::MiscItem(value) => records.push(misc_record(value)),
            TES3Object::Weapon(value) => records.push(weapon_record(value)),
            TES3Object::Apparatus(value) => records.push(apparatus_record(value)),
            TES3Object::Lockpick(value) => records.push(lockpick_record(value)),
            TES3Object::Probe(value) => records.push(probe_record(value)),
            TES3Object::Ingredient(value) => records.push(ingredient_record(value)),
            TES3Object::Book(value) => records.push(book_record(value)),
            TES3Object::Alchemy(value) => records.push(alchemy_record(value)),
            TES3Object::RepairItem(value) => records.push(repair_record(value)),
            _ => {}
        }
    }

    let unique_meshes = records
        .iter()
        .filter_map(|record| record.mesh.as_deref())
        .map(str::to_ascii_lowercase)
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let total_records = record_counts.values().sum();
    let stats = PluginStats {
        total_records,
        library_records: records.len(),
        mesh_records: records
            .iter()
            .filter(|record| record.mesh.is_some())
            .count(),
        unique_meshes,
        record_counts,
    };

    Ok(PluginPacket {
        parser_version: env!("CARGO_PKG_VERSION").to_owned(),
        masters,
        records,
        stats,
    })
}

fn record(
    id: &str,
    record_type: &str,
    name: &str,
    mesh: &str,
    icon: &str,
    flags: ObjectFlags,
    raw: Map<String, Value>,
) -> PluginRecord {
    PluginRecord {
        id: id.to_owned(),
        record_type: record_type.to_owned(),
        name: name.to_owned(),
        mesh: non_empty(mesh),
        icon: non_empty(icon),
        deleted: flags.contains(ObjectFlags::DELETED),
        raw: Value::Object(raw),
    }
}

fn non_empty(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_owned())
}

fn common_raw(script: &str) -> Map<String, Value> {
    let mut raw = Map::new();
    if !script.is_empty() {
        raw.insert("script".to_owned(), json!(script));
    }
    raw
}

fn static_record(value: &Static) -> PluginRecord {
    record(
        &value.id,
        "Static",
        "",
        &value.mesh,
        "",
        value.flags,
        Map::new(),
    )
}

fn activator_record(value: &Activator) -> PluginRecord {
    record(
        &value.id,
        "Activator",
        &value.name,
        &value.mesh,
        "",
        value.flags,
        common_raw(&value.script),
    )
}

fn door_record(value: &Door) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("openSound".to_owned(), json!(value.open_sound));
    raw.insert("closeSound".to_owned(), json!(value.close_sound));
    record(
        &value.id,
        "Door",
        &value.name,
        &value.mesh,
        "",
        value.flags,
        raw,
    )
}

fn container_record(value: &Container) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("encumbrance".to_owned(), json!(value.encumbrance));
    raw.insert(
        "contents".to_owned(),
        json!(
            value
                .inventory
                .iter()
                .map(|(count, id)| json!({
                    "id": id.to_string(), "count": count
                }))
                .collect::<Vec<_>>()
        ),
    );
    record(
        &value.id,
        "Container",
        &value.name,
        &value.mesh,
        "",
        value.flags,
        raw,
    )
}

fn light_record(value: &Light) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("duration".to_owned(), json!(value.data.time));
    raw.insert("radius".to_owned(), json!(value.data.radius));
    raw.insert("color".to_owned(), json!(value.data.color));
    raw.insert("sound".to_owned(), json!(value.sound));
    record(
        &value.id,
        "Light",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn misc_record(value: &MiscItem) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    record(
        &value.id,
        "Misc Item",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn weapon_record(value: &Weapon) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("health".to_owned(), json!(value.data.health));
    raw.insert("speed".to_owned(), json!(value.data.speed));
    raw.insert("reach".to_owned(), json!(value.data.reach));
    raw.insert("enchanting".to_owned(), json!(value.enchanting));
    raw.insert(
        "damage".to_owned(),
        json!({
            "chop": [value.data.chop_min, value.data.chop_max],
            "slash": [value.data.slash_min, value.data.slash_max],
            "thrust": [value.data.thrust_min, value.data.thrust_max]
        }),
    );
    record(
        &value.id,
        "Weapon",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn apparatus_record(value: &Apparatus) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("quality".to_owned(), json!(value.data.quality));
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    record(
        &value.id,
        "Apparatus",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn lockpick_record(value: &Lockpick) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("quality".to_owned(), json!(value.data.quality));
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("uses".to_owned(), json!(value.data.uses));
    record(
        &value.id,
        "Lockpick",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn probe_record(value: &Probe) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("quality".to_owned(), json!(value.data.quality));
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("uses".to_owned(), json!(value.data.uses));
    record(
        &value.id,
        "Probe",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn ingredient_record(value: &Ingredient) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert(
        "effects".to_owned(),
        json!(value.data.effects.map(|effect| effect as i32)),
    );
    record(
        &value.id,
        "Ingredient",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn book_record(value: &Book) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("text".to_owned(), json!(value.text));
    raw.insert("enchanting".to_owned(), json!(value.enchanting));
    record(
        &value.id,
        "Book",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn alchemy_record(value: &Alchemy) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("effectCount".to_owned(), json!(value.effects.len()));
    record(
        &value.id,
        "Alchemy",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn repair_record(value: &RepairItem) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("quality".to_owned(), json!(value.data.quality));
    raw.insert("weight".to_owned(), json!(value.data.weight));
    raw.insert("value".to_owned(), json!(value.data.value));
    raw.insert("uses".to_owned(), json!(value.data.uses));
    record(
        &value.id,
        "Repair Item",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tes3::esp::Header;

    #[test]
    fn extracts_library_records_and_masters_without_cell_data() {
        let header = Header {
            masters: vec![("Morrowind.esm".to_owned(), 1_073_741_824)],
            ..Default::default()
        };
        let static_object = Static {
            id: "oaab_test".to_owned(),
            mesh: "oaab\\f\\test.nif".to_owned(),
            ..Default::default()
        };
        let mut plugin = Plugin {
            objects: vec![header.into(), static_object.into()],
        };
        let bytes = plugin.save_bytes().expect("serialize fixture plugin");
        let packet = parse_plugin_packet(&bytes).expect("parse fixture plugin");

        assert_eq!(packet.masters[0].name, "Morrowind.esm");
        assert_eq!(packet.records.len(), 1);
        assert_eq!(packet.records[0].id, "oaab_test");
        assert_eq!(packet.records[0].mesh.as_deref(), Some("oaab\\f\\test.nif"));
    }

    #[test]
    fn invalid_plugin_returns_a_diagnostic_error() {
        let error = parse_plugin_packet(b"not a plugin").unwrap_err();
        assert!(error.contains("TES3 plugin parse failed") || error.contains("records"));
    }
}
