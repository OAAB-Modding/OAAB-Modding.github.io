use std::collections::{HashMap, HashSet};

use tes3::nif::{
    NiAVObject, NiKey, NiKeyframeController, NiStream,
    glam::{Mat3, Quat, Vec3},
};

use super::{
    AnimationGroupPacket, QuaternionCurvePacket, QuaternionKey, ScalarCurvePacket, ScalarKey,
    VectorCurvePacket, VectorKey, external_kf_targets, extract_animation_groups, quaternion_curve,
    scalar_curve, vector_curve,
};

const EPSILON: f32 = 1.0e-8;
const SIN_THRESHOLD: f32 = 0.001;

enum PoseTarget {
    Link(NiKey),
    Name(String),
}

struct PoseTransform {
    target: PoseTarget,
    translation: Option<Vec3>,
    rotation: Option<Quat>,
    scale: Option<f32>,
}

pub(super) struct AppliedPose {
    pub animation_groups: Vec<AnimationGroupPacket>,
    pub warnings: Vec<String>,
}

pub(super) fn apply_idle_pose(stream: &mut NiStream, external: Option<&NiStream>) -> AppliedPose {
    let base_groups = extract_animation_groups(stream);
    let external_groups = external.map(extract_animation_groups).unwrap_or_default();
    let animation_groups = if external_groups.is_empty() {
        base_groups
    } else {
        external_groups
    };
    let pose_time = select_idle_pose_time(&animation_groups);

    let external_names = external.map(external_kf_targets).unwrap_or_default();
    let overridden_names = external_names
        .values()
        .map(|name| normalized_name(name))
        .collect::<HashSet<_>>();

    let mut poses = keyframe_poses(stream, pose_time, None, &overridden_names);
    if let Some(external) = external {
        poses.extend(keyframe_poses(
            external,
            pose_time,
            Some(&external_names),
            &HashSet::new(),
        ));
    }

    let mut warnings = Vec::new();
    for pose in poses {
        match pose.target {
            PoseTarget::Link(key) => {
                let Some(object) = stream
                    .objects
                    .get_mut(key)
                    .and_then(|object| <&mut NiAVObject>::try_from(object).ok())
                else {
                    warnings.push("An inline keyframe target was not reachable".to_owned());
                    continue;
                };
                apply_transform(object, &pose);
            }
            PoseTarget::Name(ref name) => {
                let mut matched = false;
                for object in stream.objects_with_name_mut::<NiAVObject>(name) {
                    matched = true;
                    apply_transform(object, &pose);
                }
                if !matched {
                    warnings.push(format!("External keyframe target \"{name}\" was not found"));
                }
            }
        }
    }

    AppliedPose {
        animation_groups,
        warnings,
    }
}

fn keyframe_poses(
    stream: &NiStream,
    pose_time: Option<f32>,
    external_names: Option<&HashMap<NiKey, String>>,
    overridden_names: &HashSet<String>,
) -> Vec<PoseTransform> {
    stream
        .objects_of_type_with_link::<NiKeyframeController>()
        .filter(|(_, controller)| controller.base.active())
        .filter_map(|(link, controller)| {
            let data = stream.get(controller.data)?;
            let target = if let Some(names) = external_names {
                PoseTarget::Name(names.get(&link.key)?.clone())
            } else {
                let target = stream.get(controller.base.target)?;
                if overridden_names.contains(&normalized_name(&target.name)) {
                    return None;
                }
                PoseTarget::Link(controller.base.target.key)
            };
            let time = pose_time.unwrap_or(controller.base.start_time);
            Some(PoseTransform {
                target,
                translation: sample_vector(&vector_curve(&data.translations.keys), time),
                rotation: sample_quaternion(&quaternion_curve(&data.rotations.keys), time),
                scale: sample_scalar(&scalar_curve(&data.scales.keys), time).map(f32::abs),
            })
        })
        .collect()
}

fn apply_transform(object: &mut NiAVObject, pose: &PoseTransform) {
    if let Some(translation) = pose.translation {
        object.translation = translation;
    }
    if let Some(rotation) = pose.rotation {
        object.rotation = Mat3::from_quat(rotation).transpose();
    }
    if let Some(scale) = pose.scale {
        object.scale = scale;
    }
}

fn select_idle_pose_time(groups: &[AnimationGroupPacket]) -> Option<f32> {
    groups
        .iter()
        .enumerate()
        .filter_map(|(index, group)| {
            let score = idle_score(&group.name)?;
            (group.stop_time > group.start_time).then_some((score, index, group))
        })
        .min_by_key(|(score, index, _)| (*score, *index))
        .map(
            |(_, _, group)| match (group.loop_start_time, group.loop_stop_time) {
                (Some(start), Some(stop)) if stop > start => start,
                _ => group.start_time,
            },
        )
}

fn idle_score(name: &str) -> Option<u32> {
    let normalized = name
        .chars()
        .filter(|character| !matches!(character, ' ' | ':' | '_' | '-'))
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if normalized == "idle" || normalized == "idle1" {
        return Some(0);
    }
    normalized.strip_prefix("idle")?.parse().ok()
}

fn normalized_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn sample_scalar(curve: &ScalarCurvePacket, time: f32) -> Option<f32> {
    let (before_index, after_index, fraction) = key_interval(&curve.keys, time, |key| key.time)?;
    let before = &curve.keys[before_index];
    let after = &curve.keys[after_index];
    if before_index == after_index {
        return Some(before.value);
    }
    Some(match curve.interpolation.as_str() {
        "Bezier" => hermite(
            before.value,
            before.out_tan.unwrap_or_default(),
            after.in_tan.unwrap_or_default(),
            after.value,
            fraction,
        ),
        "TCB" => hermite(
            before.value,
            scalar_tcb_tangent(&curve.keys, before_index, false),
            scalar_tcb_tangent(&curve.keys, after_index, true),
            after.value,
            fraction,
        ),
        _ => before.value + (after.value - before.value) * fraction,
    })
}

fn sample_vector(curve: &VectorCurvePacket, time: f32) -> Option<Vec3> {
    let (before_index, after_index, fraction) = key_interval(&curve.keys, time, |key| key.time)?;
    let before = &curve.keys[before_index];
    let after = &curve.keys[after_index];
    let before_value = Vec3::from_array(before.value);
    if before_index == after_index {
        return Some(before_value);
    }
    let after_value = Vec3::from_array(after.value);
    Some(match curve.interpolation.as_str() {
        "Bezier" => hermite_vec3(
            before_value,
            Vec3::from_array(before.out_tan.unwrap_or_default()),
            Vec3::from_array(after.in_tan.unwrap_or_default()),
            after_value,
            fraction,
        ),
        "TCB" => hermite_vec3(
            before_value,
            vector_tcb_tangent(&curve.keys, before_index, false),
            vector_tcb_tangent(&curve.keys, after_index, true),
            after_value,
            fraction,
        ),
        _ => before_value.lerp(after_value, fraction),
    })
}

fn sample_quaternion(curve: &QuaternionCurvePacket, time: f32) -> Option<Quat> {
    let (before_index, after_index, fraction) = key_interval(&curve.keys, time, |key| key.time)?;
    let before = normalized_quat(curve.keys[before_index].value);
    if before_index == after_index {
        return Some(before);
    }
    let after = normalized_quat(curve.keys[after_index].value);
    let value = match curve.interpolation.as_str() {
        "Bezier" => squad(
            before,
            bezier_rotation_tangent(&curve.keys, before_index),
            bezier_rotation_tangent(&curve.keys, after_index),
            after,
            fraction,
        ),
        "TCB" => squad(
            before,
            tcb_rotation_tangent(&curve.keys, before_index, false),
            tcb_rotation_tangent(&curve.keys, after_index, true),
            after,
            fraction,
        ),
        _ => nif_slerp(before, after, fraction),
    };
    Some(normalize_quat(value))
}

fn key_interval<T>(
    keys: &[T],
    time: f32,
    key_time: impl Fn(&T) -> f32,
) -> Option<(usize, usize, f32)> {
    let first = keys.first()?;
    if time <= key_time(first) {
        return Some((0, 0, 0.0));
    }
    for index in 1..keys.len() {
        let after_time = key_time(&keys[index]);
        if time <= after_time {
            let before_time = key_time(&keys[index - 1]);
            let span = after_time - before_time;
            return Some((
                index - 1,
                index,
                if span > 0.0 {
                    (time - before_time) / span
                } else {
                    0.0
                },
            ));
        }
    }
    let last = keys.len() - 1;
    Some((last, last, 0.0))
}

fn scalar_tcb_tangent(keys: &[ScalarKey], index: usize, incoming: bool) -> f32 {
    let current = &keys[index];
    let last = keys.len() - 1;
    let previous_index = index.saturating_sub(1);
    let next_index = (index + 1).min(last);
    let (previous, previous_time) = if index == 0 {
        (
            current.value * 2.0 - keys[next_index].value,
            current.time * 2.0 - keys[next_index].time,
        )
    } else {
        (keys[previous_index].value, keys[previous_index].time)
    };
    let (next, next_time) = if index == last {
        (
            current.value * 2.0 - keys[previous_index].value,
            current.time * 2.0 - keys[previous_index].time,
        )
    } else {
        (keys[next_index].value, keys[next_index].time)
    };
    tcb_tangent(
        current.value - previous,
        next - current.value,
        current,
        previous_time,
        next_time,
        incoming,
    )
}

fn vector_tcb_tangent(keys: &[VectorKey], index: usize, incoming: bool) -> Vec3 {
    let current = &keys[index];
    let current_value = Vec3::from_array(current.value);
    let last = keys.len() - 1;
    let previous_index = index.saturating_sub(1);
    let next_index = (index + 1).min(last);
    let (previous, previous_time) = if index == 0 {
        (
            current_value * 2.0 - Vec3::from_array(keys[next_index].value),
            current.time * 2.0 - keys[next_index].time,
        )
    } else {
        (
            Vec3::from_array(keys[previous_index].value),
            keys[previous_index].time,
        )
    };
    let (next, next_time) = if index == last {
        (
            current_value * 2.0 - Vec3::from_array(keys[previous_index].value),
            current.time * 2.0 - keys[previous_index].time,
        )
    } else {
        (
            Vec3::from_array(keys[next_index].value),
            keys[next_index].time,
        )
    };
    tcb_tangent(
        current_value - previous,
        next - current_value,
        current,
        previous_time,
        next_time,
        incoming,
    )
}

trait TcbKey {
    fn time(&self) -> f32;
    fn tension(&self) -> f32;
    fn continuity(&self) -> f32;
    fn bias(&self) -> f32;
}

impl TcbKey for ScalarKey {
    fn time(&self) -> f32 {
        self.time
    }
    fn tension(&self) -> f32 {
        self.tension.unwrap_or_default()
    }
    fn continuity(&self) -> f32 {
        self.continuity.unwrap_or_default()
    }
    fn bias(&self) -> f32 {
        self.bias.unwrap_or_default()
    }
}

impl TcbKey for VectorKey {
    fn time(&self) -> f32 {
        self.time
    }
    fn tension(&self) -> f32 {
        self.tension.unwrap_or_default()
    }
    fn continuity(&self) -> f32 {
        self.continuity.unwrap_or_default()
    }
    fn bias(&self) -> f32 {
        self.bias.unwrap_or_default()
    }
}

fn tcb_tangent<T, V>(
    previous_length: V,
    next_length: V,
    key: &T,
    previous_time: f32,
    next_time: f32,
    incoming: bool,
) -> V
where
    T: TcbKey,
    V: Copy + Default + std::ops::Add<Output = V> + std::ops::Mul<f32, Output = V>,
{
    let first_scale = (1.0 - key.tension())
        * (1.0
            + if incoming {
                -key.continuity()
            } else {
                key.continuity()
            })
        * (1.0 + key.bias());
    let second_scale = (1.0 - key.tension())
        * (1.0
            + if incoming {
                key.continuity()
            } else {
                -key.continuity()
            })
        * (1.0 - key.bias());
    let numerator = if incoming {
        key.time() - previous_time
    } else {
        key.time() - next_time
    };
    let denominator = if incoming {
        next_time - previous_time
    } else {
        previous_time - next_time
    };
    if denominator.abs() < EPSILON {
        return V::default();
    }
    (previous_length * first_scale + next_length * second_scale) * (numerator / denominator)
}

fn rotation_neighbors(keys: &[QuaternionKey], index: usize) -> (Quat, Quat, Quat) {
    let last = keys.len() - 1;
    let current = normalized_quat(keys[index].value);
    let previous = if index == 0 {
        let next = normalized_quat(keys[(last >= 1) as usize].value);
        current * next.conjugate() * current
    } else {
        normalized_quat(keys[index - 1].value)
    };
    let next = if index == last {
        let previous = normalized_quat(keys[last.saturating_sub(1)].value);
        current * previous.conjugate() * current
    } else {
        normalized_quat(keys[index + 1].value)
    };
    (previous, current, next)
}

fn bezier_rotation_tangent(keys: &[QuaternionKey], index: usize) -> Quat {
    let (previous, current, next) = rotation_neighbors(keys, index);
    let inverse = current.conjugate();
    current * quat_exp((quat_log(inverse * previous) + quat_log(inverse * next)) * -0.25)
}

fn tcb_rotation_tangent(keys: &[QuaternionKey], index: usize, incoming: bool) -> Quat {
    let current_key = &keys[index];
    let current = normalized_quat(current_key.value);
    let last = keys.len() - 1;
    let previous_index = index.saturating_sub(1);
    let next_index = (index + 1).min(last);
    let raw_previous = quat_log(normalized_quat(keys[previous_index].value).conjugate() * current);
    let raw_next = quat_log(current.conjugate() * normalized_quat(keys[next_index].value));
    let (previous_length, previous_time) = if index == 0 {
        (raw_next, current_key.time * 2.0 - keys[next_index].time)
    } else {
        (raw_previous, keys[previous_index].time)
    };
    let (next_length, next_time) = if index == last {
        (
            raw_previous,
            current_key.time * 2.0 - keys[previous_index].time,
        )
    } else {
        (raw_next, keys[next_index].time)
    };
    let tension = current_key.tension.unwrap_or_default();
    let continuity = current_key.continuity.unwrap_or_default();
    let bias = current_key.bias.unwrap_or_default();
    let first_scale =
        (1.0 - tension) * (1.0 + if incoming { -continuity } else { continuity }) * (1.0 + bias);
    let second_scale =
        (1.0 - tension) * (1.0 + if incoming { continuity } else { -continuity }) * (1.0 - bias);
    let denominator = next_time - previous_time;
    if denominator.abs() < EPSILON {
        return current;
    }
    let interval_scale = if incoming {
        (next_time - current_key.time) / denominator
    } else {
        (current_key.time - previous_time) / denominator
    };
    let combined = (previous_length * first_scale + next_length * second_scale) * interval_scale;
    let exponent = if incoming {
        (previous_length - combined) * 0.5
    } else {
        (combined - next_length) * 0.5
    };
    current * quat_exp(exponent)
}

fn hermite(p0: f32, out_tangent: f32, in_tangent: f32, p1: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;
    p0 * (2.0 * t3 - 3.0 * t2 + 1.0)
        + p1 * (-2.0 * t3 + 3.0 * t2)
        + out_tangent * (t3 - 2.0 * t2 + t)
        + in_tangent * (t3 - t2)
}

fn hermite_vec3(p0: Vec3, out_tangent: Vec3, in_tangent: Vec3, p1: Vec3, t: f32) -> Vec3 {
    let t2 = t * t;
    let t3 = t2 * t;
    p0 * (2.0 * t3 - 3.0 * t2 + 1.0)
        + p1 * (-2.0 * t3 + 3.0 * t2)
        + out_tangent * (t3 - 2.0 * t2 + t)
        + in_tangent * (t3 - t2)
}

fn squad(q0: Quat, a: Quat, b: Quat, q1: Quat, t: f32) -> Quat {
    nif_slerp(
        nif_slerp(q0, q1, t),
        nif_slerp(a, b, t),
        2.0 * t * (1.0 - t),
    )
}

fn nif_slerp(q0: Quat, q1: Quat, t: f32) -> Quat {
    let cosine = q0.dot(q1).clamp(-1.0, 1.0);
    let theta = cosine.acos();
    let sine = theta.sin();
    if sine.abs() < SIN_THRESHOLD {
        return q0;
    }
    q0 * (((1.0 - t) * theta).sin() / sine) + q1 * ((t * theta).sin() / sine)
}

fn quat_exp(mut quaternion: Quat) -> Quat {
    let theta = quaternion.xyz().length();
    let sine = theta.sin();
    let factor = if sine.abs() < SIN_THRESHOLD {
        1.0
    } else {
        sine / theta
    };
    quaternion *= factor;
    quaternion.w = theta.cos();
    quaternion
}

fn quat_log(mut quaternion: Quat) -> Quat {
    let theta = quaternion.w.clamp(-1.0, 1.0).acos();
    let sine = theta.sin();
    let factor = if sine.abs() < SIN_THRESHOLD {
        1.0
    } else {
        theta / sine
    };
    quaternion *= factor;
    quaternion.w = 0.0;
    quaternion
}

fn normalized_quat(value: [f32; 4]) -> Quat {
    normalize_quat(Quat::from_array(value))
}

fn normalize_quat(value: Quat) -> Quat {
    if value.length_squared() > EPSILON {
        value.normalize()
    } else {
        Quat::IDENTITY
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tes3::nif::glam::EulerRot;

    #[test]
    fn keyframe_quaternion_round_trips_through_nif_row_major_rotation() {
        let expected = Quat::from_euler(EulerRot::XYZ, 0.37, -0.81, 1.19).normalize();
        // NiAVObject stores NIF rows in glam's column-major Mat3. The stored
        // value is therefore transposed, and NiAVObject::transform transposes
        // it back when constructing the runtime affine matrix.
        let object = NiAVObject {
            rotation: Mat3::from_quat(expected).transpose(),
            ..Default::default()
        };
        let actual = Quat::from_mat3a(&object.transform().matrix3).normalize();

        assert!((actual.dot(expected).abs() - 1.0).abs() < 1.0e-5);
    }
}
