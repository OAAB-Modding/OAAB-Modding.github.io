use std::{
    env, fs,
    io::{self, Read},
};

use oaab_tes3_wasm::parse_nif_packet;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args: Vec<_> = env::args().skip(1).collect();
    let summary = args.first().is_some_and(|arg| arg == "--summary");
    if summary {
        args.remove(0);
    }
    for path in args {
        let bytes = if path == "-" {
            let mut bytes = Vec::new();
            io::stdin().read_to_end(&mut bytes)?;
            bytes
        } else {
            fs::read(&path)?
        };
        match parse_nif_packet(&bytes) {
            Ok(packet) if summary => println!(
                "{path}\t{} meshes\t{} vertices\t{} triangles\t{} textures [{}]\tblocks={}\tunsupported={}",
                packet.stats.meshes,
                packet.stats.vertices,
                packet.stats.triangles,
                packet.textures.len(),
                packet.textures.join(","),
                packet
                    .block_counts
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(","),
                packet
                    .unsupported_blocks
                    .iter()
                    .map(|block| block.block_type.as_str())
                    .collect::<Vec<_>>()
                    .join(","),
            ),
            Ok(packet) => println!("{}", serde_json::to_string(&packet)?),
            Err(error) => {
                eprintln!("{path}: {error}");
                std::process::exit(1);
            }
        }
    }
    Ok(())
}
