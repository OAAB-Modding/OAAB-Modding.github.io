use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::Serialize;
use tes3::nif::{
    Map as NifTextureMap, NiAVObject, NiAlphaProperty, NiGeometry, NiGeometryData, NiKey,
    NiMaterialProperty, NiNode, NiObjectNET, NiSourceTexture, NiStencilProperty, NiStream,
    NiTexturingProperty, NiTriShape, NiTriShapeData, NiTriStrips, NiTriStripsData, NiType,
    NiVertexColorProperty, NiZBufferProperty, TextureMap, TextureSource,
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
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPacket {
    pub version: String,
    pub nodes: Vec<NodePacket>,
    pub meshes: Vec<MeshPacket>,
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
}

struct ParseContext<'a> {
    stream: &'a NiStream,
    nodes: Vec<NodePacket>,
    meshes: Vec<MeshPacket>,
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
        textures: BTreeSet::new(),
        warnings: Vec::new(),
        visited: HashSet::new(),
    };

    for root in &stream.roots {
        walk_object(&mut context, root.key, Affine3A::IDENTITY, false, 0);
    }

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
    };

    Ok(RenderPacket {
        version: "NetImmerse 4.0.0.2".to_owned(),
        nodes: context.nodes,
        meshes: context.meshes,
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
        for child in &node.children {
            walk_object(context, child.key, transform, collision, depth + 1);
        }
        context.visited.remove(&key);
        return;
    }

    if let Ok(shape) = <&NiTriShape>::try_from(object) {
        add_tri_shape(context, shape, parent_transform, parent_collision);
        context.visited.remove(&key);
        return;
    }

    if let Ok(strips) = <&NiTriStrips>::try_from(object) {
        add_tri_strips(context, strips, parent_transform, parent_collision);
    }
    context.visited.remove(&key);
}

fn add_tri_shape(
    context: &mut ParseContext<'_>,
    shape: &NiTriShape,
    parent_transform: Affine3A,
    parent_collision: bool,
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
    );
}

fn add_tri_strips(
    context: &mut ParseContext<'_>,
    strips: &NiTriStrips,
    parent_transform: Affine3A,
    parent_collision: bool,
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
    );
}

fn add_mesh<T>(
    context: &mut ParseContext<'_>,
    shape: &T,
    data: &NiGeometryData,
    indices: Vec<u32>,
    block_type: &str,
    parent_transform: Affine3A,
    parent_collision: bool,
) where
    T: AsRef<NiAVObject> + AsRef<NiGeometry> + AsRef<NiObjectNET>,
{
    let av_object: &NiAVObject = shape.as_ref();
    let geometry: &NiGeometry = shape.as_ref();
    let object_net: &NiObjectNET = shape.as_ref();
    let material = material_packet(context, av_object);
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
    if !geometry.skin_instance.is_null() {
        context
            .warnings
            .push(format!("Skinning is ignored for \"{}\"", object_net.name));
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
    });
}

fn material_packet(context: &mut ParseContext<'_>, object: &NiAVObject) -> MaterialPacket {
    let mut packet = MaterialPacket::default();

    if let Some(material) = object.get_property::<NiMaterialProperty>(context.stream) {
        packet.ambient = material.ambient_color.to_array();
        packet.diffuse = material.diffuse_color.to_array();
        packet.specular = material.specular_color.to_array();
        packet.emissive = material.emissive_color.to_array();
        packet.shininess = material.shine;
        packet.opacity = material.alpha.clamp(0.0, 1.0);
    }

    if let Some(texturing) = object.get_property::<NiTexturingProperty>(context.stream)
        && let Some(Some(texture_map)) = texturing.texture_maps.first()
    {
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

    if let Some(alpha) = object.get_property::<NiAlphaProperty>(context.stream) {
        packet.alpha_blend = alpha.alpha_blending();
        packet.source_blend = format!("{:?}", alpha.src_blend_mode());
        packet.destination_blend = format!("{:?}", alpha.dst_blend_mode());
        packet.alpha_test = alpha.alpha_testing();
        packet.alpha_test_mode = format!("{:?}", alpha.test_mode());
        packet.alpha_threshold = f32::from(alpha.test_ref) / 255.0;
    }

    if let Some(stencil) = object.get_property::<NiStencilProperty>(context.stream) {
        packet.draw_mode = format!("{:?}", stencil.draw_mode);
    }

    if let Some(z_buffer) = object.get_property::<NiZBufferProperty>(context.stream) {
        packet.depth_test = z_buffer.z_buffer_test();
        packet.depth_write = z_buffer.z_buffer_write();
    }

    if let Some(vertex_color) = object.get_property::<NiVertexColorProperty>(context.stream) {
        packet.vertex_color_mode = format!("{:?}", vertex_color.source_vertex_mode);
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
