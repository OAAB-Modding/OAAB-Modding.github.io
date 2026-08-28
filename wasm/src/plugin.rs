use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value, json};
use tes3::esp::{
    Activator, Alchemy, Apparatus, Armor, Bodypart, Book, Clothing, Container, Creature, Door,
    Effect, Enchanting, Ingredient, LeveledCreature, LeveledItem, Light, Lockpick, MiscItem,
    ObjectFlags, Plugin, Probe, RepairItem, Spell, Static, TES3Object, TypeInfo, Weapon,
};

const LIBRARY_TAGS: [[u8; 4]; 23] = [
    *b"TES3", *b"STAT", *b"ACTI", *b"DOOR", *b"CONT", *b"LIGH", *b"MISC", *b"WEAP", *b"APPA",
    *b"LOCK", *b"PROB", *b"INGR", *b"BOOK", *b"ALCH", *b"REPA", *b"ARMO", *b"BODY", *b"CLOT",
    *b"CREA", *b"SPEL", *b"ENCH", *b"LEVI", *b"LEVC",
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
            TES3Object::Armor(value) => records.push(armor_record(value)),
            TES3Object::Bodypart(value) => records.push(bodypart_record(value)),
            TES3Object::Clothing(value) => records.push(clothing_record(value)),
            TES3Object::Creature(value) => records.push(creature_record(value)),
            TES3Object::Spell(value) => records.push(spell_record(value)),
            TES3Object::Enchanting(value) => records.push(enchanting_record(value)),
            TES3Object::LeveledItem(value) => records.push(leveled_item_record(value)),
            TES3Object::LeveledCreature(value) => records.push(leveled_creature_record(value)),
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

fn enum_name(value: impl std::fmt::Debug) -> String {
    format!("{value:?}")
}

fn flags_name(value: impl std::fmt::Debug) -> String {
    let debug = format!("{value:?}");
    debug
        .split_once('(')
        .and_then(|(_, rest)| rest.strip_suffix(')'))
        .filter(|inner| *inner != "0x0")
        .unwrap_or("")
        .to_owned()
}

fn magic_effects(effects: &[Effect]) -> Vec<Value> {
    effects
        .iter()
        .map(|effect| {
            json!({
                "magic_effect": enum_name(effect.magic_effect),
                "skill": enum_name(effect.skill),
                "attribute": enum_name(effect.attribute),
                "range": enum_name(effect.range),
                "area": effect.area,
                "duration": effect.duration,
                "min_magnitude": effect.min_magnitude,
                "max_magnitude": effect.max_magnitude,
            })
        })
        .collect()
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
    raw.insert("sound".to_owned(), json!(value.sound));
    raw.insert(
        "data".to_owned(),
        json!({
            "weight": value.data.weight,
            "value": value.data.value,
            "time": value.data.time,
            "radius": value.data.radius,
            "color": value.data.color,
            "flags": flags_name(value.data.flags),
        }),
    );
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
    raw.insert(
        "data".to_owned(),
        json!({
            "weight": value.data.weight,
            "value": value.data.value,
            "effects": value.data.effects.map(enum_name),
            "skills": value.data.skills.map(enum_name),
            "attributes": value.data.attributes.map(enum_name),
        }),
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
    raw.insert("text".to_owned(), json!(value.text));
    raw.insert("enchanting".to_owned(), json!(value.enchanting));
    raw.insert(
        "data".to_owned(),
        json!({
            "weight": value.data.weight,
            "value": value.data.value,
            "book_type": enum_name(value.data.book_type),
            "skill": enum_name(value.data.skill),
            "enchantment": value.data.enchantment,
        }),
    );
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
    raw.insert("effects".to_owned(), json!(magic_effects(&value.effects)));
    raw.insert(
        "data".to_owned(),
        json!({
            "weight": value.data.weight,
            "value": value.data.value,
            "flags": flags_name(value.data.flags),
        }),
    );
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

fn armor_record(value: &Armor) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("enchanting".to_owned(), json!(value.enchanting));
    raw.insert(
        "data".to_owned(),
        json!({
            "armor_type": enum_name(value.data.armor_type),
            "weight": value.data.weight,
            "value": value.data.value,
            "health": value.data.health,
            "enchantment": value.data.enchantment,
            "armor_rating": value.data.armor_rating,
        }),
    );
    record(
        &value.id,
        "Armor",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn bodypart_record(value: &Bodypart) -> PluginRecord {
    let mut raw = Map::new();
    raw.insert("race".to_owned(), json!(value.race));
    raw.insert(
        "data".to_owned(),
        json!({
            "part": enum_name(value.data.part),
            "vampire": value.data.vampire,
            "flags": flags_name(value.data.flags),
            "bodypart_type": enum_name(value.data.bodypart_type),
        }),
    );
    record(&value.id, "Bodypart", "", &value.mesh, "", value.flags, raw)
}

fn clothing_record(value: &Clothing) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert("enchanting".to_owned(), json!(value.enchanting));
    raw.insert(
        "data".to_owned(),
        json!({
            "clothing_type": enum_name(value.data.clothing_type),
            "weight": value.data.weight,
            "value": value.data.value,
            "enchantment": value.data.enchantment,
        }),
    );
    record(
        &value.id,
        "Clothing",
        &value.name,
        &value.mesh,
        &value.icon,
        value.flags,
        raw,
    )
}

fn creature_record(value: &Creature) -> PluginRecord {
    let mut raw = common_raw(&value.script);
    raw.insert(
        "inventory".to_owned(),
        json!(
            value
                .inventory
                .iter()
                .map(|(count, id)| json!([count, id.to_string()]))
                .collect::<Vec<_>>()
        ),
    );
    raw.insert("spells".to_owned(), json!(value.spells));
    raw.insert("sound".to_owned(), json!(value.sound));
    if let Some(scale) = value.scale {
        raw.insert("scale".to_owned(), json!(scale));
    }
    raw.insert(
        "creature_flags".to_owned(),
        json!(flags_name(value.creature_flags)),
    );
    raw.insert("blood_type".to_owned(), json!(value.blood_type));
    raw.insert(
        "data".to_owned(),
        json!({
            "creature_type": enum_name(value.data.creature_type),
            "level": value.data.level,
            "strength": value.data.strength,
            "intelligence": value.data.intelligence,
            "willpower": value.data.willpower,
            "agility": value.data.agility,
            "speed": value.data.speed,
            "endurance": value.data.endurance,
            "personality": value.data.personality,
            "luck": value.data.luck,
            "health": value.data.health,
            "magicka": value.data.magicka,
            "fatigue": value.data.fatigue,
            "soul": value.data.soul,
            "combat": value.data.combat,
            "magic": value.data.magic,
            "stealth": value.data.stealth,
            "attack1": value.data.attack1,
            "attack2": value.data.attack2,
            "attack3": value.data.attack3,
            "gold": value.data.gold,
        }),
    );
    record(
        &value.id,
        "Creature",
        &value.name,
        &value.mesh,
        "",
        value.flags,
        raw,
    )
}

fn spell_record(value: &Spell) -> PluginRecord {
    let mut raw = Map::new();
    raw.insert("effects".to_owned(), json!(magic_effects(&value.effects)));
    raw.insert(
        "data".to_owned(),
        json!({
            "spell_type": enum_name(value.data.spell_type),
            "cost": value.data.cost,
            "flags": flags_name(value.data.flags),
        }),
    );
    record(&value.id, "Spell", &value.name, "", "", value.flags, raw)
}

fn enchanting_record(value: &Enchanting) -> PluginRecord {
    let mut raw = Map::new();
    raw.insert("effects".to_owned(), json!(magic_effects(&value.effects)));
    raw.insert(
        "data".to_owned(),
        json!({
            "enchant_type": enum_name(value.data.enchant_type),
            "cost": value.data.cost,
            "max_charge": value.data.max_charge,
            "flags": flags_name(value.data.flags),
        }),
    );
    record(&value.id, "Enchanting", "", "", "", value.flags, raw)
}

fn leveled_item_record(value: &LeveledItem) -> PluginRecord {
    let mut raw = Map::new();
    raw.insert(
        "leveled_item_flags".to_owned(),
        json!(flags_name(value.leveled_item_flags)),
    );
    raw.insert("chance_none".to_owned(), json!(value.chance_none));
    raw.insert("items".to_owned(), json!(value.items));
    record(&value.id, "LeveledItem", "", "", "", value.flags, raw)
}

fn leveled_creature_record(value: &LeveledCreature) -> PluginRecord {
    let mut raw = Map::new();
    raw.insert(
        "leveled_creature_flags".to_owned(),
        json!(flags_name(value.leveled_creature_flags)),
    );
    raw.insert("chance_none".to_owned(), json!(value.chance_none));
    raw.insert("creatures".to_owned(), json!(value.creatures));
    record(&value.id, "LeveledCreature", "", "", "", value.flags, raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tes3::esp::{EffectId2, Header};

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

    #[test]
    fn extracts_extended_library_records_and_magic_metadata() {
        let effect = Effect {
            magic_effect: EffectId2::FireDamage,
            duration: 5,
            min_magnitude: 2,
            max_magnitude: 4,
            ..Default::default()
        };
        let armor = Armor {
            id: "armor_test".to_owned(),
            name: "Test Armor".to_owned(),
            mesh: "a\\test.nif".to_owned(),
            enchanting: "enchant_test".to_owned(),
            ..Default::default()
        };
        let bodypart = Bodypart {
            id: "body_test".to_owned(),
            mesh: "b\\test.nif".to_owned(),
            ..Default::default()
        };
        let clothing = Clothing {
            id: "clothing_test".to_owned(),
            name: "Test Clothing".to_owned(),
            mesh: "c\\test.nif".to_owned(),
            enchanting: "enchant_test".to_owned(),
            ..Default::default()
        };
        let leveled_item = LeveledItem {
            id: "items_test".to_owned(),
            items: vec![("armor_test".to_owned(), 1)],
            ..Default::default()
        };
        let leveled_creature = LeveledCreature {
            id: "creatures_test".to_owned(),
            creatures: vec![("creature_test".to_owned(), 2)],
            ..Default::default()
        };
        let creature = Creature {
            id: "creature_test".to_owned(),
            name: "Test Creature".to_owned(),
            mesh: "r\\test.nif".to_owned(),
            spells: vec!["spell_test".to_owned()],
            ..Default::default()
        };
        let spell = Spell {
            id: "spell_test".to_owned(),
            name: "Test Spell".to_owned(),
            effects: vec![effect.clone()],
            ..Default::default()
        };
        let enchanting = Enchanting {
            id: "enchant_test".to_owned(),
            effects: vec![effect.clone()],
            ..Default::default()
        };
        let alchemy = Alchemy {
            id: "potion_test".to_owned(),
            name: "Test Potion".to_owned(),
            mesh: "m\\potion.nif".to_owned(),
            effects: vec![effect],
            ..Default::default()
        };
        let book = Book {
            id: "book_test".to_owned(),
            name: "Test Book".to_owned(),
            mesh: "m\\book.nif".to_owned(),
            text: "<DIV ALIGN=\"CENTER\">A book</DIV><BR>Second line".to_owned(),
            ..Default::default()
        };
        let mut light = Light {
            id: "light_test".to_owned(),
            ..Default::default()
        };
        light.data.color = [10, 20, 30, 0];

        let mut plugin = Plugin {
            objects: vec![
                Header::default().into(),
                armor.into(),
                bodypart.into(),
                clothing.into(),
                leveled_item.into(),
                leveled_creature.into(),
                creature.into(),
                spell.into(),
                enchanting.into(),
                alchemy.into(),
                book.into(),
                light.into(),
            ],
        };
        let bytes = plugin
            .save_bytes()
            .expect("serialize extended plugin fixture");
        let packet = parse_plugin_packet(&bytes).expect("parse extended plugin fixture");
        let record = |id: &str| {
            packet
                .records
                .iter()
                .find(|record| record.id == id)
                .unwrap()
        };

        assert_eq!(packet.records.len(), 11);
        assert_eq!(record("armor_test").record_type, "Armor");
        assert_eq!(record("body_test").record_type, "Bodypart");
        assert_eq!(record("clothing_test").record_type, "Clothing");
        assert_eq!(record("items_test").record_type, "LeveledItem");
        assert_eq!(record("creatures_test").record_type, "LeveledCreature");
        assert_eq!(record("creature_test").record_type, "Creature");
        assert_eq!(
            record("spell_test").raw["effects"][0]["magic_effect"],
            "FireDamage"
        );
        assert_eq!(record("enchant_test").raw["effects"][0]["duration"], 5);
        assert_eq!(record("potion_test").raw["effects"][0]["max_magnitude"], 4);
        assert_eq!(
            record("book_test").raw["text"],
            "<DIV ALIGN=\"CENTER\">A book</DIV><BR>Second line"
        );
        assert_eq!(
            record("light_test").raw["data"]["color"],
            json!([10, 20, 30, 0])
        );
    }
}
