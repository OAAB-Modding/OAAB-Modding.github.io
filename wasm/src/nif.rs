use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::Serialize;
use tes3::nif::{
    Map as NifTextureMap, NiAVObject, NiAlphaProperty, NiAutoNormalParticles, NiFlipController,
    NiFloatKey, NiGeometry, NiGeometryData, NiKey, NiKeyframeController, NiMaterialProperty,
    NiNode, NiObjectNET, NiParticleSystemController, NiParticles, NiParticlesData, NiPosKey,
    NiRotKey, NiRotatingParticles, NiSourceTexture, NiStencilProperty, NiStream,
    NiTexturingProperty, NiTimeController, NiTriShape, NiTriShapeData, NiTriStrips,
    NiTriStripsData, NiType, NiUVController, NiVertexColorProperty, NiVisController,
    NiZBufferProperty, TextureMap, TextureSource,
    glam::{Affine3A, Mat4},
};

const SUPPORTED_BLOCKS: &[&str] = &[
    "NiNode",
    "NiTriShape",
    "NiTriShapeData",
    "NiTriStrips",
    "NiTriStripsData",
    "NiMaterialProperty",
    "NiTexturingProperty",
    "NiSourceTexture",
    "NiAlphaProperty",
    "NiVertexColorProperty",
    "NiStencilProperty",
    "NiZBufferProperty",
    "RootCollisionNode",
    "NiUVController",
    "NiUVData",
    "NiFlipController",
    "NiVisController",
    "NiVisData",
    "NiKeyframeController",
    "NiKeyframeData",
    "NiSkinInstance",
    "NiSkinData",
    "NiSkinPartition",
    "NiParticles",
    "NiParticlesData",
    "NiAutoNormalParticles",
    "NiAutoNormalParticlesData",
    "NiRotatingParticles",
    "NiRotatingParticlesData",
    "NiParticleSystemController",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPacket {
    pub version: String,
    pub nodes: Vec<NodePacket>,
    pub meshes: Vec<MeshPacket>,
    pub particles: Vec<ParticlePacket>,
    pub animations: Vec<AnimationPacket>,
    pub textures: Vec<String>,
    pub block_counts: BTreeMap<String, usize>,
    pub unsupported_blocks: Vec<UnsupportedBlock>,
    pub warnings: Vec<String>,
    pub stats: PacketStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePacket {
    pub name: String,
    pub block_type: String,
    pub transform: Vec<f32>,
    pub collision: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPacket {
    pub name: String,
    pub block_type: String,
    pub transform: Vec<f32>,
    pub vertices: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub colors: Vec<f32>,
    pub indices: Vec<u32>,
    pub material: MaterialPacket,
    pub collision: bool,
    pub hidden: bool,
    pub animation_targets: Vec<String>,
    pub skinned: bool,
    pub bone_count: usize,
    pub skin_partition_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticlePacket {
    pub name: String,
    pub block_type: String,
    pub transform: Vec<f32>,
    pub positions: Vec<f32>,
    pub colors: Vec<f32>,
    pub sizes: Vec<f32>,
    pub radius: f32,
    pub material: MaterialPacket,
    pub hidden: bool,
    pub animation_targets: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationPacket {
    pub controller_type: String,
    pub target: String,
    pub active: bool,
    pub cycle_type: String,
    pub frequency: f32,
    pub phase: f32,
    pub start_time: f32,
    pub stop_time: f32,
    pub data: AnimationData,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AnimationData {
    Uv {
        u_offset: Vec<ScalarKey>,
        v_offset: Vec<ScalarKey>,
        u_tiling: Vec<ScalarKey>,
        v_tiling: Vec<ScalarKey>,
    },
    Flip {
        affected_map: u32,
        flip_start_time: f32,
        secs_per_frame: f32,
        textures: Vec<String>,
    },
    Visibility {
        keys: Vec<VisibilityKey>,
    },
    Keyframe {
        translations: Vec<VectorKey>,
        rotations: Vec<QuaternionKey>,
        scales: Vec<ScalarKey>,
    },
}

#[derive(Debug, Serialize)]
pub struct ScalarKey {
    pub time: f32,
    pub value: f32,
}

#[derive(Debug, Serialize)]
pub struct VectorKey {
    pub time: f32,
    pub value: [f32; 3],
}

#[derive(Debug, Serialize)]
pub struct QuaternionKey {
    pub time: f32,
    pub value: [f32; 4],
}

#[derive(Debug, Serialize)]
pub struct VisibilityKey {
    pub time: f32,
    pub value: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPacket {
    pub ambient: [f32; 3],
    pub diffuse: [f32; 3],
    pub specular: [f32; 3],
    pub emissive: [f32; 3],
    pub shininess: f32,
    pub opacity: f32,
    pub texture: Option<String>,
    pub apply_mode: String,
    pub uv_set: usize,
    pub clamp_mode: String,
    pub filter_mode: String,
    pub alpha_blend: bool,
    pub source_blend: String,
    pub destination_blend: String,
    pub alpha_test: bool,
    pub alpha_test_mode: String,
    pub alpha_threshold: f32,
    pub draw_mode: String,
    pub depth_test: bool,
    pub depth_write: bool,
    pub vertex_color_mode: String,
    pub vertex_color_lighting_mode: String,
}

impl Default for MaterialPacket {
    fn default() -> Self {
        Self {
            ambient: [1.0, 1.0, 1.0],
            diffuse: [1.0, 1.0, 1.0],
            specular: [0.0, 0.0, 0.0],
            emissive: [0.0, 0.0, 0.0],
            shininess: 0.0,
            opacity: 1.0,
            texture: None,
            apply_mode: "Modulate".to_owned(),
            uv_set: 0,
            clamp_mode: "WrapSWrapT".to_owned(),
            filter_mode: "Trilerp".to_owned(),
            alpha_blend: false,
            source_blend: "One".to_owned(),
            destination_blend: "Zero".to_owned(),
            alpha_test: false,
            alpha_test_mode: "Always".to_owned(),
            alpha_threshold: 0.0,
            draw_mode: "Default".to_owned(),
            depth_test: true,
            depth_write: true,
            vertex_color_mode: "Ignore".to_owned(),
            vertex_color_lighting_mode: "EmissiveAmbientDiffuse".to_owned(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedBlock {
    pub block_type: String,
    pub count: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketStats {
    pub blocks: usize,
    pub nodes: usize,
    pub meshes: usize,
    pub vertices: usize,
    pub triangles: usize,
    pub particles: usize,
    pub animations: usize,
}

struct ParseContext<'a> {
    stream: &'a NiStream,
    nodes: Vec<NodePacket>,
    meshes: Vec<MeshPacket>,
    particles: Vec<ParticlePacket>,
    animations: Vec<AnimationPacket>,
    textures: BTreeSet<String>,
    warnings: Vec<String>,
    visited: HashSet<NiKey>,
}

pub fn parse_nif_packet(bytes: &[u8]) -> Result<RenderPacket, String> {
    let stream =
        NiStream::from_bytes(bytes).map_err(|error| format!("NIF parse failed: {error}"))?;

    let mut block_counts = BTreeMap::new();
    for object in stream.objects.values() {
        *block_counts.entry(type_name(object)).or_insert(0) += 1;
    }

    let unsupported_blocks = block_counts
        .iter()
        .filter(|(name, _)| !SUPPORTED_BLOCKS.contains(&name.as_str()))
        .map(|(block_type, count)| UnsupportedBlock {
            block_type: block_type.clone(),
            count: *count,
        })
        .collect();

    let mut context = ParseContext {
        stream: &stream,
        nodes: Vec::new(),
        meshes: Vec::new(),
        particles: Vec::new(),
        animations: Vec::new(),
        textures: BTreeSet::new(),
        warnings: Vec::new(),
        visited: HashSet::new(),
    };

    for root in &stream.roots {
        walk_object(
            &mut context,
            root.key,
            Affine3A::IDENTITY,
            false,
            0,
            &[],
            &[],
        );
    }
    extract_animations(&mut context);

    // Include external textures not attached to a rendered base map in the
    // diagnostic dependency list (glow, dark, decal and controller textures).
    for texture in stream.objects_of_type::<NiSourceTexture>() {
        match &texture.source {
            TextureSource::External(path) if !path.trim().is_empty() => {
                context.textures.insert(path.clone());
            }
            TextureSource::Internal(_) => context
                .warnings
                .push("Embedded NiSourceTexture data is not rendered yet".to_owned()),
            _ => {}
        }
    }

    context.warnings.sort();
    context.warnings.dedup();

    let stats = PacketStats {
        blocks: stream.objects.len(),
        nodes: context.nodes.len(),
        meshes: context.meshes.len(),
        vertices: context
            .meshes
            .iter()
            .map(|mesh| mesh.vertices.len() / 3)
            .sum(),
        triangles: context
            .meshes
            .iter()
            .map(|mesh| mesh.indices.len() / 3)
            .sum(),
        particles: context
            .particles
            .iter()
            .map(|particle| particle.positions.len() / 3)
            .sum(),
        animations: context.animations.len(),
    };

    Ok(RenderPacket {
        version: "NetImmerse 4.0.0.2".to_owned(),
        nodes: context.nodes,
        meshes: context.meshes,
        particles: context.particles,
        animations: context.animations,
        textures: context.textures.into_iter().collect(),
        block_counts,
        unsupported_blocks,
        warnings: context.warnings,
        stats,
    })
}

fn walk_object(
    context: &mut ParseContext<'_>,
    key: NiKey,
    parent_transform: Affine3A,
    parent_collision: bool,
    depth: usize,
    animation_targets: &[String],
    inherited_properties: &[NiKey],
) {
    if depth > 256 {
        context
            .warnings
            .push("Scene graph exceeded the 256-node traversal limit".to_owned());
        return;
    }
    if !context.visited.insert(key) {
        context
            .warnings
            .push("Scene graph contains a repeated or cyclic object link".to_owned());
        return;
    }

    let Some(object) = context.stream.objects.get(key) else {
        return;
    };
    let block_type = type_name(object);

    if let Ok(node) = <&NiNode>::try_from(object) {
        let collision = parent_collision
            || block_type == "RootCollisionNode"
            || looks_like_collision(&node.name);
        let transform = parent_transform * node.transform();
        context.nodes.push(NodePacket {
            name: node.name.clone(),
            block_type,
            transform: matrix_array(transform),
            collision,
        });
        let mut child_targets = animation_targets.to_vec();
        if !node.name.is_empty() {
            child_targets.push(node.name.clone());
        }
        let mut child_properties = inherited_properties.to_vec();
        child_properties.extend(node.properties.iter().map(|property| property.key));
        for child in &node.children {
            walk_object(
                context,
                child.key,
                transform,
                collision,
                depth + 1,
                &child_targets,
                &child_properties,
            );
        }
        context.visited.remove(&key);
        return;
    }

    if let Ok(shape) = <&NiTriShape>::try_from(object) {
        add_tri_shape(
            context,
            shape,
            parent_transform,
            parent_collision,
            animation_targets,
            inherited_properties,
        );
        context.visited.remove(&key);
        return;
    }

    if let Ok(strips) = <&NiTriStrips>::try_from(object) {
        add_tri_strips(
            context,
            strips,
            parent_transform,
            parent_collision,
            animation_targets,
            inherited_properties,
        );
        context.visited.remove(&key);
        return;
    }

    if let Ok(particles) = <&NiAutoNormalParticles>::try_from(object) {
        add_particles(
            context,
            particles,
            "NiAutoNormalParticles",
            parent_transform,
            animation_targets,
            inherited_properties,
        );
        context.visited.remove(&key);
        return;
    }

    if let Ok(particles) = <&NiRotatingParticles>::try_from(object) {
        add_particles(
            context,
            particles,
            "NiRotatingParticles",
            parent_transform,
            animation_targets,
            inherited_properties,
        );
        context.visited.remove(&key);
        return;
    }

    if let Ok(particles) = <&NiParticles>::try_from(object) {
        add_particles(
            context,
            particles,
            "NiParticles",
            parent_transform,
            animation_targets,
            inherited_properties,
        );
    }
    context.visited.remove(&key);
}

fn add_tri_shape(
    context: &mut ParseContext<'_>,
    shape: &NiTriShape,
    parent_transform: Affine3A,
    parent_collision: bool,
    animation_targets: &[String],
    inherited_properties: &[NiKey],
) {
    let geometry: &NiGeometry = shape.as_ref();
    let Some(data) = context
        .stream
        .get_as::<_, NiTriShapeData>(geometry.geometry_data)
    else {
        context.warnings.push(format!(
            "NiTriShape \"{}\" has no NiTriShapeData",
            shape.name
        ));
        return;
    };
    let indices = data
        .triangles
        .iter()
        .flat_map(|triangle| triangle.iter().copied().map(u32::from))
        .collect();
    add_mesh(
        context,
        shape,
        data.as_ref(),
        indices,
        "NiTriShape",
        parent_transform,
        parent_collision,
        animation_targets,
        inherited_properties,
    );
}

fn add_tri_strips(
    context: &mut ParseContext<'_>,
    strips: &NiTriStrips,
    parent_transform: Affine3A,
    parent_collision: bool,
    animation_targets: &[String],
    inherited_properties: &[NiKey],
) {
    let geometry: &NiGeometry = strips.as_ref();
    let Some(data) = context
        .stream
        .get_as::<_, NiTriStripsData>(geometry.geometry_data)
    else {
        context.warnings.push(format!(
            "NiTriStrips \"{}\" has no NiTriStripsData",
            strips.name
        ));
        return;
    };

    let mut indices = Vec::with_capacity(usize::from(data.num_triangles) * 3);
    let mut offset = 0usize;
    for length in &data.strip_lengths {
        let end = offset.saturating_add(usize::from(*length));
        let Some(strip) = data.strips.get(offset..end) else {
            context.warnings.push(format!(
                "NiTriStrips \"{}\" has an invalid strip length table",
                strips.name
            ));
            break;
        };
        for index in 2..strip.len() {
            let (a, b, c) = if index % 2 == 0 {
                (strip[index - 2], strip[index - 1], strip[index])
            } else {
                (strip[index - 1], strip[index - 2], strip[index])
            };
            if a != b && b != c && a != c {
                indices.extend([u32::from(a), u32::from(b), u32::from(c)]);
            }
        }
        offset = end;
    }

    add_mesh(
        context,
        strips,
        data.as_ref(),
        indices,
        "NiTriStrips",
        parent_transform,
        parent_collision,
        animation_targets,
        inherited_properties,
    );
}

#[allow(clippy::too_many_arguments)]
fn add_mesh<T>(
    context: &mut ParseContext<'_>,
    shape: &T,
    data: &NiGeometryData,
    indices: Vec<u32>,
    block_type: &str,
    parent_transform: Affine3A,
    parent_collision: bool,
    animation_targets: &[String],
    inherited_properties: &[NiKey],
) where
    T: AsRef<NiAVObject> + AsRef<NiGeometry> + AsRef<NiObjectNET>,
{
    let av_object: &NiAVObject = shape.as_ref();
    let geometry: &NiGeometry = shape.as_ref();
    let object_net: &NiObjectNET = shape.as_ref();
    let material = material_packet(context, av_object, inherited_properties);
    let requested_uv_set = material.uv_set;
    let uvs = data
        .uv_set(requested_uv_set)
        .or_else(|| data.uv_set(0))
        .unwrap_or_default();

    if material.texture.is_some() && requested_uv_set > 0 && data.uv_set(requested_uv_set).is_none()
    {
        context.warnings.push(format!(
            "{block_type} \"{}\" requests missing UV set {requested_uv_set}; using set 0",
            object_net.name
        ));
    }
    let skin = context
        .stream
        .get_as::<_, tes3::nif::NiSkinInstance>(geometry.skin_instance);
    let skin_data = skin.and_then(|instance| context.stream.get(instance.data));
    if skin.is_some() {
        context.warnings.push(format!(
            "Skinning for \"{}\" is displayed in its bind pose",
            object_net.name
        ));
    }

    let collision = parent_collision || looks_like_collision(&object_net.name);
    context.meshes.push(MeshPacket {
        name: object_net.name.clone(),
        block_type: block_type.to_owned(),
        transform: matrix_array(parent_transform * av_object.transform()),
        vertices: data
            .vertices
            .iter()
            .flat_map(|value| value.to_array())
            .collect(),
        normals: data
            .normals
            .iter()
            .flat_map(|value| value.to_array())
            .collect(),
        uvs: uvs.iter().flat_map(|value| value.to_array()).collect(),
        colors: data
            .vertex_colors
            .iter()
            .flat_map(|value| value.to_array())
            .collect(),
        indices,
        material,
        collision,
        hidden: av_object.app_culled(),
        animation_targets: animation_target_names(animation_targets, &object_net.name),
        skinned: skin.is_some(),
        bone_count: skin.map_or(0, |instance| instance.bones.len()),
        skin_partition_count: skin_data
            .and_then(|data| context.stream.get(data.skin_partition))
            .map_or(0, |partition| partition.partitions.len()),
    });
}

fn add_particles<T>(
    context: &mut ParseContext<'_>,
    particles: &T,
    block_type: &str,
    parent_transform: Affine3A,
    animation_targets: &[String],
    inherited_properties: &[NiKey],
) where
    T: AsRef<NiAVObject> + AsRef<NiGeometry> + AsRef<NiObjectNET>,
{
    let geometry: &NiGeometry = particles.as_ref();
    let av_object: &NiAVObject = particles.as_ref();
    let object_net: &NiObjectNET = particles.as_ref();
    let Some(data) = context
        .stream
        .get_as::<_, NiParticlesData>(geometry.geometry_data)
    else {
        context.warnings.push(format!(
            "{block_type} \"{}\" has no supported particle data",
            object_net.name
        ));
        return;
    };
    let geometry_data: &NiGeometryData = data.as_ref();
    let capacity = geometry_data.vertices.len();
    let controller = object_net
        .controllers_of_type::<NiParticleSystemController>(context.stream)
        .next();
    let (active, radius) = if let Some(controller) = controller {
        let active_emitter = controller.base.active()
            && context.stream.get(controller.emitter).is_some()
            && controller.emit_stop_time > controller.emit_start_time;
        let active = if let Some(active) = preview_active_particle_count(
            data.num_active,
            controller.num_active_particles,
            capacity,
            controller.particles.len(),
            active_emitter,
        ) {
            active
        } else {
            context.warnings.push(format!(
                "{block_type} \"{}\" has mismatched particle pools; runtime active state was reset",
                object_net.name
            ));
            0
        };
        (active, controller.initial_size)
    } else {
        (
            usize::from(data.num_active).min(capacity),
            data.particle_radius,
        )
    };
    let positions = geometry_data.vertices[..active]
        .iter()
        .flat_map(|value| value.to_array())
        .collect();
    let colors = (0..active)
        .flat_map(|index| {
            geometry_data
                .vertex_colors
                .get(index)
                .map_or([1.0; 4], |value| value.to_array())
        })
        .collect();
    let sizes = (0..active)
        .map(|index| data.sizes.get(index).copied().unwrap_or(1.0))
        .collect();
    let material = material_packet(context, av_object, inherited_properties);
    context.particles.push(ParticlePacket {
        name: object_net.name.clone(),
        block_type: block_type.to_owned(),
        transform: matrix_array(parent_transform * av_object.transform()),
        positions,
        colors,
        sizes,
        radius,
        material,
        hidden: av_object.app_culled(),
        animation_targets: animation_target_names(animation_targets, &object_net.name),
    });
}

fn preview_active_particle_count(
    saved_active: u16,
    controller_active: u16,
    capacity: usize,
    controller_capacity: usize,
    active_emitter: bool,
) -> Option<usize> {
    if controller_capacity != capacity {
        return None;
    }

    let controller_active = usize::from(controller_active).min(capacity);
    let saved_active = usize::from(saved_active).min(capacity);

    // The game lets the controller replace NiParticlesData.num_active, then
    // immediately pre-warms an active emitter. We do not simulate that
    // controller yet, so an empty serialized controller would hide useful
    // saved preview positions and leave only companion plane geometry visible.
    // Use that dense saved prefix as the representative static state when the
    // emitter would rebuild it on load.
    Some(
        if controller_active == 0 && saved_active > 0 && active_emitter {
            saved_active
        } else {
            controller_active
        },
    )
}

fn extract_animations(context: &mut ParseContext<'_>) {
    for controller in context.stream.objects_of_type::<NiUVController>() {
        let Some(data) = context.stream.get(controller.data) else {
            continue;
        };
        context.animations.push(animation_packet(
            context.stream,
            &controller.base,
            "NiUVController",
            AnimationData::Uv {
                u_offset: scalar_keys(&data.u_offset_data.keys),
                v_offset: scalar_keys(&data.v_offset_data.keys),
                u_tiling: scalar_keys(&data.u_tiling_data.keys),
                v_tiling: scalar_keys(&data.v_tiling_data.keys),
            },
        ));
    }
    for controller in context.stream.objects_of_type::<NiFlipController>() {
        let textures = controller
            .textures
            .iter()
            .filter_map(|link| context.stream.get(*link))
            .filter_map(|texture| match &texture.source {
                TextureSource::External(path) if !path.trim().is_empty() => Some(path.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        context.textures.extend(textures.iter().cloned());
        context.animations.push(animation_packet(
            context.stream,
            &controller.base,
            "NiFlipController",
            AnimationData::Flip {
                affected_map: controller.affected_map,
                flip_start_time: controller.flip_start_time,
                secs_per_frame: controller.secs_per_frame,
                textures,
            },
        ));
    }
    for controller in context.stream.objects_of_type::<NiVisController>() {
        let Some(data) = context.stream.get(controller.data) else {
            continue;
        };
        context.animations.push(animation_packet(
            context.stream,
            &controller.base,
            "NiVisController",
            AnimationData::Visibility {
                keys: data
                    .keys
                    .iter()
                    .map(|key| VisibilityKey {
                        time: key.time,
                        value: key.value != 0,
                    })
                    .collect(),
            },
        ));
    }
    for controller in context.stream.objects_of_type::<NiKeyframeController>() {
        let Some(data) = context.stream.get(controller.data) else {
            continue;
        };
        context.animations.push(animation_packet(
            context.stream,
            &controller.base,
            "NiKeyframeController",
            AnimationData::Keyframe {
                translations: vector_keys(&data.translations.keys),
                rotations: quaternion_keys(&data.rotations.keys),
                scales: scalar_keys(&data.scales.keys),
            },
        ));
    }
}

fn animation_packet(
    stream: &NiStream,
    controller: &NiTimeController,
    controller_type: &str,
    data: AnimationData,
) -> AnimationPacket {
    let target = stream
        .get(controller.target)
        .map(|target| target.name.clone())
        .unwrap_or_default();
    AnimationPacket {
        controller_type: controller_type.to_owned(),
        target,
        active: controller.active(),
        cycle_type: format!("{:?}", controller.cycle_type()),
        frequency: controller.frequency,
        phase: controller.phase,
        start_time: controller.start_time,
        stop_time: controller.stop_time,
        data,
    }
}

fn scalar_keys(keys: &NiFloatKey) -> Vec<ScalarKey> {
    match keys {
        NiFloatKey::LinKey(keys) => keys
            .iter()
            .map(|key| ScalarKey {
                time: key.time,
                value: key.value,
            })
            .collect(),
        NiFloatKey::BezKey(keys) => keys
            .iter()
            .map(|key| ScalarKey {
                time: key.time,
                value: key.value,
            })
            .collect(),
        NiFloatKey::TCBKey(keys) => keys
            .iter()
            .map(|key| ScalarKey {
                time: key.time,
                value: key.value,
            })
            .collect(),
    }
}

fn vector_keys(keys: &NiPosKey) -> Vec<VectorKey> {
    match keys {
        NiPosKey::LinKey(keys) => keys
            .iter()
            .map(|key| VectorKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
        NiPosKey::BezKey(keys) => keys
            .iter()
            .map(|key| VectorKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
        NiPosKey::TCBKey(keys) => keys
            .iter()
            .map(|key| VectorKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
    }
}

fn quaternion_keys(keys: &NiRotKey) -> Vec<QuaternionKey> {
    match keys {
        NiRotKey::LinKey(keys) => keys
            .iter()
            .map(|key| QuaternionKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
        NiRotKey::BezKey(keys) => keys
            .iter()
            .map(|key| QuaternionKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
        NiRotKey::TCBKey(keys) => keys
            .iter()
            .map(|key| QuaternionKey {
                time: key.time,
                value: key.value.to_array(),
            })
            .collect(),
        NiRotKey::EulerKey(_) => Vec::new(),
    }
}

fn animation_target_names(ancestors: &[String], name: &str) -> Vec<String> {
    let mut targets = ancestors.to_vec();
    if !name.is_empty() {
        targets.push(name.to_owned());
    }
    targets.sort();
    targets.dedup();
    targets
}

fn material_packet(
    context: &mut ParseContext<'_>,
    object: &NiAVObject,
    inherited_properties: &[NiKey],
) -> MaterialPacket {
    let mut packet = MaterialPacket::default();

    // NetImmerse properties cascade down the scene graph. Apply ancestors
    // first and the geometry's own properties last, matching Morrowind's
    // override behavior for drawable state.
    let property_keys = inherited_properties
        .iter()
        .copied()
        .chain(object.properties.iter().map(|property| property.key));
    for key in property_keys {
        let Some(property) = context.stream.objects.get(key) else {
            continue;
        };

        if let Ok(material) = <&NiMaterialProperty>::try_from(property) {
            packet.ambient = material.ambient_color.to_array();
            packet.diffuse = material.diffuse_color.to_array();
            packet.specular = material.specular_color.to_array();
            packet.emissive = material.emissive_color.to_array();
            packet.shininess = material.shine;
            packet.opacity = material.alpha.clamp(0.0, 1.0);
            continue;
        }

        if let Ok(texturing) = <&NiTexturingProperty>::try_from(property) {
            packet.apply_mode = format!("{:?}", texturing.apply_mode);
            if let Some(Some(texture_map)) = texturing.texture_maps.first() {
                let map: &NifTextureMap = match texture_map {
                    TextureMap::Map(map) => map,
                    TextureMap::BumpMap(map) => &map.base,
                };
                packet.uv_set = map.texture_index;
                packet.clamp_mode = format!("{:?}", map.clamp_mode);
                packet.filter_mode = format!("{:?}", map.filter_mode);

                if let Some(texture) = context.stream.get(map.texture) {
                    match &texture.source {
                        TextureSource::External(path) if !path.trim().is_empty() => {
                            packet.texture = Some(path.clone());
                            context.textures.insert(path.clone());
                        }
                        TextureSource::Internal(_) => context
                            .warnings
                            .push("Embedded base textures are not rendered yet".to_owned()),
                        _ => {}
                    }
                }
            }
            continue;
        }

        if let Ok(alpha) = <&NiAlphaProperty>::try_from(property) {
            packet.alpha_blend = alpha.alpha_blending();
            packet.source_blend = format!("{:?}", alpha.src_blend_mode());
            packet.destination_blend = format!("{:?}", alpha.dst_blend_mode());
            packet.alpha_test = alpha.alpha_testing();
            packet.alpha_test_mode = format!("{:?}", alpha.test_mode());
            packet.alpha_threshold = f32::from(alpha.test_ref) / 255.0;
            continue;
        }

        if let Ok(stencil) = <&NiStencilProperty>::try_from(property) {
            packet.draw_mode = format!("{:?}", stencil.draw_mode);
            continue;
        }

        if let Ok(z_buffer) = <&NiZBufferProperty>::try_from(property) {
            packet.depth_test = z_buffer.z_buffer_test();
            packet.depth_write = z_buffer.z_buffer_write();
            continue;
        }

        if let Ok(vertex_color) = <&NiVertexColorProperty>::try_from(property) {
            packet.vertex_color_mode = format!("{:?}", vertex_color.source_vertex_mode);
            packet.vertex_color_lighting_mode = format!("{:?}", vertex_color.lighting_mode);
        }
    }

    packet
}

fn matrix_array(transform: Affine3A) -> Vec<f32> {
    Mat4::from(transform).to_cols_array().to_vec()
}

fn type_name(object: &NiType) -> String {
    String::from_utf8_lossy(object.type_name()).into_owned()
}

fn looks_like_collision(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("collision") || name.contains("collider") || name.contains("bounding box")
}

#[cfg(test)]
mod advanced_tests {
    use super::*;
    use tes3::nif::{
        ApplyMode, BoneData, LightingMode, NiAutoNormalParticlesData, NiFlipController,
        NiKeyframeData, NiLinFloatKey, NiLinPosKey, NiLinRotKey, NiPerParticleData, NiSkinData,
        NiSkinInstance, NiSkinPartition, NiSourceTexture, NiTexturingProperty, NiTriShape,
        NiTriShapeData, NiUVData, NiVisData, NiVisKey, SourceVertexMode, TextureSource,
        glam::{Quat, vec3, vec4},
    };

    #[test]
    fn active_empty_emitter_uses_saved_particles_as_its_static_preview() {
        assert_eq!(preview_active_particle_count(7, 0, 9, 9, true), Some(7));
        assert_eq!(preview_active_particle_count(7, 0, 9, 9, false), Some(0));
        assert_eq!(preview_active_particle_count(7, 3, 9, 9, true), Some(3));
        assert_eq!(preview_active_particle_count(7, 0, 9, 8, true), None);
    }

    #[allow(clippy::field_reassign_with_default)]
    #[test]
    fn advanced_packet_covers_controllers_particles_and_bind_pose_skinning() {
        let mut stream = NiStream::new();
        let node = stream.insert(NiNode::default());
        stream.get_mut(node).unwrap().name = "AnimatedRoot".to_owned();
        let vertex_color_property = stream.insert(NiVertexColorProperty {
            source_vertex_mode: SourceVertexMode::AmbientDiffuse,
            lighting_mode: LightingMode::EmissiveAmbientDiffuse,
            ..Default::default()
        });
        stream
            .get_mut(node)
            .unwrap()
            .properties
            .push(vertex_color_property.cast());

        let mut uv_data = NiUVData::default();
        uv_data.u_offset_data.keys = NiFloatKey::LinKey(vec![NiLinFloatKey {
            time: 0.0,
            value: 0.25,
        }]);
        let uv_data = stream.insert(uv_data);
        let mut visibility_data = NiVisData::default();
        visibility_data.keys = vec![NiVisKey {
            time: 0.0,
            value: 1,
        }];
        let visibility_data = stream.insert(visibility_data);
        let mut keyframe_data = NiKeyframeData::default();
        keyframe_data.translations.keys = NiPosKey::LinKey(vec![NiLinPosKey {
            time: 0.0,
            value: vec3(1.0, 2.0, 3.0),
        }]);
        keyframe_data.rotations.keys = NiRotKey::LinKey(vec![NiLinRotKey {
            time: 0.0,
            value: Quat::IDENTITY,
        }]);
        keyframe_data.scales.keys = NiFloatKey::LinKey(vec![NiLinFloatKey {
            time: 0.0,
            value: 1.0,
        }]);
        let keyframe_data = stream.insert(keyframe_data);
        let texture = stream.insert(NiSourceTexture {
            source: TextureSource::External("textures\\animated.dds".to_owned()),
            ..Default::default()
        });
        let texturing_property = stream.insert(NiTexturingProperty {
            apply_mode: ApplyMode::Replace,
            texture_maps: vec![Some(TextureMap::Map(NifTextureMap {
                texture,
                ..Default::default()
            }))],
            ..Default::default()
        });
        stream
            .get_mut(node)
            .unwrap()
            .properties
            .push(texturing_property.cast());

        let mut keyframe = NiKeyframeController::default();
        keyframe.base.flags |= 0x0008;
        keyframe.base.target = node.cast();
        keyframe.data = keyframe_data;
        let keyframe = stream.insert(keyframe);
        let mut visibility = NiVisController::default();
        visibility.base.flags |= 0x0008;
        visibility.base.target = node.cast();
        visibility.base.next = keyframe.cast();
        visibility.data = visibility_data;
        let visibility = stream.insert(visibility);
        let mut flip = NiFlipController::default();
        flip.base.flags |= 0x0008;
        flip.base.target = node.cast();
        flip.base.next = visibility.cast();
        flip.secs_per_frame = 0.1;
        flip.textures = vec![texture];
        let flip = stream.insert(flip);
        let mut uv = NiUVController::default();
        uv.base.flags |= 0x0008;
        uv.base.target = node.cast();
        uv.base.next = flip.cast();
        uv.data = uv_data;
        let uv = stream.insert(uv);
        stream.get_mut(node).unwrap().controller = uv.cast();

        let mut particle_data = NiAutoNormalParticlesData::default();
        particle_data.vertices = vec![vec3(0.0, 0.0, 0.0), vec3(5.0, 0.0, 0.0)];
        particle_data.num_particles = 2;
        particle_data.num_active = 2;
        particle_data.particle_radius = 0.5;
        let particle_data = stream.insert(particle_data);
        let mut particles = NiAutoNormalParticles::default();
        particles.name = "ParticleFixture".to_owned();
        particles.geometry_data = particle_data.cast();
        let particles = stream.insert(particles);
        let mut particle_controller = NiParticleSystemController::default();
        particle_controller.base.target = particles.cast();
        particle_controller.initial_size = 2.5;
        particle_controller.particles = vec![NiPerParticleData::default(); 2];
        particle_controller.num_active_particles = 1;
        let particle_controller = stream.insert(particle_controller);
        stream.get_mut(particles).unwrap().controller = particle_controller.cast();

        let partition = stream.insert(NiSkinPartition {
            partitions: vec![Default::default()],
            ..Default::default()
        });
        let skin_data = stream.insert(NiSkinData {
            skin_partition: partition,
            bone_data: vec![BoneData::default()],
            ..Default::default()
        });
        let skin = stream.insert(NiSkinInstance {
            data: skin_data,
            root: node.cast(),
            bones: vec![node.cast()],
            ..Default::default()
        });
        let mut shape_data = NiTriShapeData::default();
        shape_data.vertices = vec![
            vec3(0.0, 0.0, 0.0),
            vec3(1.0, 0.0, 0.0),
            vec3(0.0, 1.0, 0.0),
        ];
        shape_data.vertex_colors = vec![
            vec4(1.0, 0.0, 0.0, 1.0),
            vec4(0.0, 1.0, 0.0, 1.0),
            vec4(0.0, 0.0, 1.0, 1.0),
        ];
        shape_data.triangles = vec![[0, 1, 2]];
        let shape_data = stream.insert(shape_data);
        let mut shape = NiTriShape::default();
        shape.name = "SkinnedFixture".to_owned();
        shape.geometry_data = shape_data.cast();
        shape.skin_instance = skin.cast();
        let shape = stream.insert(shape);

        stream.get_mut(node).unwrap().children = vec![particles.cast(), shape.cast()];
        stream.roots.push(node.cast());
        let bytes = stream.save_bytes().expect("serialize advanced fixture");
        let packet = parse_nif_packet(&bytes).expect("parse advanced fixture");

        assert_eq!(packet.animations.len(), 4);
        assert_eq!(packet.stats.animations, 4);
        assert_eq!(packet.stats.particles, 1);
        assert_eq!(packet.particles.len(), 1);
        assert_eq!(packet.particles[0].positions.len(), 3);
        assert_eq!(packet.particles[0].sizes, vec![1.0]);
        assert_eq!(packet.particles[0].colors, vec![1.0; 4]);
        assert_eq!(packet.particles[0].radius, 2.5);
        assert_eq!(packet.particles[0].material.apply_mode, "Replace");
        assert!(packet.meshes[0].skinned);
        assert_eq!(packet.meshes[0].bone_count, 1);
        assert_eq!(packet.meshes[0].skin_partition_count, 1);
        assert_eq!(packet.meshes[0].colors.len(), 12);
        assert_eq!(
            packet.meshes[0].material.vertex_color_mode,
            "AmbientDiffuse"
        );
        assert_eq!(
            packet.meshes[0].material.vertex_color_lighting_mode,
            "EmissiveAmbientDiffuse"
        );
        assert!(
            packet
                .textures
                .contains(&"textures\\animated.dds".to_owned())
        );
    }
}
